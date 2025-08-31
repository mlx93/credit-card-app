import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';

export async function POST() {
  try {
    console.log('🔍 PLAID API EXPLORER ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all Plaid items for the user
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    // Get all credit cards for these plaid items
    const plaidItemIds = (plaidItems || []).map(item => item.id);
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, accountId, name, openDate, plaidItemId')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    console.log(`Found ${plaidItems.length} Plaid items`);

    const results = [];

    for (const item of plaidItems) {
      console.log(`\n=== EXPLORING PLAID ITEM: ${item.institutionName} ===`);
      
      const itemResult = {
        institutionName: item.institutionName,
        itemId: item.itemId,
        status: item.status,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        lastSyncAt: item.lastSyncAt,
        accounts: [] as any[],
        apiCalls: {} as any,
        errors: [] as any[]
      };
      
      try {
        const decryptedAccessToken = decrypt(item.accessToken);
        console.log(`Decrypted access token for ${item.institutionName}: ${decryptedAccessToken ? 'SUCCESS' : 'FAILED'}`);
        
        // Test 1: Basic accounts call
        try {
          console.log('Testing accounts API...');
          const accountsResponse = await plaidClient.accountsGet({ 
            access_token: decryptedAccessToken 
          });
          
          itemResult.apiCalls.accounts = {
            success: true,
            accountCount: accountsResponse.data.accounts.length,
            accounts: accountsResponse.data.accounts.map(acc => ({
              account_id: acc.account_id,
              name: acc.name,
              type: acc.type,
              subtype: acc.subtype,
              mask: acc.mask,
              balances: acc.balances
            }))
          };
          
          console.log(`Accounts API: SUCCESS - Found ${accountsResponse.data.accounts.length} accounts`);
        } catch (error) {
          console.error('Accounts API failed:', error);
          itemResult.apiCalls.accounts = {
            success: false,
            error: {
              error_code: error.error_code,
              error_type: error.error_type,
              message: error.message,
              status: error.response?.status
            }
          };
          itemResult.errors.push(`Accounts API: ${error.error_code} - ${error.message}`);
        }
        
        // Test 2: Liabilities call (this contains origination_date)
        try {
          console.log('Testing liabilities API...');
          const liabilitiesResponse = await plaidClient.liabilitiesGet({ 
            access_token: decryptedAccessToken 
          });
          
          const creditLiabilities = liabilitiesResponse.data.liabilities?.credit || [];
          
          itemResult.apiCalls.liabilities = {
            success: true,
            creditCount: creditLiabilities.length,
            credit: creditLiabilities.map(liability => ({
              account_id: liability.account_id,
              origination_date: liability.origination_date, // The key field we need!
              last_statement_issue_date: liability.last_statement_issue_date,
              last_statement_balance: liability.last_statement_balance,
              minimum_payment_amount: liability.minimum_payment_amount,
              next_payment_due_date: liability.next_payment_due_date,
              balances: liability.balances,
              // Parse the origination_date
              parsed_origination_date: liability.origination_date ? {
                raw: liability.origination_date,
                parsed: new Date(liability.origination_date).toISOString(),
                dateString: new Date(liability.origination_date).toDateString(),
                isValid: !isNaN(new Date(liability.origination_date).getTime())
              } : null
            }))
          };
          
          console.log(`Liabilities API: SUCCESS - Found ${creditLiabilities.length} credit liabilities`);
          creditLiabilities.forEach(liability => {
            console.log(`  Account ${liability.account_id}: origination_date = ${liability.origination_date}`);
          });
        } catch (error) {
          console.error('Liabilities API failed:', error);
          itemResult.apiCalls.liabilities = {
            success: false,
            error: {
              error_code: error.error_code,
              error_type: error.error_type,
              message: error.message,
              status: error.response?.status
            }
          };
          itemResult.errors.push(`Liabilities API: ${error.error_code} - ${error.message}`);
        }
        
        // Test 3: Get first transaction for fallback estimation
        try {
          console.log('Testing transactions API for first transaction...');
          const oneYearAgo = new Date();
          oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 2); // Go back 2 years to find earliest
          
          const transactionsResponse = await plaidClient.transactionsGet({
            access_token: decryptedAccessToken,
            start_date: oneYearAgo.toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0],
            count: 500 // Get more transactions to find the earliest
          });
          
          // Group transactions by account and find earliest for each
          const accountTransactions = {};
          transactionsResponse.data.transactions.forEach(txn => {
            const accountId = txn.account_id;
            if (!accountTransactions[accountId]) {
              accountTransactions[accountId] = [];
            }
            accountTransactions[accountId].push(txn);
          });
          
          // Find earliest transaction per account
          const earliestByAccount = {};
          Object.keys(accountTransactions).forEach(accountId => {
            const transactions = accountTransactions[accountId];
            const earliest = transactions.reduce((earliest, current) => {
              return new Date(current.date) < new Date(earliest.date) ? current : earliest;
            });
            earliestByAccount[accountId] = earliest;
          });
          
          itemResult.apiCalls.transactions = {
            success: true,
            totalTransactions: transactionsResponse.data.transactions.length,
            earliestByAccount: Object.keys(earliestByAccount).map(accountId => ({
              account_id: accountId,
              earliest_date: earliestByAccount[accountId].date,
              transaction_name: earliestByAccount[accountId].name,
              amount: earliestByAccount[accountId].amount
            }))
          };
          
          console.log(`Transactions API: SUCCESS - Found ${transactionsResponse.data.transactions.length} total transactions`);
        } catch (error) {
          console.error('Transactions API failed:', error);
          itemResult.apiCalls.transactions = {
            success: false,
            error: {
              error_code: error.error_code,
              error_type: error.error_type,
              message: error.message,
              status: error.response?.status
            }
          };
          itemResult.errors.push(`Transactions API: ${error.error_code} - ${error.message}`);
        }
        
        // Compare with database
        const itemAccounts = (creditCards || []).filter(card => card.plaidItemId === item.id);
        itemResult.accounts = itemAccounts.map(dbAccount => ({
          databaseInfo: {
            name: dbAccount.name,
            accountId: dbAccount.accountId,
            currentOpenDate: dbAccount.openDate
          },
          plaidAccountMatch: itemResult.apiCalls.accounts?.success ? 
            itemResult.apiCalls.accounts.accounts.find(acc => acc.account_id === dbAccount.accountId) : null,
          plaidLiabilityMatch: itemResult.apiCalls.liabilities?.success ?
            itemResult.apiCalls.liabilities.credit.find(liability => liability.account_id === dbAccount.accountId) : null,
          earliestTransaction: itemResult.apiCalls.transactions?.success ?
            itemResult.apiCalls.transactions.earliestByAccount.find(earliest => earliest.account_id === dbAccount.accountId) : null
        }));
        
      } catch (error) {
        console.error(`General error for ${item.institutionName}:`, error);
        itemResult.errors.push(`General: ${error.message}`);
      }
      
      results.push(itemResult);
    }

    console.log('\n🔍 PLAID API EXPLORATION COMPLETED');
    
    return NextResponse.json({ 
      message: 'Plaid API exploration completed',
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalItems: plaidItems.length,
        itemsWithAccountsAPI: results.filter(r => r.apiCalls.accounts?.success).length,
        itemsWithLiabilitiesAPI: results.filter(r => r.apiCalls.liabilities?.success).length,
        itemsWithTransactionsAPI: results.filter(r => r.apiCalls.transactions?.success).length,
        itemsWithErrors: results.filter(r => r.errors.length > 0).length,
        totalApiErrors: results.reduce((sum, r) => sum + r.errors.length, 0)
      }
    });
  } catch (error) {
    console.error('🔍 PLAID API EXPLORATION ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to explore Plaid API',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}