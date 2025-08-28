import { plaidClient } from '@/lib/plaid';
import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/encryption';
import { 
  TransactionsGetRequest,
  LiabilitiesGetRequest,
  StatementsListRequest,
  AccountsBalanceGetRequest,
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
  getTransactions(accessToken: string, startDate: Date, endDate: Date): Promise<any[]>;
  getLiabilities(accessToken: string): Promise<any>;
  getBalances(accessToken: string): Promise<any>;
  getStatements(accessToken: string, accountId: string): Promise<any[]>;
  syncAccounts(accessToken: string, itemId: string): Promise<void>;
  syncTransactions(itemId: string): Promise<void>;
}

class PlaidServiceImpl implements PlaidService {
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
    };

    console.log('Creating link token for environment:', process.env.PLAID_ENV);
    console.log('Request payload:', JSON.stringify(request, null, 2));
    
    try {
      const response = await plaidClient.linkTokenCreate(request);
      console.log('Link token created successfully');
      return response.data.link_token;
    } catch (error) {
      console.error('Failed to create link token:', error);
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
      
      const request: TransactionsGetRequest = {
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        count: 500,
      };

      console.log('Calling Plaid transactionsGet...');
      const response = await plaidClient.transactionsGet(request);
      console.log('Plaid transactionsGet response:', response.data.transactions.length, 'transactions');
      console.log('Sample transactions:', response.data.transactions.slice(0, 3).map(t => ({
        id: t.transaction_id,
        account_id: t.account_id,
        amount: t.amount,
        date: t.date,
        name: t.name
      })));
      console.log(`=== END GET TRANSACTIONS DEBUG ===`);
      
      return response.data.transactions;
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
    const request: LiabilitiesGetRequest = {
      access_token: accessToken,
    };

    const response = await plaidClient.liabilitiesGet(request);
    return response.data;
  }

  async getBalances(accessToken: string): Promise<any> {
    try {
      const request: AccountsBalanceGetRequest = {
        access_token: accessToken,
      };

      const response = await plaidClient.accountsBalanceGet(request);
      return response.data;
    } catch (error) {
      console.error('Error fetching balances:', error);
      return { accounts: [] }; // Return empty accounts on error
    }
  }

  async getStatements(accessToken: string, accountId: string): Promise<any[]> {
    const request: StatementsListRequest = {
      access_token: accessToken,
      account_id: accountId,
    };

    const response = await plaidClient.statementsList(request);
    return response.data.statements;
  }

  async syncAccounts(accessToken: string, itemId: string): Promise<void> {
    const liabilitiesData = await this.getLiabilities(accessToken);
    const balancesData = await this.getBalances(accessToken);

    const plaidItem = await prisma.plaidItem.findUnique({
      where: { itemId },
    });

    if (!plaidItem) {
      throw new Error('Plaid item not found');
    }

    for (const account of liabilitiesData.accounts) {
      if (account.subtype === 'credit card') {
        const liability = liabilitiesData.liabilities.credit.find(
          (c: any) => c.account_id === account.account_id
        );

        // Find corresponding balance data which might have more complete limit info
        const balanceAccount = balancesData.accounts.find(
          (a: any) => a.account_id === account.account_id
        );

        const existingCard = await prisma.creditCard.findUnique({
          where: { accountId: account.account_id },
        });

        // Try multiple sources for credit limit - prioritize liability data for Capital One
        let creditLimit = null;
        
        // For Capital One, try liability sources first since balances endpoint often fails
        const isCapitalOne = account.name?.toLowerCase().includes('capital one') || 
                           account.name?.toLowerCase().includes('quicksilver') ||
                           account.name?.toLowerCase().includes('venture');
        
        if (isCapitalOne && liability) {
          console.log('Capital One detected, trying liability sources first...');
          
          // Try liability limit_current field first
          if (liability.limit_current && liability.limit_current > 0) {
            creditLimit = liability.limit_current;
            console.log('Using liability.limit_current:', creditLimit);
          }
          
          // Try liability.limit field
          else if (liability.limit && liability.limit > 0) {
            creditLimit = liability.limit;
            console.log('Using liability.limit:', creditLimit);
          }
          
          // Try balances within liability
          else if (liability.balances?.limit && liability.balances.limit > 0) {
            creditLimit = liability.balances.limit;
            console.log('Using liability.balances.limit:', creditLimit);
          }
          
          // Try APR balance_subject_to_apr as last resort
          else if (liability.aprs && liability.aprs.length > 0) {
            const aprLimit = liability.aprs.find((apr: any) => apr.balance_subject_to_apr && apr.balance_subject_to_apr > 0)?.balance_subject_to_apr;
            if (aprLimit) {
              creditLimit = aprLimit;
              console.log('Using APR balance_subject_to_apr:', creditLimit);
            }
          }
        }
        
        // Fallback to standard balance sources for non-Capital One or if liability failed
        if (!creditLimit || creditLimit <= 0) {
          creditLimit = balanceAccount?.balances?.limit ?? account.balances.limit;
          
          // Try balances.available + balances.current (total credit line)
          if ((!creditLimit || creditLimit <= 0) && balanceAccount?.balances) {
            const available = balanceAccount.balances.available ?? account.balances.available;
            const current = Math.abs(balanceAccount.balances.current ?? account.balances.current ?? 0);
            if (available && available > 0) {
              creditLimit = available + current;
              console.log('Using calculated limit (available + current):', creditLimit);
            }
          }
        }

        // Debug logging for credit limits
        console.log('=== FULL PLAID RESPONSE DEBUG for', account.name, '===');
        console.log('Liabilities Account:', JSON.stringify(account, null, 2));
        console.log('Balance Account:', JSON.stringify(balanceAccount, null, 2));
        console.log('Liability Data:', JSON.stringify(liability, null, 2));
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

        // For Capital One, use liability balance data if account.balances is missing/empty
        const currentBalance = (isCapitalOne && liability?.balances?.current !== undefined) 
          ? liability.balances.current 
          : (balanceAccount?.balances?.current ?? account.balances.current);
          
        const availableBalance = (isCapitalOne && liability?.balances?.available !== undefined)
          ? liability.balances.available
          : (balanceAccount?.balances?.available ?? account.balances.available);

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

  async syncTransactions(itemId: string): Promise<void> {
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
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 24);

      console.log(`Fetching transactions from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      const transactions = await this.getTransactions(
        decryptedAccessToken,
        startDate,
        endDate
      );

      console.log(`=== TRANSACTION SYNC DEBUG ===`);
      console.log(`Total transactions to process: ${transactions.length}`);
      
      if (transactions.length === 0) {
        console.warn('No transactions returned from Plaid API - this might indicate an error');
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
    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: "Credit Card Tracker",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      update: {
        account_selection_enabled: true,
      } as LinkTokenCreateRequestUpdate,
      access_token: itemId, // This should be the access token, but we'll handle it in the calling code
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
}

export const plaidService = new PlaidServiceImpl();