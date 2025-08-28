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
  WebhookVerificationKeyGetRequest
} from 'plaid';

export interface PlaidService {
  createLinkToken(userId: string): Promise<string>;
  exchangePublicToken(publicToken: string, userId: string): Promise<string>;
  getTransactions(accessToken: string, startDate: Date, endDate: Date): Promise<any[]>;
  getLiabilities(accessToken: string): Promise<any>;
  getBalances(accessToken: string): Promise<any>;
  getStatements(accessToken: string, accountId: string): Promise<any[]>;
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
      // Remove guest access and ensure all institutions are visible
      link_customization_name: 'default',
      account_filters: {
        liabilities: {
          account_subtypes: ['credit card']
        }
      },
      // Force authentication - no guest access
      required_if_supported_auth_type_codes: ['credential', 'selection'],
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
      const request: TransactionsGetRequest = {
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        count: 500,
      };

      const response = await plaidClient.transactionsGet(request);
      return response.data.transactions;
    } catch (error) {
      console.error('Error fetching transactions:', error);
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

        const existingCard = await prisma.creditCard.findUnique({
          where: { accountId: account.account_id },
        });

        const cardData = {
          name: account.name,
          officialName: account.official_name,
          subtype: account.subtype,
          mask: account.mask,
          balanceCurrent: account.balances.current,
          balanceAvailable: account.balances.available,
          balanceLimit: account.balances.limit,
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
    const plaidItem = await prisma.plaidItem.findUnique({
      where: { itemId },
    });

    if (!plaidItem) {
      throw new Error('Plaid item not found');
    }

    const decryptedAccessToken = decrypt(plaidItem.accessToken);
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 24);

    const transactions = await this.getTransactions(
      decryptedAccessToken,
      startDate,
      endDate
    );

    for (const transaction of transactions) {
      const creditCard = await prisma.creditCard.findUnique({
        where: { accountId: transaction.account_id },
      });

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
      } else {
        await prisma.transaction.create({
          data: {
            ...transactionData,
            transactionId: transaction.transaction_id,
            plaidItemId: plaidItem.id,
            creditCardId: creditCard?.id || null,
          },
        });
      }
    }
  }
}

export const plaidService = new PlaidServiceImpl();