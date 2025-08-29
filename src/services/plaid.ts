import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/db';
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
  createLinkToken(userId: string): Promise<string>;
  createUpdateLinkToken(userId: string, itemId: string): Promise<string>;
  exchangePublicToken(publicToken: string, userId: string): Promise<string>;
  removeItem(accessToken: string): Promise<void>;
  getAccounts(accessToken: string): Promise<any>;
  getTransactions(accessToken: string, startDate: Date, endDate: Date): Promise<any[]>;
  getLiabilities(accessToken: string): Promise<any>;
  getBalances(accessToken: string): Promise<any>;
  getStatements(accessToken: string, accountId: string): Promise<any[]>;
  syncAccounts(accessToken: string, itemId: string): Promise<void>;
  syncTransactions(itemId: string, accessToken: string): Promise<void>;
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
  async createLinkToken(userId: string): Promise<string> {
    const isSandbox = process.env.PLAID_ENV === 'sandbox';
    
    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: "Credit Card Tracker",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730, // Request 24 months of transaction history (Capital One will limit to 90 days)
      },
    };

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

  async exchangePublicToken(publicToken: string, userId: string): Promise<string> {
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

    await prisma.plaidItem.create({
      data: {
        userId,
        itemId: item_id,
        accessToken: encrypt(access_token),
        institutionId,
        institutionName,
      },
    });

    await this.syncAccounts(access_token, item_id);
    
    return access_token;
  }

  async getTransactions(accessToken: string, startDate: Date, endDate: Date): Promise<any[]> {
    try {
      console.log(`=== GET TRANSACTIONS DEBUG ===`);
      console.log('Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]);
      
      // Check if this is Capital One by testing the access token first
      let isCapitalOne = false;
      try {
        const testResponse = await plaidClient.accountsGet({ access_token: accessToken });
        isCapitalOne = testResponse.data.accounts.some((acc: any) => 
          this.isCapitalOne(undefined, acc.name)
        );
      } catch (error) {
        console.warn('Could not determine institution type:', error);
      }

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
      
      // Use optimized chunking strategy
      const allTransactions: any[] = [];
      const chunkSize = isCapitalOne ? 90 : 30; // Use 90-day chunks for Capital One, 30-day for others
      
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
          count: 500, // Request max transactions per call
          offset: 0
        };

        const response = await plaidClient.transactionsGet(request);
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
      const response = await plaidClient.liabilitiesGet(request);
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
      const response = await plaidClient.accountsBalanceGet(request);
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
        
        const fallbackResponse = await plaidClient.accountsBalanceGet(fallbackRequest);
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
      const response = await plaidClient.accountsGet(request);
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

  async syncAccounts(accessToken: string, itemId: string): Promise<void> {
    console.log(`🔄 Starting syncAccounts for itemId: ${itemId}`);
    
    const liabilitiesData = await this.getLiabilities(accessToken);
    const balancesData = await this.getBalances(accessToken);
    const accountsData = await this.getAccounts(accessToken);

    console.log('📊 Plaid API call results:', {
      liabilitiesAccounts: liabilitiesData?.accounts?.length || 0,
      liabilitiesCredit: liabilitiesData?.liabilities?.credit?.length || 0,
      balancesAccounts: balancesData?.accounts?.length || 0,
      accountsData: accountsData?.accounts?.length || 0
    });

    const plaidItem = await prisma.plaidItem.findUnique({
      where: { itemId },
    });

    if (!plaidItem) {
      throw new Error('Plaid item not found');
    }
    
    console.log(`🏦 Processing accounts for ${plaidItem.institutionName}`);
    const isCapitalOneInstitution = this.isCapitalOne(plaidItem.institutionName);

    for (const account of liabilitiesData.accounts) {
      if (account.subtype === 'credit card') {
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

        const existingCard = await prisma.creditCard.findUnique({
          where: { accountId: account.account_id },
        });

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

        // Debug logging for credit limits
        console.log('=== FULL PLAID RESPONSE DEBUG for', account.name, '===');
        console.log('Institution:', plaidItem.institutionName);
        console.log('Is Capital One:', isCapitalOne);
        console.log('Liabilities Account:', JSON.stringify(account, null, 2));
        console.log('Balance Account:', JSON.stringify(balanceAccount, null, 2));
        console.log('Accounts Account (NEW):', JSON.stringify(accountsAccount, null, 2));
        console.log('Liability Data:', JSON.stringify(liability, null, 2));
        
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
        };

        if (existingCard) {
          await prisma.creditCard.update({
            where: { id: existingCard.id },
            data: cardData,
          });
        } else {
          await prisma.creditCard.create({
            data: {
              ...cardData,
              accountId: account.account_id,
              plaidItemId: plaidItem.id,
            },
          });
        }

        // Sync historical statements now that we have PRODUCT_STATEMENTS consent
        console.log(`=== STATEMENT SYNC START for ${account.name} ===`);
        try {
          const statements = await this.getStatements(accessToken, account.account_id);
          console.log(`Found ${statements.length} statements for ${account.name}`);
          
          for (const statement of statements) {
            await this.storeHistoricalStatement(statement, account.account_id, plaidItem.id);
          }
          console.log(`=== STATEMENT SYNC COMPLETED for ${account.name} ===`);
        } catch (error) {
          console.error(`=== STATEMENT SYNC ERROR for ${account.name}:`, error);
        }

        if (liability?.aprs) {
          await prisma.aPR.deleteMany({
            where: { creditCard: { accountId: account.account_id } },
          });

          for (const apr of liability.aprs) {
            await prisma.aPR.create({
              data: {
                aprType: apr.apr_type,
                aprPercentage: apr.apr_percentage,
                balanceSubjectToApr: apr.balance_subject_to_apr,
                interestChargeAmount: apr.interest_charge_amount,
                creditCard: {
                  connect: { accountId: account.account_id },
                },
              },
            });
          }
        }
      }
    }
  }

  async syncTransactions(itemId: string, accessToken: string): Promise<void> {
    console.log('🚀 TRANSACTION SYNC METHOD CALLED!', { itemId, hasAccessToken: !!accessToken });
    try {
      console.log(`=== TRANSACTION SYNC START for itemId: ${itemId} ===`);
      
      const plaidItem = await prisma.plaidItem.findUnique({
        where: { itemId },
      });

      if (!plaidItem) {
        console.error(`No Plaid item found for itemId: ${itemId}`);
        throw new Error('Plaid item not found');
      }

      console.log(`Found Plaid item for ${plaidItem.institutionName} (${itemId})`);
      console.log('✅ Using already decrypted access token from sync route');
      
      // Determine if this is Capital One and adjust date range accordingly
      let isCapitalOneItem = false;
      try {
        const testResponse = await plaidClient.accountsGet({ access_token: accessToken });
        isCapitalOneItem = testResponse.data.accounts.some((acc: any) => 
          this.isCapitalOne(undefined, acc.name)
        ) || this.isCapitalOne(plaidItem.institutionName);
      } catch (error) {
        console.warn('Could not determine institution type, checking institution name...');
        isCapitalOneItem = this.isCapitalOne(plaidItem.institutionName);
      }

      const endDate = new Date();
      const startDate = new Date();
      
      if (isCapitalOneItem) {
        // Capital One: Only 90 days of history available
        startDate.setDate(startDate.getDate() - 90);
        console.log('📍 Capital One detected: Using 90-day transaction window');
      } else {
        // Other institutions: 24 months to match Link configuration
        startDate.setMonth(startDate.getMonth() - 24);
        console.log('📍 Standard institution: Using 24-month transaction window');
      }

      console.log(`=== TRANSACTION DATE RANGE DEBUG ===`);
      console.log(`Institution: ${plaidItem.institutionName}`);
      console.log(`Is Capital One: ${isCapitalOneItem}`);
      console.log(`Current date: ${new Date().toISOString()}`);
      console.log(`Calculated start date: ${startDate.toISOString()}`);  
      console.log(`Calculated end date: ${endDate.toISOString()}`);
      console.log(`Requesting range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      console.log(`Expected ${isCapitalOneItem ? 'days' : 'months'} back: ${isCapitalOneItem ? 90 : Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30))}`);
      console.log(`=== END DATE RANGE DEBUG ===`);

      const transactions = await this.getTransactions(
        accessToken,
        startDate,
        endDate
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
      
      for (const transaction of transactions) {
        const creditCard = await prisma.creditCard.findUnique({
          where: { accountId: transaction.account_id },
        });

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

        const existingTransaction = await prisma.transaction.findUnique({
          where: { transactionId: transaction.transaction_id },
        });

        const transactionData = {
          amount: transaction.amount,
          isoCurrencyCode: transaction.iso_currency_code,
          date: new Date(transaction.date),
          authorizedDate: transaction.authorized_date 
            ? new Date(transaction.authorized_date) 
            : null,
          name: transaction.name,
          merchantName: transaction.merchant_name,
          category: transaction.category?.[0] || null,
          categoryId: transaction.category_id,
          subcategory: transaction.category?.[1] || null,
          accountOwner: transaction.account_owner,
        };

        if (existingTransaction) {
          await prisma.transaction.update({
            where: { id: existingTransaction.id },
            data: transactionData,
          });
          console.log(`Updated transaction: ${transaction.name} (${transaction.amount})`);
        } else {
          await prisma.transaction.create({
            data: {
              ...transactionData,
              transactionId: transaction.transaction_id,
              plaidItemId: plaidItem.id,
              creditCardId: creditCard?.id || null,
            },
          });
          console.log(`Created transaction: ${transaction.name} (${transaction.amount})`);
        }
        
        processedCount++;
      }
      
      console.log(`=== TRANSACTION SYNC SUMMARY ===`);
      console.log(`Total transactions processed: ${processedCount}`);
      console.log(`Transactions with credit card match: ${creditCardFoundCount}`);
      console.log(`Transactions without credit card match: ${processedCount - creditCardFoundCount}`);
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
    const plaidItem = await prisma.plaidItem.findUnique({
      where: { itemId },
    });

    if (!plaidItem || plaidItem.userId !== userId) {
      throw new Error('Plaid item not found or unauthorized');
    }

    const accessToken = decrypt(plaidItem.accessToken);

    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: "Credit Card Tracker",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730, // Request 24 months of transaction history (Capital One will limit to 90 days)
      },
      update: {
        account_selection_enabled: true,
      } as LinkTokenCreateRequestUpdate,
      access_token: accessToken,
    };

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
      const creditCard = await prisma.creditCard.findUnique({
        where: { accountId: accountId }
      });
      
      if (!creditCard) {
        console.log('No credit card found for statement, skipping');
        return;
      }

      // Find billing cycle that matches this statement date
      const statementDate = new Date(statement.statement_date);
      const cycleEndBuffer = 5; // Allow 5 day buffer for matching cycle end dates
      
      const matchingCycle = await prisma.billingCycle.findFirst({
        where: {
          creditCardId: creditCard.id,
          endDate: {
            gte: new Date(statementDate.getTime() - cycleEndBuffer * 24 * 60 * 60 * 1000),
            lte: new Date(statementDate.getTime() + cycleEndBuffer * 24 * 60 * 60 * 1000)
          }
        }
      });

      if (matchingCycle) {
        // Update existing billing cycle with statement data
        await prisma.billingCycle.update({
          where: { id: matchingCycle.id },
          data: {
            statementBalance: Math.abs(statement.closing_balance || 0),
            minimumPayment: statement.minimum_payment_amount || 0,
            dueDate: statement.payment_due_date ? new Date(statement.payment_due_date) : null
          }
        });
        
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
}

export const plaidService = new PlaidServiceImpl();