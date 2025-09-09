import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/adminSecurity';
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

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'admin-robinhood-deep-investigation',
    logAccess: true
  });
  if (securityError) return securityError;

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

    // 1. First, check what products we have consent for
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    results.consentedProducts = {
      products: itemResponse.data.item.products,
      consented: itemResponse.data.item.consented_products,
      available: itemResponse.data.item.available_products
    };

    // 2. DEEP DIVE: INVESTMENTS PRODUCT
    if (itemResponse.data.item.consented_products?.includes('investments') ||
        itemResponse.data.item.available_products?.includes('investments')) {
      
      console.log('🔍 Deep diving into Investments product...');
      
      // We need to request investments to be added if not already
      if (!itemResponse.data.item.products.includes('investments')) {
        results.investments = {
          status: 'available_but_not_enabled',
          note: 'Investments product is available but needs to be enabled through Link update mode'
        };
      } else {
        try {
          // Get investment holdings
          const holdingsResponse = await plaidClient.investmentsHoldingsGet({
            access_token: accessToken,
          });
          
          // Look for credit card account
          const creditAccount = holdingsResponse.data.accounts.find(acc =>
            acc.type === 'credit' || 
            acc.subtype === 'credit card' ||
            acc.name?.toLowerCase().includes('gold')
          );
          
          if (creditAccount) {
            results.investments = {
              creditCardFound: true,
              account: {
                account_id: creditAccount.account_id,
                name: creditAccount.name,
                type: creditAccount.type,
                subtype: creditAccount.subtype,
                // Check ALL fields for any hidden statement data
                allFields: Object.entries(creditAccount).map(([key, value]) => ({
                  field: key,
                  value: typeof value === 'object' ? JSON.stringify(value) : value,
                  isDate: typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)
                }))
              }
            };
          }
          
          // Get investment transactions to look for patterns
          const endDate = new Date();
          const startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 6);
          
          const transResponse = await plaidClient.investmentsTransactionsGet({
            access_token: accessToken,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0],
            options: {
              account_ids: creditAccount ? [creditAccount.account_id] : undefined
            }
          });
          
          // Look for any statement-related transactions
          const statementIndicators = transResponse.data.investment_transactions?.filter(t => {
            const name = t.name?.toLowerCase() || '';
            const type = t.type?.toLowerCase() || '';
            const subtype = t.subtype?.toLowerCase() || '';
            
            return (
              name.includes('statement') ||
              name.includes('cycle') ||
              name.includes('billing') ||
              name.includes('close') ||
              name.includes('interest') ||
              name.includes('fee') ||
              type === 'fee' ||
              subtype.includes('fee')
            );
          });
          
          if (statementIndicators && statementIndicators.length > 0) {
            results.investments.statementIndicators = statementIndicators.map(t => ({
              date: t.date,
              name: t.name,
              type: t.type,
              subtype: t.subtype,
              amount: t.amount,
              dayOfMonth: new Date(t.date).getDate()
            }));
            
            // Analyze patterns
            const dayFrequency = new Map<number, number>();
            statementIndicators.forEach(t => {
              const day = new Date(t.date).getDate();
              dayFrequency.set(day, (dayFrequency.get(day) || 0) + 1);
            });
            
            results.investments.dayPattern = Array.from(dayFrequency.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([day, count]) => ({ day, occurrences: count }));
          }
          
        } catch (error: any) {
          results.investments = {
            error: error.message,
            errorCode: error.response?.data?.error_code,
            note: 'Need to enable investments product through Link update'
          };
        }
      }
    }

    // 3. DEEP DIVE: ASSETS PRODUCT
    if (itemResponse.data.item.consented_products?.includes('assets')) {
      console.log('🔍 Deep diving into Assets product...');
      
      try {
        // Create a minimal asset report
        const createResponse = await plaidClient.assetReportCreate({
          access_tokens: [accessToken],
          days_requested: 30, // Just last 30 days to speed up generation
          options: {
            client_report_id: `robinhood_investigation_${Date.now()}`,
            include_insights: true,
            fast_report: true // Request fast report for quicker generation
          }
        });
        
        const assetReportToken = createResponse.data.asset_report_token;
        results.assets = {
          reportToken: assetReportToken,
          status: 'created',
          note: 'Report created, attempting to fetch...'
        };
        
        // Try to get it immediately (might fail if not ready)
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
        
        try {
          const reportResponse = await plaidClient.assetReportGet({
            asset_report_token: assetReportToken,
            include_insights: true
          });
          
          const report = reportResponse.data.report;
          
          // Look for credit card account
          const creditAccount = report.items?.[0]?.accounts?.find(acc =>
            acc.type === 'credit' || 
            acc.subtype === 'credit card' ||
            acc.name?.toLowerCase().includes('gold')
          );
          
          if (creditAccount) {
            results.assets = {
              creditCardFound: true,
              account: {
                account_id: creditAccount.account_id,
                name: creditAccount.name,
                days_available: creditAccount.days_available,
                // Look for ANY date-related fields
                allFields: Object.entries(creditAccount).filter(([key]) => 
                  key !== 'transactions' // Exclude transaction array for readability
                ).map(([key, value]) => ({
                  field: key,
                  value: typeof value === 'object' ? JSON.stringify(value) : value,
                  isDateField: key.toLowerCase().includes('date') || 
                              key.toLowerCase().includes('open') ||
                              key.toLowerCase().includes('close') ||
                              key.toLowerCase().includes('statement')
                })),
                // Check historical balances for patterns
                historicalBalances: creditAccount.historical_balances?.slice(0, 10).map(bal => ({
                  date: bal.date,
                  current: bal.current,
                  dayOfMonth: new Date(bal.date).getDate()
                }))
              }
            };
            
            // Look for balance reset patterns (might indicate statement close)
            if (creditAccount.historical_balances && creditAccount.historical_balances.length > 0) {
              const balanceJumps = [];
              for (let i = 1; i < creditAccount.historical_balances.length; i++) {
                const prev = creditAccount.historical_balances[i - 1];
                const curr = creditAccount.historical_balances[i];
                const change = Math.abs(curr.current - prev.current);
                
                // Large balance changes might indicate statement close or payment
                if (change > 100) {
                  balanceJumps.push({
                    date: curr.date,
                    dayOfMonth: new Date(curr.date).getDate(),
                    change: change,
                    from: prev.current,
                    to: curr.current
                  });
                }
              }
              
              if (balanceJumps.length > 0) {
                results.assets.balancePatterns = balanceJumps;
              }
            }
          }
          
          // Check report-level data for any statement info
          results.assets.reportMetadata = {
            dateGenerated: report.date_generated,
            daysRequested: report.days_requested,
            // Check if there are any report-level fields with statement data
            reportFields: Object.keys(report).filter(key => 
              key.includes('statement') || 
              key.includes('cycle') ||
              key.includes('billing')
            )
          };
          
          // Clean up
          await plaidClient.assetReportRemove({
            asset_report_token: assetReportToken
          });
          
        } catch (getError: any) {
          if (getError.response?.data?.error_code === 'PRODUCT_NOT_READY') {
            results.assets.status = 'generating';
            results.assets.note = 'Report is still generating, try again in 1-2 minutes';
            results.assets.token = assetReportToken;
          } else {
            results.assets.error = getError.message;
          }
        }
        
      } catch (error: any) {
        results.assets = {
          error: error.message,
          errorCode: error.response?.data?.error_code
        };
      }
    } else {
      results.assets = { status: 'not_consented' };
    }

    // 4. Check regular account data for any hidden fields
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });
      
      const creditCard = accountsResponse.data.accounts.find(acc =>
        acc.type === 'credit' || 
        acc.subtype === 'credit card' ||
        acc.name?.toLowerCase().includes('gold')
      );
      
      if (creditCard) {
        // Deep inspection of the account object
        results.accountDeepInspection = {
          // Get the raw JSON representation to see ALL fields
          rawAccountKeys: Object.keys(creditCard),
          // Check for any non-standard fields
          nonStandardFields: Object.entries(creditCard)
            .filter(([key]) => 
              !['account_id', 'balances', 'mask', 'name', 'official_name', 'type', 'subtype'].includes(key)
            )
            .map(([key, value]) => ({
              field: key,
              value: typeof value === 'object' ? JSON.stringify(value) : value
            }))
        };
      }
    } catch (error: any) {
      results.accountDeepInspection = { error: error.message };
    }

    // 5. Analysis and recommendations
    results.analysis = analyzeResults(results);

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in deep investigation:', error);
    return NextResponse.json({ error: 'Failed investigation' }, { status: 500 });
  }
}

function analyzeResults(results: any): any {
  const analysis: any = {
    foundStatementData: false,
    possibleStatementDay: null,
    recommendations: []
  };

  // Check investments for patterns
  if (results.investments?.dayPattern?.length > 0) {
    const mostCommon = results.investments.dayPattern[0];
    if (mostCommon.occurrences >= 2) {
      analysis.possibleStatementDay = mostCommon.day;
      analysis.foundStatementData = true;
      analysis.recommendations.push(
        `Investment transactions suggest statement/fee posting on day ${mostCommon.day}`
      );
    }
  }

  // Check assets for balance patterns
  if (results.assets?.balancePatterns?.length > 0) {
    const days = results.assets.balancePatterns.map(p => p.dayOfMonth);
    const dayFreq = new Map();
    days.forEach(d => dayFreq.set(d, (dayFreq.get(d) || 0) + 1));
    
    const mostCommonBalanceDay = Array.from(dayFreq.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    if (mostCommonBalanceDay) {
      analysis.recommendations.push(
        `Balance changes suggest activity around day ${mostCommonBalanceDay[0]}`
      );
    }
  }

  // Check if we need to enable investments
  if (results.investments?.status === 'available_but_not_enabled') {
    analysis.recommendations.push(
      '⚠️ Investments product is available but not enabled',
      '💡 Need to update connection to add investments product for better data'
    );
  }

  if (!analysis.foundStatementData) {
    analysis.recommendations.push(
      '❌ No definitive statement date found in Assets or Investments',
      '💡 Consider adding manual date override feature for Robinhood cards'
    );
  }

  return analysis;
}