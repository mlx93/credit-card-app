import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    console.log('🔍 PLAID RAW DATA INSPECTION ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all Plaid items for the user
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      include: {
        accounts: true
      }
    });

    console.log(`Found ${plaidItems.length} Plaid items`);

    const results = [];

    for (const item of plaidItems) {
      console.log(`\n=== INSPECTING PLAID ITEM: ${item.institutionName} ===`);
      
      try {
        // Fetch fresh data from Plaid
        const [accountsResponse, liabilitiesResponse] = await Promise.all([
          plaidClient.accountsGet({ access_token: item.accessToken }),
          plaidClient.liabilitiesGet({ access_token: item.accessToken })
        ]);

        const accounts = accountsResponse.data.accounts;
        const liabilities = liabilitiesResponse.data.liabilities;

        console.log(`Accounts found: ${accounts.length}`);
        console.log(`Liabilities found: ${liabilities?.credit?.length || 0}`);

        for (const account of accounts) {
          if (account.type === 'credit') {
            // Find matching liability data
            const liability = liabilities?.credit?.find(l => l.account_id === account.account_id);
            
            const accountData = {
              institutionName: item.institutionName,
              accountName: account.name,
              accountId: account.account_id,
              accountType: account.type,
              accountSubtype: account.subtype,
              mask: account.mask,
              rawPlaidData: {
                // Account level data
                account: {
                  name: account.name,
                  official_name: account.official_name,
                  type: account.type,
                  subtype: account.subtype,
                  mask: account.mask,
                  balances: account.balances
                },
                // Liability level data
                liability: liability ? {
                  account_id: liability.account_id,
                  origination_date: liability.origination_date,
                  origination_date_raw: liability.origination_date, // Show exact value
                  last_statement_issue_date: liability.last_statement_issue_date,
                  last_statement_balance: liability.last_statement_balance,
                  minimum_payment_amount: liability.minimum_payment_amount,
                  next_payment_due_date: liability.next_payment_due_date,
                  annual_fee: liability.annual_fee,
                  annual_fee_due_date: liability.annual_fee_due_date,
                  balances: liability.balances
                } : null
              },
              parsedDates: {
                originationDate: liability?.origination_date ? {
                  raw: liability.origination_date,
                  parsed: new Date(liability.origination_date).toISOString(),
                  dateString: new Date(liability.origination_date).toDateString(),
                  year: new Date(liability.origination_date).getFullYear(),
                  isInFuture: new Date(liability.origination_date) > new Date()
                } : null,
                lastStatementDate: liability?.last_statement_issue_date ? {
                  raw: liability.last_statement_issue_date,
                  parsed: new Date(liability.last_statement_issue_date).toISOString(),
                  dateString: new Date(liability.last_statement_issue_date).toDateString(),
                  year: new Date(liability.last_statement_issue_date).getFullYear(),
                  isInFuture: new Date(liability.last_statement_issue_date) > new Date()
                } : null,
                nextDueDate: liability?.next_payment_due_date ? {
                  raw: liability.next_payment_due_date,
                  parsed: new Date(liability.next_payment_due_date).toISOString(),
                  dateString: new Date(liability.next_payment_due_date).toDateString(),
                  year: new Date(liability.next_payment_due_date).getFullYear(),
                  isInFuture: new Date(liability.next_payment_due_date) > new Date()
                } : null
              },
              databaseComparison: {
                // Compare with what we have in database
                dbCard: item.accounts.find(card => card.accountId === account.account_id)
              }
            };

            console.log(`Credit card found: ${account.name}`);
            console.log(`Origination date from Plaid: ${liability?.origination_date}`);
            console.log(`Parsed origination date: ${liability?.origination_date ? new Date(liability.origination_date).toDateString() : 'None'}`);
            
            results.push(accountData);
          }
        }
        
      } catch (error) {
        console.error(`Error fetching data for ${item.institutionName}:`, error);
        results.push({
          institutionName: item.institutionName,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log('\n🔍 PLAID RAW DATA INSPECTION COMPLETED');
    
    return NextResponse.json({ 
      message: 'Plaid raw data inspection completed',
      timestamp: new Date().toISOString(),
      results,
      summary: {
        totalItems: plaidItems.length,
        totalCreditCards: results.filter(r => !r.error).length,
        cardsWithFutureDates: results.filter(r => 
          !r.error && r.parsedDates?.originationDate?.isInFuture
        ).length
      }
    });
  } catch (error) {
    console.error('🔍 PLAID RAW DATA INSPECTION ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to inspect Plaid raw data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}