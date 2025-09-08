import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { decrypt } from '@/lib/encryption';

const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'production'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Robinhood plaid item
    const { data: plaidItems } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id)
      .or('institutionId.eq.ins_54,institutionName.ilike.%robinhood%')
      .single();

    if (!plaidItems) {
      return NextResponse.json({ error: 'No Robinhood connection found' }, { status: 404 });
    }

    const accessToken = decrypt(plaidItems.accessToken);
    const results: any = {
      institution: {
        id: plaidItems.institutionId,
        name: plaidItems.institutionName
      }
    };

    // 1. Check what products are enabled
    try {
      const itemResponse = await plaidClient.itemGet({
        access_token: accessToken,
      });
      
      results.enabledProducts = {
        products: itemResponse.data.item.products,
        billedProducts: itemResponse.data.item.billed_products,
        availableProducts: itemResponse.data.item.available_products,
        consentedProducts: itemResponse.data.item.consented_products,
        hasStatements: itemResponse.data.item.products.includes('statements') ||
                       itemResponse.data.item.consented_products?.includes('statements')
      };
    } catch (error: any) {
      results.enabledProducts = { error: error.message };
    }

    // 2. Try to fetch statements if available
    if (results.enabledProducts.hasStatements) {
      try {
        console.log('📄 Fetching statements list...');
        
        const statementsResponse = await plaidClient.statementsList({
          access_token: accessToken,
          start_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0]
        });
        
        const statements = statementsResponse.data.statements;
        
        // Get Robinhood credit card account
        const accountsResponse = await plaidClient.accountsGet({
          access_token: accessToken,
        });
        
        const creditCardAccount = accountsResponse.data.accounts.find(acc =>
          acc.type === 'credit' || 
          acc.subtype === 'credit card' ||
          acc.name?.toLowerCase().includes('gold')
        );
        
        if (creditCardAccount) {
          // Filter statements for credit card account
          const creditCardStatements = statements.filter(s => 
            s.account_id === creditCardAccount.account_id
          );
          
          results.statements = {
            totalStatements: statements.length,
            creditCardStatements: creditCardStatements.length,
            accountId: creditCardAccount.account_id,
            accountName: creditCardAccount.name,
            statementDetails: creditCardStatements.map(s => ({
              statementId: s.statement_id,
              month: s.month,
              year: s.year,
              datePosted: s.date_posted,
              // Calculate statement period
              estimatedPeriod: {
                start: `${s.year}-${s.month.padStart(2, '0')}-01`,
                end: new Date(parseInt(s.year), parseInt(s.month), 0).toISOString().split('T')[0]
              }
            })).sort((a, b) => {
              const dateA = new Date(`${a.year}-${a.month.padStart(2, '0')}-01`);
              const dateB = new Date(`${b.year}-${b.month.padStart(2, '0')}-01`);
              return dateB.getTime() - dateA.getTime();
            })
          };
          
          // Try to get the most recent statement details
          if (creditCardStatements.length > 0) {
            const mostRecent = creditCardStatements.sort((a, b) => {
              const dateA = new Date(`${a.year}-${a.month.padStart(2, '0')}-01`);
              const dateB = new Date(`${b.year}-${b.month.padStart(2, '0')}-01`);
              return dateB.getTime() - dateA.getTime();
            })[0];
            
            results.mostRecentStatement = {
              month: mostRecent.month,
              year: mostRecent.year,
              datePosted: mostRecent.date_posted,
              statementDate: mostRecent.date_posted || 
                            new Date(parseInt(mostRecent.year), parseInt(mostRecent.month), 0).toISOString().split('T')[0],
              estimatedDueDate: calculateDueDate(
                mostRecent.date_posted || 
                new Date(parseInt(mostRecent.year), parseInt(mostRecent.month), 0)
              )
            };
          }
        } else {
          results.statements = { error: 'No credit card account found' };
        }
      } catch (error: any) {
        console.error('Error fetching statements:', error);
        results.statements = { 
          error: error.message,
          errorCode: error.response?.data?.error_code,
          errorType: error.response?.data?.error_type
        };
      }
    } else {
      results.statements = { error: 'Statements product not enabled for this item' };
    }

    // 3. Check current credit card dates in database
    const { data: creditCard } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItems.id)
      .or('institutionId.eq.ins_54,name.ilike.%robinhood%')
      .single();
    
    if (creditCard) {
      results.currentDatesInDB = {
        lastStatementIssueDate: creditCard.lastStatementIssueDate,
        nextPaymentDueDate: creditCard.nextPaymentDueDate,
        needsUpdate: !creditCard.lastStatementIssueDate || 
                    creditCard.lastStatementIssueDate.includes('-01T') || // Likely fake first of month
                    creditCard.lastStatementIssueDate.includes('-31T') || // Likely fake last of month
                    creditCard.lastStatementIssueDate.includes('-30T')
      };
    }

    // 4. Recommendations
    results.recommendations = [];
    
    if (results.enabledProducts.hasStatements && results.statements?.creditCardStatements > 0) {
      results.recommendations.push('✅ Statements are available - can extract accurate dates');
      
      if (results.mostRecentStatement) {
        results.recommendations.push(
          `📅 Update statement date to: ${results.mostRecentStatement.statementDate}`,
          `📅 Update due date to: ${results.mostRecentStatement.estimatedDueDate}`
        );
      }
    } else if (!results.enabledProducts.hasStatements) {
      results.recommendations.push('⚠️ Statements not enabled - user needs to reconnect');
      results.recommendations.push('💡 Have user disconnect and reconnect Robinhood to grant statements access');
    } else {
      results.recommendations.push('⚠️ No credit card statements found');
      results.recommendations.push('💡 May need to wait for statements to be available or refresh statements');
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in Robinhood statements debug:', error);
    return NextResponse.json({ error: 'Failed to debug statements' }, { status: 500 });
  }
}

function calculateDueDate(statementDate: Date | string): string {
  const date = new Date(statementDate);
  date.setDate(date.getDate() + 25);
  return date.toISOString().split('T')[0];
}