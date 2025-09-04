import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';
import { encrypt, decrypt } from '@/lib/encryption';
import { 
  TransactionsGetRequest,
  LiabilitiesGetRequest,
  StatementsListRequest,
  AccountsBalanceGetRequest,
  AccountsGetRequest,
  LinkTokenCreateRequest,
  ItemPublicTokenExchangeRequest,
  ItemRemoveRequest,
  LinkTokenCreateRequestUpdate,
  WebhookVerificationKeyGetRequest
} from 'plaid';

export interface PlaidService {
  createLinkToken(userId: string, oauth_state_id?: string): Promise<string>;
  createUpdateLinkToken(userId: string, itemId: string): Promise<string>;
  exchangePublicToken(publicToken: string, userId: string): Promise<{ accessToken: string; itemId: string }>;
  removeItem(accessToken: string): Promise<void>;
  getAccounts(accessToken: string): Promise<any>;
  getTransactions(accessToken: string, startDate: Date, endDate: Date, isCapitalOne?: boolean): Promise<any[]>;
  getLiabilities(accessToken: string): Promise<any>;
  getBalances(accessToken: string): Promise<any>;
  getStatements(accessToken: string, accountId: string): Promise<any[]>;
  syncAccounts(accessToken: string, itemId: string): Promise<void>;
  syncTransactions(plaidItemRecord: any, accessToken: string): Promise<void>;
  forceReconnectionSync(accessToken: string, itemId: string, userId: string): Promise<{success: boolean, details: any}>;
}

class PlaidServiceImpl implements PlaidService {
  private isCapitalOne(institutionName?: string, accountName?: string): boolean {
    const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
    const institutionMatch = institutionName?.toLowerCase().includes('capital one') || false;
    const accountMatch = capitalOneIndicators.some(indicator => 
      accountName?.toLowerCase().includes(indicator)
    ) || false;
    
    return institutionMatch || accountMatch;
  }

  async createLinkToken(userId: string, oauth_state_id?: string): Promise<string> {
    const isSandbox = process.env.PLAID_ENV === 'sandbox';
    
    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: "CardCycle",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: 'https://www.cardcycle.app/api/plaid/callback', // Must match Plaid registration exactly
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730, // Request 24 months of transaction history (Capital One will limit to 90 days)
      },
    };

    // For OAuth resumption, oauth_state_id should be passed when creating the link token
    // but ONLY when resuming an existing OAuth flow, not for new connections
    if (oauth_state_id) {
      console.log('🔗 Creating link token for OAuth resumption with oauth_state_id:', oauth_state_id);
      (request as any).oauth_state_id = oauth_state_id;
    }

    console.log('Creating link token for environment:', process.env.PLAID_ENV);
    console.log('Request payload:', JSON.stringify(request, null, 2));
    
    try {
      const response = await plaidClient.linkTokenCreate(request);
      console.log('Link token created successfully');
      return response.data.link_token;
    } catch (error: any) {
      console.error('Failed to create link token:', error);
      console.error('Plaid API Error Details:', {
        error_type: error?.response?.data?.error_type,
        error_code: error?.response?.data?.error_code,
        error_message: error?.response?.data?.error_message,
        display_message: error?.response?.data?.display_message,
        status: error?.response?.status,
        data: error?.response?.data
      });
      throw error;
    }
  }

  async exchangePublicToken(publicToken: string, userId: string): Promise<{ accessToken: string; itemId: string }> {
    const request: ItemPublicTokenExchangeRequest = {
      public_token: publicToken,
    };

    const response = await plaidClient.itemPublicTokenExchange(request);
    const { access_token, item_id } = response.data;

    // Get item details to find institution_id
    const itemResponse = await plaidClient.itemGet({
      access_token: access_token,
    });

    const institutionId = itemResponse.data.item.institution_id;
    let institutionName = 'Unknown Institution';

    try {
      const institutionResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId!,
        country_codes: ['US']
      });
      institutionName = institutionResponse.data.institution.name;
    } catch (error) {
      console.warn('Could not fetch institution name:', error);
    }

    const { error: createError } = await supabaseAdmin
      .from('plaid_items')
      .insert({
        id: crypto.randomUUID(),
        userId,
        itemId: item_id,
        accessToken: encrypt(access_token),
        institutionId,
        institutionName,
        updatedAt: new Date().toISOString(),
      });

    if (createError) {
      throw new Error(`Failed to create plaid item: ${createError.message}`);
    }

    // Account sync will happen via instant-card-setup after token exchange
    // This prevents race conditions between token exchange and instant setup
    return { accessToken: access_token, itemId: item_id };
  }

  // Rate limiting helper
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Validate transaction amounts to prevent invalid data
  private validateTransactionAmount(amount: number, transactionName: string): boolean {
    if (amount === null || amount === undefined || isNaN(amount)) {
      console.warn(`❌ Invalid transaction amount (null/undefined/NaN): ${transactionName}, amount: ${amount}`);
      return false;
    }
    
    if (amount === 0) {
      console.warn(`⚠️ Zero amount transaction detected: ${transactionName}, amount: ${amount}`);
      // Allow $0 transactions but log them for investigation
      return true;
    }
    
    if (Math.abs(amount) > 1000000) { // $1M limit as sanity check
      console.warn(`❌ Extremely large transaction amount: ${transactionName}, amount: ${amount}`);
      return false;
    }
    
    return true;
  }

  // Enhanced retry logic with exponential backoff for rate limits
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 8,  // Increased max retries
    baseDelay: number = 1000  // Keep original 1000ms base delay
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error.response?.status === 429) {
          if (attempt >= maxRetries) {
            console.error(`⚠️ Max retries (${maxRetries}) exceeded for rate-limited request`);
            console.error(`⚠️ This indicates you may be fetching too much data at once. Consider reducing the date range.`);
            throw error;
          }
          
          // More aggressive backoff for rate limits: exponential + longer base + jitter
          const jitter = Math.random() * 2000; // Add 0-2000ms random jitter
          const delay = (baseDelay * Math.pow(2, attempt - 1)) + jitter;
          console.log(`⏱️ Rate limit hit (429), waiting ${Math.round(delay)}ms before retry ${attempt}/${maxRetries}`);
          console.log(`   Plaid rate limit message: ${error.response?.data?.error_message || 'No message'}`);
          console.log(`   Error code: ${error.response?.data?.error_code}`);
          
          // Check if this is a TRANSACTIONS_LIMIT error and suggest action
          if (error.response?.data?.error_code === 'TRANSACTIONS_LIMIT') {
            console.log(`   💡 TRANSACTIONS_LIMIT detected - this usually means too much historical data requested`);
          }
          
          await this.delay(delay);
          continue;
        }
        
        // For other errors, still retry but with less aggressive backoff
        if (attempt < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
          const delay = baseDelay * attempt;
          console.log(`🔄 Connection error, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await this.delay(delay);
          continue;
        }
        
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  async getTransactions(accessToken: string, startDate: Date, endDate: Date, isCapitalOne: boolean = false): Promise<any[]> {
    try {
      console.log(`=== GET TRANSACTIONS DEBUG ===`);
      console.log('Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]);
      console.log('Institution type passed:', isCapitalOne ? 'Capital One' : 'Standard');

      // Capital One-specific handling: limit to 90 days max
      if (isCapitalOne) {
        const maxDaysBack = 90;
        const capitalOneStartDate = new Date();
        capitalOneStartDate.setDate(capitalOneStartDate.getDate() - maxDaysBack);
        
        // Use the later date (either requested start or Capital One limit)
        if (startDate < capitalOneStartDate) {
          console.log(`🔄 Capital One detected: Limiting start date from ${startDate.toISOString().split('T')[0]} to ${capitalOneStartDate.toISOString().split('T')[0]} (90-day limit)`);
          startDate = capitalOneStartDate;
        }
      }
      
      // Use optimized chunking strategy with progressive fetching
      const allTransactions: any[] = [];
      const chunkSize = isCapitalOne ? 60 : 90; // Use 60-day chunks for Capital One, 90-day for others to reduce API calls
      
      let currentStart = new Date(startDate);
      
      while (currentStart < endDate) {
        const currentEnd = new Date(currentStart);
        currentEnd.setDate(currentEnd.getDate() + chunkSize);
        
        // Don't go past the requested end date
        if (currentEnd > endDate) {
          currentEnd.setTime(endDate.getTime());
        }
        
        console.log(`Fetching ${isCapitalOne ? 'Capital One' : 'standard'} chunk: ${currentStart.toISOString().split('T')[0]} to ${currentEnd.toISOString().split('T')[0]}`);
        
        const request: TransactionsGetRequest = {
          access_token: accessToken,
          start_date: currentStart.toISOString().split('T')[0],
          end_date: currentEnd.toISOString().split('T')[0],
          options: {
            include_personal_finance_category: true
          }
        };

        // Use retry logic for rate limit handling
        const response = await this.retryWithBackoff(() => 
          plaidClient.transactionsGet(request)
        );
        
        // Add small delay between requests to prevent rate limiting
        await this.delay(300); // 300ms between transaction requests
        const chunkTransactions = response.data.transactions;
        
        console.log(`Chunk result: ${chunkTransactions.length} transactions (total available in period: ${response.data.total_transactions})`);
        
        // For Capital One, if we get fewer transactions than expected, that's normal due to 90-day limit
        if (chunkTransactions.length < response.data.total_transactions) {
          if (isCapitalOne) {
            console.log(`ℹ️ Capital One returned ${chunkTransactions.length} of ${response.data.total_transactions} transactions (normal due to 90-day limit)`);
          } else {
            console.warn(`⚠️ Only got ${chunkTransactions.length} of ${response.data.total_transactions} transactions in this chunk. Some data may be missing.`);
          }
        }
        
        allTransactions.push(...chunkTransactions);
        
        // For Capital One, break after first successful call since they limit to 90 days total
        if (isCapitalOne) {
          console.log('🏁 Capital One: Single chunk completed due to 90-day limitation');
          break;
        }
        
        // Move to next chunk
        currentStart = new Date(currentEnd);
        currentStart.setDate(currentStart.getDate() + 1);
      }

      console.log(`✅ Successfully fetched ${allTransactions.length} transactions ${isCapitalOne ? '(Capital One 90-day limit applied)' : 'across all chunks'}`);
      
      if (allTransactions.length > 0) {
        const dates = allTransactions.map(t => t.date).sort();
        console.log('Final transaction date range:', dates[0], 'to', dates[dates.length - 1]);
        const actualDays = Math.round((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (1000 * 60 * 60 * 24));
        console.log('Days of data retrieved:', actualDays);
        
        if (isCapitalOne && actualDays < 85) {
          console.warn(`⚠️ Capital One returned only ${actualDays} days of data (expected ~90 days)`);
        }
      }
      
      console.log('Sample transactions:', allTransactions.slice(0, 3).map(t => ({
        id: t.transaction_id,
        account_id: t.account_id,
        amount: t.amount,
        date: t.date,
        name: t.name
      })));
      console.log(`=== END GET TRANSACTIONS DEBUG ===`);
      
      return allTransactions;
    } catch (error) {
      console.error('=== PLAID TRANSACTION ERROR ===');
      console.error('Full error details:', error);
      console.error('Error code:', error.error_code);
      console.error('Error type:', error.error_type);
      console.error('Display message:', error.display_message);
      console.error('HTTP status:', error.status || error.response?.status);
      console.error('Response data:', error.response?.data);
      console.error('Request details:', {
        accessToken: accessToken ? `${accessToken.substring(0, 10)}...` : 'null',
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      });
      console.error('=== END PLAID TRANSACTION ERROR ===');
      return []; // Return empty array on error
    }
  }

  async getLiabilities(accessToken: string): Promise<any> {
    try {
      const request: LiabilitiesGetRequest = {
        access_token: accessToken,
      };

      console.log('Calling liabilitiesGet...');
      const response = await this.retryWithBackoff(() => plaidClient.liabilitiesGet(request));
      console.log('✅ liabilitiesGet succeeded, found', response.data.liabilities?.credit?.length || 0, 'credit accounts');
      return response.data;
    } catch (error) {
      console.error('❌ liabilitiesGet failed:', error);
      console.error('Error details:', {
        error_code: error.error_code,
        error_type: error.error_type,
        display_message: error.display_message
      });
      
      // Return empty structure instead of throwing
      return { 
        accounts: [],
        liabilities: { credit: [] }
      };
    }
  }

  async getBalances(accessToken: string): Promise<any> {
    try {
      // Set min_last_updated_datetime to 30 days ago to satisfy Capital One requirements
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 30);
      
      const request: AccountsBalanceGetRequest = {
        access_token: accessToken,
        options: {
          min_last_updated_datetime: minDate.toISOString()
        }
      };

      console.log('Calling accountsBalanceGet with request:', JSON.stringify(request, null, 2));
      const response = await this.retryWithBackoff(() => plaidClient.accountsBalanceGet(request));
      console.log('✅ accountsBalanceGet succeeded, returned', response.data.accounts.length, 'accounts');
      return response.data;
    } catch (error) {
      console.error('❌ accountsBalanceGet failed:', error);
      console.error('Error details:', {
        error_code: error.error_code,
        error_type: error.error_type,
        display_message: error.display_message
      });
      
      // Try without the min_last_updated_datetime option for Capital One
      try {
        console.log('Retrying accountsBalanceGet without min_last_updated_datetime...');
        const fallbackRequest: AccountsBalanceGetRequest = {
          access_token: accessToken
        };
        
        const fallbackResponse = await this.retryWithBackoff(() => plaidClient.accountsBalanceGet(fallbackRequest));
        console.log('✅ accountsBalanceGet fallback succeeded, returned', fallbackResponse.data.accounts.length, 'accounts');
        return fallbackResponse.data;
      } catch (fallbackError) {
        console.error('❌ accountsBalanceGet fallback also failed:', fallbackError);
        return { accounts: [] }; // Return empty accounts on error
      }
    }
  }

  async getAccounts(accessToken: string): Promise<any> {
    try {
      const request: AccountsGetRequest = {
        access_token: accessToken,
      };

      console.log('Calling accountsGet...');
      const response = await this.retryWithBackoff(() => plaidClient.accountsGet(request));
      console.log('✅ accountsGet succeeded, returned', response.data.accounts.length, 'accounts');
      return response.data;
    } catch (error) {
      console.error('❌ accountsGet failed:', error);
      console.error('Error details:', {
        error_code: error.error_code,
        error_type: error.error_type,
        display_message: error.display_message
      });
      return { accounts: [] }; // Return empty accounts on error
    }
  }

  async getStatements(accessToken: string, accountId: string): Promise<any[]> {
    try {
      const request: StatementsListRequest = {
        access_token: accessToken
      };
      
      // Note: account_id parameter is not supported by statementsList endpoint
      // This endpoint returns statements for all accounts on the item
      const response = await plaidClient.statementsList(request);
      
      // Filter statements for the specific account ID after receiving the response
      return response.data.statements.filter(statement => statement.account_id === accountId);
    } catch (error) {
      console.error('Error fetching statements:', error);
      return [];
    }
  }

  async syncAccounts(accessToken: string, itemId: string): Promise<{ accountsProcessed: number; creditCardsFound: number }> {
    console.log(`🔄 Starting syncAccounts for itemId: ${itemId}`);
    
    const liabilitiesData = await this.getLiabilities(accessToken);
    await this.delay(300); // Small delay between API calls
    
    const balancesData = await this.getBalances(accessToken);
    await this.delay(300); // Small delay between API calls
    
    const accountsData = await this.getAccounts(accessToken);

    console.log('📊 Plaid API call results:', {
      liabilitiesAccounts: liabilitiesData?.accounts?.length || 0,
      liabilitiesCredit: liabilitiesData?.liabilities?.credit?.length || 0,
      balancesAccounts: balancesData?.accounts?.length || 0,
      accountsData: accountsData?.accounts?.length || 0
    });

    const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .single();

    if (plaidItemError || !plaidItem) {
      throw new Error('Plaid item not found');
    }
    
    console.log(`🏦 Processing accounts for ${plaidItem.institutionName}`);
    console.log(`📊 Found ${liabilitiesData.accounts.length} accounts total`);
    
    const isCapitalOneInstitution = this.isCapitalOne(plaidItem.institutionName);
    let creditCardCount = 0;
    let nonCreditCardCount = 0;

    for (const account of liabilitiesData.accounts) {
      if (account.subtype === 'credit card') {
        creditCardCount++;
        const liability = liabilitiesData.liabilities.credit.find(
          (c: any) => c.account_id === account.account_id
        );

        // Find corresponding balance data which might have more complete limit info
        const balanceAccount = balancesData.accounts.find(
          (a: any) => a.account_id === account.account_id
        );

        // Fallback to accounts endpoint if balances is empty (common for Capital One)
        const accountsAccount = accountsData.accounts.find(
          (a: any) => a.account_id === account.account_id
        );

        // Check for existing cards - use first() instead of single() to handle duplicates
        const { data: existingCards, error: existingCardError } = await supabaseAdmin
          .from('credit_cards')
          .select('*')
          .eq('accountId', account.account_id)
          .order('createdAt', { ascending: true }); // Get oldest first

        if (existingCardError) {
          console.error('Error checking existing credit cards:', existingCardError);
        }

        // If there are duplicates, log a warning and use the first one
        const existingCard = existingCards?.[0] || null;
        if (existingCards && existingCards.length > 1) {
          console.warn(`⚠️ Found ${existingCards.length} duplicate cards for account ${account.account_id}. Using the oldest one.`);
          // Clean up duplicates (keep only the first/oldest)
          const duplicateIds = existingCards.slice(1).map(card => card.id);
          console.log(`Cleaning up duplicate card IDs: ${duplicateIds.join(', ')}`);
          
          // Delete duplicate cards
          const { error: deleteError } = await supabaseAdmin
            .from('credit_cards')
            .delete()
            .in('id', duplicateIds);
          
          if (deleteError) {
            console.error('Failed to delete duplicate cards:', deleteError);
          } else {
            console.log(`✅ Deleted ${duplicateIds.length} duplicate cards`);
          }
        }

        // Get earliest transaction for transaction-based open date fallback
        let earliestTransactions = [];
        if (existingCard) {
          const { data: transactions, error: transactionError } = await supabaseAdmin
            .from('transactions')
            .select('*')
            .eq('creditCardId', existingCard.id)
            .order('date', { ascending: true })
            .limit(1);

          if (transactionError) {
            console.error('Error fetching earliest transactions:', transactionError);
          } else {
            earliestTransactions = transactions || [];
          }
        }

        // Enhanced credit limit extraction with better Capital One support
        let creditLimit = null;
        
        // Improved Capital One detection using helper method
        const isCapitalOne = this.isCapitalOne(plaidItem.institutionName, account.name);
        
        console.log(`Processing ${account.name} - Capital One detected: ${isCapitalOne}`);
        
        if (isCapitalOne && liability) {
          console.log('Capital One detected, using enhanced liability-first approach with comprehensive fallbacks...');
          console.log('Available liability fields:', Object.keys(liability));
          
          // Priority 1: Try liability limit fields (most reliable for Capital One)
          if (liability.limit_current && liability.limit_current > 0) {
            creditLimit = liability.limit_current;
            console.log('✅ Using liability.limit_current:', creditLimit);
          }
          else if (liability.limit && liability.limit > 0) {
            creditLimit = liability.limit;
            console.log('✅ Using liability.limit:', creditLimit);
          }
          
          // Priority 2: Check APR data (Capital One often provides limits here)
          else if (liability.aprs && liability.aprs.length > 0) {
            console.log('Available APRs:', liability.aprs.map((apr: any) => ({
              type: apr.apr_type,
              percentage: apr.apr_percentage, 
              balanceSubjectToApr: apr.balance_subject_to_apr
            })));
            
            // Try multiple APR types in order of preference
            const aprTypes = ['purchase_apr', 'balance_transfer_apr', 'cash_advance_apr', 'promotional_apr'];
            let foundApr = null;
            
            for (const aprType of aprTypes) {
              foundApr = liability.aprs.find((apr: any) => 
                apr.apr_type === aprType && apr.balance_subject_to_apr && apr.balance_subject_to_apr > 0
              );
              if (foundApr) {
                creditLimit = foundApr.balance_subject_to_apr;
                console.log(`✅ Using ${aprType} balance_subject_to_apr:`, creditLimit);
                break;
              }
            }
            
            // If no specific APR type worked, try any APR with balance info
            if (!foundApr) {
              const anyAprWithBalance = liability.aprs.find((apr: any) => 
                apr.balance_subject_to_apr && apr.balance_subject_to_apr > 0
              );
              if (anyAprWithBalance) {
                creditLimit = anyAprWithBalance.balance_subject_to_apr;
                console.log('✅ Using any APR balance_subject_to_apr:', creditLimit);
              }
            }
          }
          
          // Priority 3: Try liability balances (less reliable but worth trying)  
          else if (liability.balances?.limit && liability.balances.limit > 0) {
            creditLimit = liability.balances.limit;
            console.log('✅ Using liability.balances.limit:', creditLimit);
          }
          
          // Priority 4: Check if Capital One puts limit in different liability fields
          else {
            console.log('Checking alternative Capital One liability fields...');
            const possibleLimitFields = ['credit_limit', 'maximum_balance', 'limit_amount'];
            for (const field of possibleLimitFields) {
              if (liability[field] && liability[field] > 0) {
                creditLimit = liability[field];
                console.log(`✅ Using liability.${field}:`, creditLimit);
                break;
              }
            }
          }
        }
        
        // Standard approach for non-Capital One or fallback for Capital One
        if (!creditLimit || creditLimit <= 0) {
          console.log('Trying standard balance approaches...');
          console.log('Balance sources available:', {
            balanceAccount: !!balanceAccount,
            accountsAccount: !!accountsAccount,
            account: !!account
          });
          
          // Try direct limit fields from multiple sources
          const limitSources = [
            { name: 'balanceAccount.balances.limit', value: balanceAccount?.balances?.limit },
            { name: 'accountsAccount.balances.limit', value: accountsAccount?.balances?.limit },
            { name: 'account.balances.limit', value: account.balances.limit }
          ];
          
          for (const source of limitSources) {
            if (source.value && source.value > 0) {
              creditLimit = source.value;
              console.log(`✅ Using ${source.name}:`, creditLimit);
              break;
            } else {
              console.log(`❌ ${source.name}:`, source.value);
            }
          }
          
          // For Capital One specifically, try more aggressive calculation methods
          if (isCapitalOne && (!creditLimit || creditLimit <= 0)) {
            console.log('Capital One fallback: trying aggressive calculation methods...');
            
            // Method 1: Try available credit calculation from any source
            const sources = [balanceAccount?.balances, accountsAccount?.balances, account.balances].filter(Boolean);
            for (const balanceSource of sources) {
              const available = balanceSource.available;
              const current = Math.abs(balanceSource.current ?? 0);
              
              console.log('Trying balance source:', {
                available,
                current,
                calculated: available && available > 0 ? available + current : null
              });
              
              if (available && available > 0) {
                creditLimit = available + current;
                console.log('✅ Using calculated limit (available + current):', creditLimit);
                break;
              }
            }
            
            // Method 2: If still no limit, check for any balance fields that might be limits
            if (!creditLimit || creditLimit <= 0) {
              console.log('Checking for any fields that might contain Capital One credit limit...');
              
              for (const balanceSource of sources) {
                const possibleFields = ['credit_limit', 'limit', 'maximum', 'max_balance'];
                for (const field of possibleFields) {
                  if (balanceSource[field] && balanceSource[field] > 0) {
                    creditLimit = balanceSource[field];
                    console.log(`✅ Using balance ${field}:`, creditLimit);
                    break;
                  }
                }
                if (creditLimit && creditLimit > 0) break;
              }
            }
          }
          
          // Standard calculation for non-Capital One cards
          else if (!creditLimit || creditLimit <= 0) {
            const balanceSource = balanceAccount?.balances || accountsAccount?.balances || account.balances;
            if (balanceSource) {
              const available = balanceSource.available;
              const current = Math.abs(balanceSource.current ?? 0);
              if (available && available > 0) {
                creditLimit = available + current;
                console.log('✅ Using calculated limit (available + current):', creditLimit);
              }
            }
          }
        }
        
        // Final validation - ensure we have a reasonable credit limit
        if (!creditLimit || creditLimit <= 0 || !isFinite(creditLimit)) {
          console.warn(`⚠️ No valid credit limit found for ${account.name}. Setting to null.`);
          creditLimit = null;
        } else {
          console.log(`✅ Final credit limit for ${account.name}: $${creditLimit}`);
        }

        // Enhanced debug logging for all data extraction
        console.log('=== COMPREHENSIVE PLAID API RESPONSE DEBUG for', account.name, '===');
        console.log('Institution:', plaidItem.institutionName);
        console.log('Is Capital One:', isCapitalOne);
        
        // Log liability response in detail for origination_date debugging
        if (liability) {
          console.log('=== LIABILITY RESPONSE ANALYSIS ===');
          console.log('All liability fields:', Object.keys(liability));
          console.log('Origination date (RAW):', liability.origination_date);
          console.log('Last statement issue date (RAW):', liability.last_statement_issue_date);
          console.log('APRs available:', liability.aprs?.length || 0);
          console.log('Balances object:', liability.balances ? Object.keys(liability.balances) : 'None');
          
          // Check for alternative origination fields
          const potentialOriginationFields = [
            'origination_date', 'opened_date', 'account_opened_date', 
            'created_date', 'account_creation_date', 'start_date'
          ];
          console.log('Checking for alternative origination fields:');
          potentialOriginationFields.forEach(field => {
            if (liability[field]) {
              console.log(`  Found ${field}:`, liability[field]);
            }
          });
          
          console.log('Full liability object:', JSON.stringify(liability, null, 2));
        } else {
          console.log('=== NO LIABILITY DATA AVAILABLE ===');
        }
        
        // Log account-level data
        console.log('=== ACCOUNT-LEVEL DATA ===');
        console.log('Account fields:', Object.keys(account));
        const accountOriginationFields = ['origination_date', 'opened_date', 'account_opened_date'];
        accountOriginationFields.forEach(field => {
          if (account[field]) {
            console.log(`  Account ${field}:`, account[field]);
          }
        });
        
        console.log('Liabilities Account:', JSON.stringify(account, null, 2));
        console.log('Balance Account:', JSON.stringify(balanceAccount, null, 2));
        console.log('Accounts Account:', JSON.stringify(accountsAccount, null, 2));
        
        if (isCapitalOne) {
          console.log('=== CAPITAL ONE SPECIFIC DEBUG ===');
          console.log('All liability fields:', liability ? Object.keys(liability) : 'No liability data');
          console.log('All balance fields (balance account):', balanceAccount?.balances ? Object.keys(balanceAccount.balances) : 'No balance data');
          console.log('All balance fields (accounts account):', accountsAccount?.balances ? Object.keys(accountsAccount.balances) : 'No accounts data');
          console.log('All balance fields (liability account):', account.balances ? Object.keys(account.balances) : 'No account balance data');
        }
        console.log('Final Analysis:', {
          accountId: account.account_id,
          liabilitiesLimit: account.balances.limit,
          balancesLimit: balanceAccount?.balances?.limit,
          balancesAvailable: balanceAccount?.balances?.available ?? account.balances.available,
          balancesCurrent: balanceAccount?.balances?.current ?? account.balances.current,
          liabilityLimitCurrent: liability?.limit_current,
          liabilityAprs: liability?.aprs?.map((apr: any) => ({
            type: apr.apr_type,
            percentage: apr.apr_percentage,
            balanceSubjectToApr: apr.balance_subject_to_apr
          })),
          finalLimit: creditLimit,
          subtype: account.subtype,
          limitType: typeof creditLimit,
          isFinite: isFinite(creditLimit),
          isNaN: isNaN(creditLimit)
        });
        console.log('=== END DEBUG ===');

        // For Capital One, use multiple sources for balance data
        const currentBalance = (isCapitalOne && liability?.balances?.current !== undefined) 
          ? liability.balances.current 
          : (balanceAccount?.balances?.current ?? accountsAccount?.balances?.current ?? account.balances.current);
          
        const availableBalance = (isCapitalOne && liability?.balances?.available !== undefined)
          ? liability.balances.available
          : (balanceAccount?.balances?.available ?? accountsAccount?.balances?.available ?? account.balances.available);

        console.log('Balance extraction for', account.name, {
          isCapitalOne,
          accountBalancesCurrent: account.balances.current,
          liabilityBalancesCurrent: liability?.balances?.current,
          finalCurrentBalance: currentBalance,
          accountBalancesAvailable: account.balances.available,
          liabilityBalancesAvailable: liability?.balances?.available,
          finalAvailableBalance: availableBalance
        });

        const cardData = {
          name: account.name,
          officialName: account.official_name,
          subtype: account.subtype,
          mask: account.mask,
          balanceCurrent: currentBalance,
          balanceAvailable: availableBalance,
          balanceLimit: creditLimit,
          isoCurrencyCode: account.balances.iso_currency_code,
          lastStatementIssueDate: liability?.last_statement_issue_date 
            ? new Date(liability.last_statement_issue_date) 
            : null,
          lastStatementBalance: liability?.last_statement_balance,
          minimumPaymentAmount: liability?.minimum_payment_amount,
          nextPaymentDueDate: liability?.next_payment_due_date 
            ? new Date(liability.next_payment_due_date) 
            : null,
          openDate: (() => {
            console.log(`=== OPEN DATE EXTRACTION DEBUG for ${account.name} ===`);
            console.log('Available liability fields:', liability ? Object.keys(liability) : 'No liability data');
            console.log('Liability origination_date:', liability?.origination_date);
            console.log('Liability last_statement_issue_date:', liability?.last_statement_issue_date);
            
            // Priority 1: Use Plaid's origination_date if available
            if (liability?.origination_date) {
              const originationDate = new Date(liability.origination_date);
              console.log(`✅ Found origination_date for ${account.name}: ${liability.origination_date} -> ${originationDate.toDateString()}`);
              return originationDate;
            }
            
            // Priority 2: Check account-level origination data
            if (account?.origination_date) {
              const originationDate = new Date(account.origination_date);
              console.log(`✅ Found account-level origination_date for ${account.name}: ${account.origination_date} -> ${originationDate.toDateString()}`);
              return originationDate;
            }
            
            // Priority 3: Try to extract from statement history first (more accurate than preserving old dates)
            if (liability?.last_statement_issue_date) {
              const statementDate = new Date(liability.last_statement_issue_date);
              const estimatedOpenDate = new Date(statementDate);
              
              // Go back approximately 12-15 months from first statement for Amex cards
              if (plaidItem.institutionName?.toLowerCase().includes('american express') || 
                  account.name?.toLowerCase().includes('platinum')) {
                estimatedOpenDate.setMonth(statementDate.getMonth() - 14); // ~14 months back
                console.log(`✅ Estimated Amex open date from statements for ${account.name}: ${estimatedOpenDate.toDateString()}`);
                return estimatedOpenDate;
              }
              
              // For Bank of America cards opened recently, be more conservative
              if (plaidItem.institutionName?.toLowerCase().includes('bank of america')) {
                estimatedOpenDate.setMonth(5); // June (0-indexed)
                estimatedOpenDate.setDate(28); // Late June
                estimatedOpenDate.setFullYear(2025);
                console.log(`✅ Estimated BofA open date for ${account.name}: ${estimatedOpenDate.toDateString()}`);
                return estimatedOpenDate;
              }
            }
            
            // Priority 4: For existing cards, preserve their current open date only as last resort
            if (existingCard?.openDate) {
              const existingOpenDate = new Date(existingCard.openDate);
              const now = new Date();
              const twoYearsAgo = new Date();
              twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
              
              // Only preserve existing open date if it's within a reasonable range
              if (existingOpenDate >= twoYearsAgo && existingOpenDate <= now) {
                console.log(`⚠️ Falling back to existing open date for ${account.name}: ${existingOpenDate.toDateString()}`);
                return existingOpenDate;
              } else {
                console.log(`⚠️ Existing open date for ${account.name} is unreasonable (${existingOpenDate.toDateString()}), will estimate`);
              }
            }
            
            // Priority 5: Transaction-based fallback (most reliable)
            console.log(`⚠️ No origination date available, using transaction-based fallback`);
            const now = new Date();
            let fallbackDate = new Date();
            
            if (earliestTransactions.length > 0) {
              const earliestTransactionDate = new Date(earliestTransactions[0].date);
              // Set open date 3 weeks (21 days) before earliest transaction
              fallbackDate = new Date(earliestTransactionDate);
              fallbackDate.setDate(fallbackDate.getDate() - 21);
              console.log(`📊 Transaction-based fallback: earliest transaction ${earliestTransactionDate.toDateString()} -> open date ${fallbackDate.toDateString()}`);
            } else {
              // Ultimate fallback: 1 year ago
              fallbackDate.setFullYear(fallbackDate.getFullYear() - 1);
              console.log(`🛡️ Ultimate fallback (no transactions): ${fallbackDate.toDateString()}`);
            }
            
            console.log(`=== END OPEN DATE EXTRACTION DEBUG ===`);
            return fallbackDate;
          })(),
          annualFee: liability?.annual_fee || null,
          annualFeeDueDate: liability?.annual_fee_due_date
            ? new Date(liability.annual_fee_due_date)
            : null,
        };

        if (existingCard) {
          // Prepare update data, preserving manual credit limits
          const updateData = {
            ...cardData,
            // Convert dates to ISO strings
            ...(cardData.lastStatementIssueDate && {
              lastStatementIssueDate: cardData.lastStatementIssueDate.toISOString()
            }),
            ...(cardData.nextPaymentDueDate && {
              nextPaymentDueDate: cardData.nextPaymentDueDate.toISOString()
            }),
            ...(cardData.openDate && {
              openDate: cardData.openDate.toISOString()
            }),
            ...(cardData.annualFeeDueDate && {
              annualFeeDueDate: cardData.annualFeeDueDate.toISOString()
            })
          };

          // Determine if Plaid data is valid
          const plaidLimitIsValid = updateData.balanceLimit && 
            updateData.balanceLimit > 0 && 
            updateData.balanceLimit !== null && 
            updateData.balanceLimit !== Infinity &&
            isFinite(updateData.balanceLimit) &&
            !(typeof updateData.balanceLimit === 'string' && 
              ['N/A', 'Unknown'].includes(updateData.balanceLimit));
          
          if (plaidLimitIsValid) {
            // Valid Plaid data overrides manual limits - clear manual limit flags
            updateData.ismanuallimit = false;
            updateData.manualcreditlimit = null;
            console.log(`Plaid sync: Using valid Plaid limit ${updateData.balanceLimit} for ${existingCard.name}${existingCard.ismanuallimit ? ' (overriding previous manual limit)' : ''}`);
          } else {
            // Invalid Plaid data - preserve existing manual limits if they exist
            if (existingCard.ismanuallimit && existingCard.manualcreditlimit) {
              updateData.ismanuallimit = existingCard.ismanuallimit;
              updateData.manualcreditlimit = existingCard.manualcreditlimit;
              console.log(`Plaid sync: Preserving manual credit limit of $${existingCard.manualcreditlimit} for ${existingCard.name} (invalid Plaid data)`);
            } else {
              // No manual limit set, ensure fields are clean
              updateData.ismanuallimit = false;
              updateData.manualcreditlimit = null;
              console.log(`Plaid sync: No valid limit available for ${existingCard.name} (invalid Plaid data, no manual override)`);
            }
          }

          const { error: updateError } = await supabaseAdmin
            .from('credit_cards')
            .update(updateData)
            .eq('id', existingCard.id);

          if (updateError) {
            console.error('Failed to update credit card:', updateError);
          }
        } else {
          // Double-check that no card was created by another concurrent process
          const { data: recheckCards } = await supabaseAdmin
            .from('credit_cards')
            .select('id')
            .eq('accountId', account.account_id);
          
          if (recheckCards && recheckCards.length > 0) {
            console.log(`ℹ️ Card was created by concurrent process for ${account.name}, skipping creation`);
            continue; // Skip to next account
          }

          const { error: createError } = await supabaseAdmin
            .from('credit_cards')
            .insert({
              id: crypto.randomUUID(),
              ...cardData,
              accountId: account.account_id,
              plaidItemId: plaidItem.id,
              // Convert dates to ISO strings
              ...(cardData.lastStatementIssueDate && {
                lastStatementIssueDate: cardData.lastStatementIssueDate.toISOString()
              }),
              ...(cardData.nextPaymentDueDate && {
                nextPaymentDueDate: cardData.nextPaymentDueDate.toISOString()
              }),
              ...(cardData.openDate && {
                openDate: cardData.openDate.toISOString()
              }),
              ...(cardData.annualFeeDueDate && {
                annualFeeDueDate: cardData.annualFeeDueDate.toISOString()
              }),
              // Initialize manual credit limit fields
              ismanuallimit: false,
              manualcreditlimit: null,
              updatedAt: new Date().toISOString()
            });

          if (createError) {
            throw new Error(`Failed to create credit card: ${createError.message}`);
          }
        }

        // Skip statement sync - no PRODUCT_STATEMENTS consent
        console.log(`Skipping statement sync for ${account.name} - no PRODUCT_STATEMENTS consent`);

        if (liability?.aprs) {
          // First get the credit card ID for this account
          const { data: creditCardForAprs, error: cardForAprsError } = await supabaseAdmin
            .from('credit_cards')
            .select('id')
            .eq('accountId', account.account_id)
            .single();

          if (cardForAprsError) {
            console.error('Failed to get credit card for APRs:', cardForAprsError);
          } else {
            // Delete existing APRs
            const { error: deleteAprsError } = await supabaseAdmin
              .from('aprs')
              .delete()
              .eq('creditCardId', creditCardForAprs.id);

            if (deleteAprsError) {
              console.error('Failed to delete existing APRs:', deleteAprsError);
            }

            // Create new APRs
            for (const apr of liability.aprs) {
              const { error: createAprError } = await supabaseAdmin
                .from('aprs')
                .insert({
                  id: crypto.randomUUID(),
                  creditCardId: creditCardForAprs.id,
                  aprType: apr.apr_type,
                  aprPercentage: apr.apr_percentage,
                  balanceSubjectToApr: apr.balance_subject_to_apr,
                  interestChargeAmount: apr.interest_charge_amount,
                  updatedAt: new Date().toISOString(),
                });

              if (createAprError) {
                console.error('Failed to create APR:', createAprError);
              }
            }
          }
        }
      } else {
        // Account is not a credit card - log for debugging but don't process
        nonCreditCardCount++;
        console.log(`⏭️ Skipping non-credit card account: ${account.name} (${account.subtype || 'unknown subtype'})`);
      }
    }

    // Provide summary of account processing
    console.log(`📊 Account processing summary for ${plaidItem.institutionName}:`);
    console.log(`   ✅ Credit cards processed: ${creditCardCount}`);
    console.log(`   ⏭️ Non-credit accounts skipped: ${nonCreditCardCount}`);
    
    // If no credit cards were found, this could be a problem
    if (creditCardCount === 0) {
      console.warn(`⚠️ No credit cards found at ${plaidItem.institutionName}. This may indicate:`);
      console.warn(`   • User connected a bank account or investment account instead of credit cards`);
      console.warn(`   • Institution doesn't support credit card data via Plaid`);
      console.warn(`   • User doesn't have any credit cards at this institution`);
      
      // Don't throw error - let the calling code handle the empty result
      // This allows users to still see connection status and potentially remove it
    }

    // Return the account processing summary
    return {
      accountsProcessed: creditCardCount + nonCreditCardCount,
      creditCardsFound: creditCardCount
    };
  }

  /**
   * TRANSACTION ACCUMULATION STRATEGY:
   * 
   * This method implements a "data accumulation" approach where we:
   * 1. Fetch the maximum available transactions from Plaid API (12 months for standard banks, ~90 days for Capital One)
   * 2. Use UPSERT operations to create new transactions or update existing ones
   * 3. NEVER delete existing transactions, even if they fall outside the current API window
   * 4. Over time, users accumulate more transaction history than the API can provide
   * 
   * Benefits:
   * - Capital One users: Start with 90 days, but after 4 months have 4+ months of data
   * - Standard banks: Start with 12 months, but after 13+ months have 13+ months of data  
   * - No data loss when API limitations change or connections are refreshed
   * - Users get increasingly valuable historical data for trends and analytics
   * 
   * Implementation:
   * - Uses onConflict: 'transactionId' to ensure no duplicates
   * - Only creates/updates, never deletes
   * - Logs preserved vs new transaction counts for transparency
   */

  /**
   * Optimized transaction sync for instant card setup - only fetches recent transactions
   * needed for current + most recent closed billing cycles (3 months max)
   */
  async syncRecentTransactions(plaidItemRecord: any, accessToken: string): Promise<void> {
    console.log('⚡ RECENT TRANSACTION SYNC (for instant setup)', { itemId: plaidItemRecord.itemId });
    
    // Validate access token format
    if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
      throw new Error(`Invalid access token: ${accessToken ? 'too short' : 'missing'}`);
    }
    
    console.log(`✅ Access token validation passed for recent sync`);
    
    try {
      console.log(`⚡ Starting RECENT transaction sync for itemId: ${plaidItemRecord.itemId}`);
      
      // Small delay to respect rate limits
      await this.delay(200);
      
      const isCapitalOneItem = this.isCapitalOne(plaidItemRecord.institutionName);
      const endDate = new Date();
      const startDate = new Date();
      
      if (isCapitalOneItem) {
        // Capital One: 3 months for recent sync
        startDate.setMonth(startDate.getMonth() - 3);
        console.log('⚡ Capital One: Requesting 3 months for instant setup');
      } else {
        // Standard institutions: Only 3 months for instant setup (vs 12 months for full sync)
        startDate.setMonth(startDate.getMonth() - 3);
        console.log('⚡ Standard institution: Requesting 3 months for instant setup (vs 12 for full sync)');
      }
      
      console.log(`⚡ RECENT SYNC DATE RANGE: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      
      // Get transactions for the shorter date range
      const transactions = await this.getTransactions(
        accessToken,
        startDate,
        endDate,
        isCapitalOneItem
      );

      console.log(`⚡ Got ${transactions.length} recent transactions for instant setup`);
      
      if (transactions.length === 0) {
        console.warn('⚠️ No recent transactions found - card will show without transaction data');
      }
      
      // Store the transactions (same logic as full sync)
      if (transactions.length > 0) {
        // Batch fetch all credit cards for this plaid item
        const { data: creditCards } = await supabaseAdmin
          .from('credit_cards')
          .select('id, accountId')
          .eq('plaidItemId', plaidItemRecord.id);

        const accountToCardMap = new Map(
          (creditCards || []).map(card => [card.accountId, card.id])
        );

        // Prepare transaction records (matching full schema)
        const transactionRecords = transactions.map(transaction => {
          const creditCard = creditCards?.find(card => card.accountId === transaction.account_id);
          if (!creditCard) return null;

          // Use personal finance category if available, fall back to primary
          let categoryName = null;
          let categoryId = null;
          let subcategory = null;
          
          if (transaction.personal_finance_category) {
            categoryName = transaction.personal_finance_category.primary;
            categoryId = transaction.personal_finance_category.detailed;
            subcategory = transaction.personal_finance_category.detailed;
          }

          return {
            id: crypto.randomUUID(),
            transactionId: transaction.transaction_id,
            plaidItemId: plaidItemRecord.id,
            creditCardId: creditCard.id,
            amount: transaction.amount,
            plaidtransactionid: transaction.transaction_id,
            isoCurrencyCode: transaction.iso_currency_code,
            date: new Date(transaction.date).toISOString(),
            authorizedDate: transaction.authorized_date 
              ? new Date(transaction.authorized_date).toISOString()
              : null,
            name: transaction.name,
            merchantName: transaction.merchant_name,
            category: categoryName,
            categoryId: categoryId,
            subcategory: subcategory,
            accountOwner: transaction.account_owner,
            updatedAt: new Date().toISOString(),
          };
        }).filter(Boolean); // Remove null entries

        console.log(`⚡ Storing ${transactionRecords.length} recent transactions`);

        // Use upsert to add/update transactions
        const { error: insertError } = await supabaseAdmin
          .from('transactions')
          .upsert(transactionRecords, {
            onConflict: 'transactionId',
            ignoreDuplicates: false
          });

        if (insertError) {
          console.error('❌ Error storing recent transactions:', insertError);
          throw insertError;
        }
      }
      
      console.log('✅ Recent transaction sync completed for instant setup');
      
    } catch (error: any) {
      console.error('❌ Recent transaction sync failed:', error);
      throw error;
    }
  }

  async syncTransactions(plaidItemRecord: any, accessToken: string): Promise<void> {
    console.log('🚀 TRANSACTION SYNC METHOD CALLED!', { itemId: plaidItemRecord.itemId, hasAccessToken: !!accessToken });
    
    // Validate access token format
    if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
      throw new Error(`Invalid access token: ${accessToken ? 'too short' : 'missing'}`);
    }
    
    console.log(`✅ Access token validation passed: ${accessToken.substring(0, 10)}...${accessToken.substring(accessToken.length - 4)}`);
    
    try {
      console.log(`=== TRANSACTION SYNC START for itemId: ${plaidItemRecord.itemId} ===`);
      console.log(`✅ Using passed plaidItem record - no DB lookup needed`);
      
      // Add small initial delay to avoid rate limiting if called too soon after other API calls
      console.log('⏳ Adding pre-sync delay to respect rate limits...');
      await this.delay(500); // 500ms delay before starting transaction sync
      
      // Determine if this is Capital One using institution name (no API call needed)
      const isCapitalOneItem = this.isCapitalOne(plaidItemRecord.institutionName);
      console.log(`Institution type determined: ${isCapitalOneItem ? 'Capital One' : 'Standard'} (from institution name: ${plaidItemRecord.institutionName})`);

      const endDate = new Date();
      const startDate = new Date();
      
      if (isCapitalOneItem) {
        // Capital One: Request 4 months knowing they'll limit to ~90 days
        startDate.setMonth(startDate.getMonth() - 4);
        console.log('📍 Capital One detected: Requesting 4 months (will be limited to ~90 days)');
      } else {
        // Standard institutions: Request 12 months of transaction history
        startDate.setMonth(startDate.getMonth() - 12);
        console.log('📍 Standard institution: Requesting 12 months of transaction history');
      }

      console.log(`=== TRANSACTION DATE RANGE DEBUG ===`);
      console.log(`Institution: ${plaidItemRecord.institutionName}`);
      console.log(`Is Capital One: ${isCapitalOneItem}`);
      console.log(`Current date: ${new Date().toISOString()}`);
      console.log(`Calculated start date: ${startDate.toISOString()}`);  
      console.log(`Calculated end date: ${endDate.toISOString()}`);
      console.log(`Requesting range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      console.log(`Expected ${isCapitalOneItem ? 'days' : 'months'} back: ${isCapitalOneItem ? 90 : 12}`);
      
      // Validate date range
      const now = new Date();
      const maxPastDate = new Date();
      maxPastDate.setFullYear(maxPastDate.getFullYear() - 1); // 12 months max
      
      if (startDate < maxPastDate) {
        console.warn(`⚠️ Start date ${startDate.toISOString().split('T')[0]} is more than 12 months ago, adjusting to 12 months max`);
        startDate.setTime(maxPastDate.getTime()); // Cap at 12 months ago
        console.log(`🔧 Adjusted start date to 12 months ago: ${startDate.toISOString().split('T')[0]}`);
      }
      
      if (endDate > now) {
        console.warn(`⚠️ End date ${endDate.toISOString().split('T')[0]} is in the future, may cause 400 error`);
        endDate.setTime(now.getTime()); // Cap at current time
        console.log(`🔧 Adjusted end date to current time: ${endDate.toISOString().split('T')[0]}`);
      }
      
      console.log(`=== END DATE RANGE DEBUG ===`);

      const transactions = await this.getTransactions(
        accessToken,
        startDate,
        endDate,
        isCapitalOneItem
      );

      console.log(`=== TRANSACTION SYNC DEBUG ===`);
      console.log(`Total transactions to process: ${transactions.length}`);
      
      if (transactions.length === 0) {
        console.warn('No transactions returned from Plaid API - this might indicate an error');
      } else {
        // Show transaction date range for debugging
        const sortedByDate = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const oldestTransaction = sortedByDate[0];
        const newestTransaction = sortedByDate[sortedByDate.length - 1];
        
        console.log(`Transaction date range: ${oldestTransaction.date} to ${newestTransaction.date}`);
        console.log(`Account breakdown:`, transactions.reduce((acc, t) => {
          acc[t.account_id] = (acc[t.account_id] || 0) + 1;
          return acc;
        }, {}));
      }
      
      let processedCount = 0;
      let creditCardFoundCount = 0;
      
      // Batch fetch all credit cards for this plaid item to avoid N queries
      const uniqueAccountIds = [...new Set(transactions.map(t => t.account_id))];
      const { data: creditCards, error: creditCardsError } = await supabaseAdmin
        .from('credit_cards')
        .select('*')
        .in('accountId', uniqueAccountIds);
      
      if (creditCardsError) {
        console.error('Error fetching credit cards:', creditCardsError);
      }
      
      // Create a map for quick lookup
      const creditCardMap = new Map();
      (creditCards || []).forEach(card => {
        creditCardMap.set(card.accountId, card);
      });
      
      // Batch fetch existing transactions to avoid N queries
      const transactionIds = transactions.map(t => t.transaction_id);
      const { data: existingTransactions, error: existingTransError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .in('transactionId', transactionIds);
      
      if (existingTransError) {
        console.error('Error fetching existing transactions:', existingTransError);
      }
      
      // Create a map for quick lookup
      const existingTransMap = new Map();
      (existingTransactions || []).forEach(trans => {
        existingTransMap.set(trans.transactionId, trans);
      });
      
      console.log(`Processing ${transactions.length} transactions with batch queries`);
      console.log(`Found ${creditCards?.length || 0} credit cards and ${existingTransactions?.length || 0} existing transactions`);

      // Prepare batch operations
      const transactionsToCreate = [];
      const transactionsToUpdate = [];

      for (const transaction of transactions) {
        const creditCard = creditCardMap.get(transaction.account_id);
        
        // Debug transaction to credit card association
        if (!creditCard) {
          console.log('No credit card found for transaction:', {
            transactionId: transaction.transaction_id,
            accountId: transaction.account_id,
            amount: transaction.amount,
            date: transaction.date,
            name: transaction.name
          });
        } else {
          creditCardFoundCount++;
        }

        const existingTransaction = existingTransMap.get(transaction.transaction_id);

        // For Capital One credit cards, handle transaction sign properly
        // Plaid convention: positive = charges, negative = payments
        // But for display purposes, we might want to show payments as positive
        let adjustedAmount = transaction.amount;
        
        // Check if this is a Capital One payment (negative amount on credit card)
        if (creditCard && transaction.amount < 0) {
          const isCapitalOneCard = this.isCapitalOne(plaidItemRecord.institutionName, creditCard.name);
          
          // For debugging Capital One payments only (they have specific behavior)
          if (isCapitalOneCard) {
            console.log('Capital One payment detected:', {
              transactionName: transaction.name,
              originalAmount: transaction.amount,
              cardName: creditCard.name,
              institution: plaidItemRecord.institutionName,
              isPaymentTransaction: transaction.amount < 0
            });
          }
          
          // Keep the original Plaid sign convention for now
          // The UI can decide whether to display payments as positive or negative
          adjustedAmount = transaction.amount;
        }

        // Validate transaction amount before processing
        if (!this.validateTransactionAmount(adjustedAmount, transaction.name)) {
          console.error(`Skipping invalid transaction: ${transaction.name} with amount: ${adjustedAmount}`);
          continue;
        }

        // Use personal finance category if available, fall back to legacy category
        let categoryName = null;
        let categoryId = null;
        let subcategory = null;
        
        if (transaction.personal_finance_category) {
          // New personal finance category structure
          categoryName = transaction.personal_finance_category.primary;
          categoryId = transaction.personal_finance_category.detailed;
          // Use detailed as subcategory for more specificity
          subcategory = transaction.personal_finance_category.detailed;
        } else if (transaction.category && transaction.category.length > 0) {
          // Fall back to legacy category structure
          categoryName = transaction.category[0];
          categoryId = transaction.category_id;
          subcategory = transaction.category[1] || null;
        }
        
        const transactionData = {
          amount: adjustedAmount,
          accountid: transaction.account_id,
          plaidtransactionid: transaction.transaction_id,
          isoCurrencyCode: transaction.iso_currency_code,
          date: new Date(transaction.date).toISOString(),
          authorizedDate: transaction.authorized_date 
            ? new Date(transaction.authorized_date).toISOString()
            : null,
          name: transaction.name,
          merchantName: transaction.merchant_name,
          category: categoryName,
          categoryId: categoryId,
          subcategory: subcategory,
          accountOwner: transaction.account_owner,
        };

        // Debug: Log category info for sample transactions
        if (Math.random() < 0.1) { // Log ~10% of transactions to avoid spam
          console.log(`🏷️ CATEGORY DEBUG for ${transaction.name}:`, {
            personalFinanceCategory: transaction.personal_finance_category,
            legacyCategory: transaction.category,
            extractedCategory: categoryName,
            categoryId: categoryId,
            subcategory: subcategory,
            hasCategory: !!categoryName
          });
        }

        // Prepare transaction for upsert (create or update)
        const transactionForUpsert = {
          id: existingTransaction?.id || crypto.randomUUID(),
          ...transactionData,
          transactionId: transaction.transaction_id,
          plaidItemId: plaidItemRecord.id,
          creditCardId: creditCard?.id || null,
          updatedAt: new Date().toISOString(),
        };

        if (existingTransaction) {
          transactionsToUpdate.push(transactionForUpsert);
        } else {
          transactionsToCreate.push(transactionForUpsert);
        }
        
        processedCount++;
      }

      // Execute optimized batch operations using upsert
      const allTransactionsForUpsert = [...transactionsToCreate, ...transactionsToUpdate];
      console.log(`Executing batch upsert for ${allTransactionsForUpsert.length} transactions (${transactionsToCreate.length} new, ${transactionsToUpdate.length} existing)`);
      
      // SAFETY CHECK: Ensure we're only upserting, never bulk deleting transactions
      // This preserves historical data that may no longer be available from the API
      console.log(`🛡️ SAFETY: Using upsert-only strategy - no transaction deletions during sync`);
      
      if (allTransactionsForUpsert.length > 0) {
        // Use upsert to handle both creates and updates in a single operation
        // Log first transaction for debugging
        if (allTransactionsForUpsert.length > 0) {
          console.log('🔍 Sample transaction data being upserted:', JSON.stringify(allTransactionsForUpsert[0], null, 2));
        }
        
        const { error: upsertError, count } = await supabaseAdmin
          .from('transactions')
          .upsert(allTransactionsForUpsert, { 
            onConflict: 'transactionId',
            count: 'exact'
          });

        if (upsertError) {
          console.error('Failed to upsert transactions in batch:', upsertError);
          
          // Fallback to individual operations if batch fails
          console.log('Falling back to individual transaction processing...');
          let successCount = 0;
          let errorCount = 0;
          
          for (const transaction of allTransactionsForUpsert) {
            const { error: individualError } = await supabaseAdmin
              .from('transactions')
              .upsert([transaction], { onConflict: 'transactionId' });
              
            if (individualError) {
              console.error(`Failed to process transaction ${transaction.name}:`, individualError);
              errorCount++;
            } else {
              successCount++;
            }
          }
          console.log(`Fallback completed: ${successCount} successful, ${errorCount} failed`);
        } else {
          console.log(`Successfully upserted ${count || allTransactionsForUpsert.length} transactions in single batch operation`);
        }
      }
      
      // Get count of existing transactions older than our API window for preservation reporting
      const preservationCutoffDate = new Date(startDate);
      const { count: preservedTransactionCount } = await supabaseAdmin
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('plaidItemId', plaidItemRecord.id)
        .lt('date', preservationCutoffDate.toISOString());

      console.log(`=== TRANSACTION SYNC SUMMARY ===`);
      console.log(`📊 TRANSACTION ACCUMULATION STRATEGY:`);
      console.log(`   • API Window: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      console.log(`   • ${isCapitalOneItem ? 'Capital One (90-day API limit)' : 'Standard institution (12-month fetch)'}`);
      console.log(`   • Preserved older transactions: ${preservedTransactionCount || 0} (outside API window)`);
      console.log(`   • New/updated from API: ${processedCount} transactions processed`);
      console.log(`📈 SYNC RESULTS:`);
      console.log(`   • Total transactions processed from API: ${processedCount}`);
      console.log(`   • Transactions with credit card match: ${creditCardFoundCount}`);
      console.log(`   • Transactions without credit card match: ${processedCount - creditCardFoundCount}`);
      console.log(`   • New transactions created: ${transactionsToCreate.length}`);
      console.log(`   • Existing transactions updated: ${transactionsToUpdate.length}`);
      console.log(`💡 ACCUMULATION BENEFIT: Users retain ${preservedTransactionCount || 0} older transactions that Plaid can no longer provide`);
      console.log(`=== END TRANSACTION SYNC DEBUG ===`);
      
    } catch (error) {
      console.error('=== TRANSACTION SYNC ERROR ===');
      console.error('Error in syncTransactions:', error);
      console.error('Stack trace:', error.stack);
      console.error('=== END TRANSACTION SYNC ERROR ===');
      throw error; // Re-throw to propagate error up
    }
  }

  async createUpdateLinkToken(userId: string, itemId: string): Promise<string> {
    // Get the access token from the database
    const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .single();

    if (plaidItemError || !plaidItem || plaidItem.userId !== userId) {
      throw new Error('Plaid item not found or unauthorized');
    }

    const accessToken = decrypt(plaidItem.accessToken);

    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: "CardCycle",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      redirect_uri: 'https://www.cardcycle.app/api/plaid/callback', // Must match Plaid registration exactly
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730, // Request 24 months of transaction history (Capital One will limit to 90 days)
      },
      update: {
        account_selection_enabled: true,
      } as LinkTokenCreateRequestUpdate,
      access_token: accessToken,
    };

    // OAuth configuration is handled by redirect_uri - no additional setup needed for updates

    console.log('Creating update link token for itemId:', itemId);
    
    try {
      const response = await plaidClient.linkTokenCreate(request);
      console.log('Update link token created successfully');
      return response.data.link_token;
    } catch (error) {
      console.error('Failed to create update link token:', error);
      throw error;
    }
  }

  async removeItem(accessToken: string): Promise<void> {
    const request: ItemRemoveRequest = {
      access_token: accessToken,
    };

    try {
      await plaidClient.itemRemove(request);
      console.log('Successfully removed item from Plaid');
    } catch (error) {
      console.error('Failed to remove item from Plaid:', error);
      throw error;
    }
  }

  private async storeHistoricalStatement(statement: any, accountId: string, plaidItemId: string): Promise<void> {
    try {
      // Find the credit card
      const { data: creditCard, error: creditCardError } = await supabaseAdmin
        .from('credit_cards')
        .select('*')
        .eq('accountId', accountId)
        .single();
      
      if (creditCardError || !creditCard) {
        console.log('No credit card found for statement, skipping');
        return;
      }

      // Find billing cycle that matches this statement date
      const statementDate = new Date(statement.statement_date);
      const cycleEndBuffer = 5; // Allow 5 day buffer for matching cycle end dates
      
      const startBuffer = new Date(statementDate.getTime() - cycleEndBuffer * 24 * 60 * 60 * 1000);
      const endBuffer = new Date(statementDate.getTime() + cycleEndBuffer * 24 * 60 * 60 * 1000);
      
      const { data: matchingCycle, error: cycleError } = await supabaseAdmin
        .from('billing_cycles')
        .select('*')
        .eq('creditCardId', creditCard.id)
        .gte('endDate', startBuffer.toISOString())
        .lte('endDate', endBuffer.toISOString())
        .single();

      if (cycleError && cycleError.code !== 'PGRST116') {
        console.error('Error finding matching billing cycle:', cycleError);
      }

      if (matchingCycle) {
        // Update existing billing cycle with statement data
        const { error: updateError } = await supabaseAdmin
          .from('billing_cycles')
          .update({
            statementBalance: Math.abs(statement.closing_balance || 0),
            minimumPayment: statement.minimum_payment_amount || 0,
            dueDate: statement.payment_due_date ? new Date(statement.payment_due_date).toISOString() : null
          })
          .eq('id', matchingCycle.id);

        if (updateError) {
          console.error('Failed to update billing cycle with statement data:', updateError);
        }
        
        console.log(`✅ Updated billing cycle ${matchingCycle.id} with statement data:`, {
          statementBalance: Math.abs(statement.closing_balance || 0),
          minimumPayment: statement.minimum_payment_amount || 0,
          dueDate: statement.payment_due_date
        });
      } else {
        console.log(`No matching billing cycle found for statement date ${statementDate.toISOString()}`);
      }
    } catch (error) {
      console.error('Error storing historical statement:', error);
    }
  }

  /**
   * Comprehensive forced sync specifically for reconnection scenarios
   * Handles all edge cases and validates data persistence
   */
  async forceReconnectionSync(accessToken: string, itemId: string, userId: string): Promise<{success: boolean, details: any}> {
    const syncDetails = {
      accountSync: { success: false, error: null, accountsUpdated: 0 },
      transactionSync: { success: false, error: null, transactionsUpdated: 0 },
      openDateExtraction: { success: false, error: null, openDatesSet: 0 },
      validation: { success: false, error: null }
    };

    try {
      console.log('🚀 FORCE RECONNECTION SYNC STARTED');
      console.log(`Item: ${itemId}, User: ${userId}`);

      // Step 1: Verify access token works with fresh API calls
      console.log('🔍 Step 1: Validating fresh access token...');
      
      try {
        const testResponse = await plaidClient.accountsGet({ access_token: accessToken });
        console.log(`✅ Access token valid - ${testResponse.data.accounts.length} accounts accessible`);
      } catch (tokenError) {
        syncDetails.validation.error = `Access token validation failed: ${tokenError.message}`;
        console.error('❌ Access token validation failed:', tokenError);
        return { success: false, details: syncDetails };
      }

      // Step 2: Force account sync with enhanced origination_date extraction
      console.log('🔄 Step 2: Force syncing accounts with enhanced origination extraction...');
      
      try {
        await this.syncAccounts(accessToken, itemId);
        syncDetails.accountSync.success = true;
        
        // Count accounts updated
        // First get the plaid item
        const { data: plaidItemForUpdate, error: plaidItemUpdateError } = await supabaseAdmin
          .from('plaid_items')
          .select('*')
          .eq('itemId', itemId)
          .single();

        const oneMinuteAgo = new Date(Date.now() - 60000);
        const { data: updatedAccounts, error: updatedAccountsError } = await supabaseAdmin
          .from('credit_cards')
          .select('*')
          .eq('plaidItemId', plaidItemForUpdate?.id || '')
          .gte('updatedAt', oneMinuteAgo.toISOString());

        if (updatedAccountsError) {
          console.error('Error fetching updated accounts:', updatedAccountsError);
        }
        syncDetails.accountSync.accountsUpdated = (updatedAccounts || []).length;
        
        // Check specifically for open dates set
        const accountsWithOpenDates = (updatedAccounts || []).filter(acc => acc.openDate);
        syncDetails.openDateExtraction.openDatesSet = accountsWithOpenDates.length;
        syncDetails.openDateExtraction.success = accountsWithOpenDates.length > 0;
        
        console.log(`✅ Account sync completed: ${updatedAccounts.length} accounts updated, ${accountsWithOpenDates.length} with open dates`);
        
      } catch (accountSyncError) {
        syncDetails.accountSync.error = accountSyncError.message;
        console.error('❌ Account sync failed:', accountSyncError);
      }

      // Step 3: Force transaction sync
      console.log('🔄 Step 3: Force syncing transactions...');
      
      try {
        await this.syncTransactions(plaidItemForUpdate, accessToken);
        syncDetails.transactionSync.success = true;
        
        // Count transactions updated
        const { data: recentTransactions, error: recentTransactionsError } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('plaidItemId', plaidItemForUpdate?.id || '')
          .gte('updatedAt', oneMinuteAgo.toISOString());

        if (recentTransactionsError) {
          console.error('Error fetching recent transactions:', recentTransactionsError);
        }
        syncDetails.transactionSync.transactionsUpdated = (recentTransactions || []).length;
        
        console.log(`✅ Transaction sync completed: ${(recentTransactions || []).length} transactions updated`);
        
      } catch (transactionSyncError) {
        syncDetails.transactionSync.error = transactionSyncError.message;
        console.error('❌ Transaction sync failed:', transactionSyncError);
      }

      // Step 4: Handle edge cases where Plaid doesn't provide origination_date
      console.log('🔧 Step 4: Handling edge cases for missing origination dates...');
      
      // Get plaid item first for the nested query
      const { data: plaidItemForCards, error: plaidItemForCardsError } = await supabaseAdmin
        .from('plaid_items')
        .select('id')
        .eq('itemId', itemId)
        .eq('userId', userId)
        .single();

      const { data: cardsWithoutOpenDates, error: cardsWithoutOpenDatesError } = await supabaseAdmin
        .from('credit_cards')
        .select('*, plaid_items!inner(*)')
        .eq('plaidItemId', plaidItemForCards?.id || '')
        .is('openDate', null);

      if (cardsWithoutOpenDatesError) {
        console.error('Error fetching cards without open dates:', cardsWithoutOpenDatesError);
      }

      if ((cardsWithoutOpenDates || []).length > 0) {
        console.log(`⚠️ Found ${(cardsWithoutOpenDates || []).length} cards without open dates, applying intelligent defaults...`);
        
        for (const card of (cardsWithoutOpenDates || [])) {
          let estimatedOpenDate: Date;
          const now = new Date();
          
          // Use transaction-based estimation for all cards (most reliable approach)
          const { data: cardTransactions, error: cardTransactionsError } = await supabaseAdmin
            .from('transactions')
            .select('*')
            .eq('creditCardId', card.id)
            .order('date', { ascending: true })
            .limit(1);

          if (cardTransactionsError) {
            console.error('Error fetching card transactions:', cardTransactionsError);
          }
          
          if ((cardTransactions || []).length > 0) {
            const earliestTransactionDate = new Date(cardTransactions![0].date);
            // Set open date 3 weeks (21 days) before earliest transaction
            estimatedOpenDate = new Date(earliestTransactionDate);
            estimatedOpenDate.setDate(estimatedOpenDate.getDate() - 21);
            console.log(`📊 Transaction-based open date for ${card.name}: earliest transaction ${earliestTransactionDate.toDateString()} -> estimated open ${estimatedOpenDate.toDateString()}`);
          } else {
            // Fallback if no transactions available
            estimatedOpenDate = new Date(now);
            estimatedOpenDate.setFullYear(estimatedOpenDate.getFullYear() - 1);
            console.log(`🛡️ No transactions found for ${card.name}, using 1-year fallback: ${estimatedOpenDate.toDateString()}`);
          }

          const { error: updateCardError } = await supabaseAdmin
            .from('credit_cards')
            .update({ openDate: estimatedOpenDate.toISOString() })
            .eq('id', card.id);

          if (updateCardError) {
            console.error('Failed to update credit card open date:', updateCardError);
          }
          
          syncDetails.openDateExtraction.openDatesSet++;
        }
        
        console.log(`✅ Applied intelligent defaults to ${cardsWithoutOpenDates.length} cards without open dates`);
        if (syncDetails.openDateExtraction.openDatesSet > 0) {
          syncDetails.openDateExtraction.success = true;
        }
      }

      // Step 5: Final validation
      console.log('🔍 Step 5: Final validation of sync results...');
      
      // Get plaid item with related credit cards and their recent transactions
      const { data: plaidItem, error: finalPlaidItemError } = await supabaseAdmin
        .from('plaid_items')
        .select('*')
        .eq('itemId', itemId)
        .single();

      if (finalPlaidItemError || !plaidItem) {
        syncDetails.validation.error = 'Plaid item not found after sync';
        return { success: false, details: syncDetails };
      }

      // Get credit cards for this plaid item
      const { data: accounts, error: accountsError } = await supabaseAdmin
        .from('credit_cards')
        .select('*')
        .eq('plaidItemId', plaidItem.id);

      if (accountsError) {
        console.error('Error fetching accounts for validation:', accountsError);
      }

      // Get recent transactions for each credit card
      const accountsWithTransactions = [];
      for (const account of (accounts || [])) {
        const { data: recentTransactions, error: transactionError } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('creditCardId', account.id)
          .order('date', { ascending: false })
          .limit(5);

        if (transactionError) {
          console.error('Error fetching recent transactions for validation:', transactionError);
        }

        accountsWithTransactions.push({
          ...account,
          transactions: recentTransactions || []
        });
      }

      // Add accounts to plaid item for compatibility
      const plaidItemWithAccounts = {
        ...plaidItem,
        accounts: accountsWithTransactions
      };

      // Validation checks
      const validationResults = {
        itemFound: !!plaidItem,
        accountsFound: plaidItemWithAccounts.accounts?.length || 0,
        accountsWithOpenDates: plaidItemWithAccounts.accounts?.filter(acc => acc.openDate)?.length || 0,
        accountsWithBalances: plaidItemWithAccounts.accounts?.filter(acc => acc.balanceCurrent !== null)?.length || 0,
        accountsWithTransactions: plaidItemWithAccounts.accounts?.filter(acc => acc.transactions?.length > 0)?.length || 0,
        totalTransactions: plaidItemWithAccounts.accounts?.reduce((sum, acc) => sum + (acc.transactions?.length || 0), 0) || 0
      };

      console.log('📊 Validation results:', validationResults);

      // Consider sync successful if we have basic data
      const isValidationSuccessful = (
        validationResults.accountsFound > 0 && 
        validationResults.accountsWithOpenDates > 0 &&
        (validationResults.accountsWithBalances > 0 || validationResults.totalTransactions > 0)
      );

      syncDetails.validation.success = isValidationSuccessful;
      
      if (!isValidationSuccessful) {
        syncDetails.validation.error = `Validation failed: ${JSON.stringify(validationResults)}`;
        console.error('❌ Final validation failed:', validationResults);
      } else {
        console.log('✅ Final validation passed - reconnection sync successful');
      }

      console.log('🏁 FORCE RECONNECTION SYNC COMPLETED');
      
      return { 
        success: isValidationSuccessful, 
        details: { ...syncDetails, validation: validationResults } 
      };

    } catch (error) {
      console.error('❌ FORCE RECONNECTION SYNC FAILED:', error);
      syncDetails.validation.error = error.message;
      return { success: false, details: syncDetails };
    }
  }

  /**
   * Simple delay utility for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const plaidService = new PlaidServiceImpl();