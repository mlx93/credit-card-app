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
    endpointName: 'admin-robinhood-assets-check',
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
    const results: any = {};

    // 1. Get basic account info first
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
        results.creditCardAccount = {
          account_id: creditCard.account_id,
          name: creditCard.name,
          official_name: creditCard.official_name,
          type: creditCard.type,
          subtype: creditCard.subtype,
          mask: creditCard.mask,
          balances: creditCard.balances,
          // Check ALL fields on the account object
          allFields: Object.keys(creditCard),
          // Look for any date-related fields
          dateFields: Object.entries(creditCard).filter(([key, value]) => 
            key.toLowerCase().includes('date') || 
            key.toLowerCase().includes('open') ||
            key.toLowerCase().includes('close') ||
            key.toLowerCase().includes('statement') ||
            key.toLowerCase().includes('cycle') ||
            (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/))
          ).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
        };
      }
    } catch (error: any) {
      results.creditCardAccount = { error: error.message };
    }

    // 2. Check if Assets product is available and try to get an asset report
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const hasAssets = itemResponse.data.item.consented_products?.includes('assets') ||
                     itemResponse.data.item.products.includes('assets');
    
    if (hasAssets) {
      try {
        // Create an asset report
        console.log('Creating asset report...');
        const createResponse = await plaidClient.assetReportCreate({
          access_tokens: [accessToken],
          days_requested: 60, // Last 60 days
          options: {
            client_report_id: `robinhood_check_${Date.now()}`,
            webhook: 'https://www.cardcycle.app/api/webhooks/plaid',
            include_insights: true
          }
        });
        
        const assetReportToken = createResponse.data.asset_report_token;
        
        // Wait for report generation (this is async, usually takes 1-2 minutes)
        console.log('Waiting for asset report generation...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        try {
          const reportResponse = await plaidClient.assetReportGet({
            asset_report_token: assetReportToken,
            include_insights: true
          });
          
          const report = reportResponse.data.report;
          
          // Look for credit card account in the report
          const creditCardInReport = report.items?.[0]?.accounts?.find(acc =>
            acc.account_id === results.creditCardAccount?.account_id
          );
          
          if (creditCardInReport) {
            results.assetReportData = {
              account_id: creditCardInReport.account_id,
              days_available: creditCardInReport.days_available,
              transactions: creditCardInReport.transactions?.length || 0,
              // Check for any statement or cycle information
              historical_balances: creditCardInReport.historical_balances?.map(bal => ({
                date: bal.date,
                current: bal.current,
                isoCurrencyCode: bal.iso_currency_code
              })),
              // Look for opening date or other metadata
              ownership_type: creditCardInReport.ownership_type,
              // Check all available fields
              availableFields: Object.keys(creditCardInReport || {}),
              // Extract any date patterns
              datePatterns: extractDatePatterns(creditCardInReport)
            };
          }
          
          // Clean up the report
          await plaidClient.assetReportRemove({
            asset_report_token: assetReportToken
          });
          
        } catch (getError: any) {
          if (getError.response?.data?.error_code === 'PRODUCT_NOT_READY') {
            results.assetReportData = { 
              error: 'Asset report still generating - needs more time',
              note: 'Asset reports can take 1-2 minutes to generate'
            };
          } else {
            results.assetReportData = { error: getError.message };
          }
        }
      } catch (error: any) {
        results.assetReportData = { 
          error: error.message,
          errorCode: error.response?.data?.error_code
        };
      }
    } else {
      results.assetReportData = { error: 'Assets product not available' };
    }

    // 3. Check Recurring Transactions for payment patterns
    try {
      const recurringResponse = await plaidClient.transactionsRecurringGet({
        access_token: accessToken,
      });
      
      const streams = recurringResponse.data.recurring_transactions || [];
      
      // Look for credit card related patterns
      const creditPatterns = streams.filter(stream => {
        const desc = stream.description?.toLowerCase() || '';
        const merchant = stream.merchant_name?.toLowerCase() || '';
        
        return (
          stream.account_id === results.creditCardAccount?.account_id ||
          desc.includes('payment') ||
          desc.includes('interest') ||
          desc.includes('fee') ||
          merchant.includes('robinhood')
        );
      });
      
      results.recurringPatterns = {
        totalStreams: streams.length,
        creditRelatedStreams: creditPatterns.length,
        patterns: creditPatterns.map(p => ({
          stream_id: p.stream_id,
          description: p.description,
          merchant_name: p.merchant_name,
          frequency: p.frequency,
          average_amount: p.average_amount,
          last_date: p.last_date,
          is_active: p.is_active,
          // Extract day of month from dates
          dayOfMonth: p.last_date ? new Date(p.last_date).getDate() : null,
          // Look for monthly patterns
          isMonthly: p.frequency === 'MONTHLY'
        }))
      };
    } catch (error: any) {
      results.recurringPatterns = { error: error.message };
    }

    // 4. Get the stored credit card data to see what we have
    const { data: creditCard } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItems.id)
      .single();
    
    if (creditCard) {
      results.storedCardData = {
        openDate: creditCard.openDate,
        lastStatementIssueDate: creditCard.lastStatementIssueDate,
        nextPaymentDueDate: creditCard.nextPaymentDueDate,
        // Check if we have an open date
        hasOpenDate: !!creditCard.openDate,
        openDateValue: creditCard.openDate
      };
    }

    // 5. Analysis and recommendations
    results.analysis = {
      hasUsefulData: false,
      recommendations: []
    };

    // Check if we found any useful date information
    if (results.creditCardAccount?.dateFields && Object.keys(results.creditCardAccount.dateFields).length > 0) {
      results.analysis.hasUsefulData = true;
      results.analysis.recommendations.push('Found date fields in account data');
    }

    if (results.assetReportData?.historical_balances?.length > 0) {
      results.analysis.hasUsefulData = true;
      results.analysis.recommendations.push('Historical balances might show statement reset patterns');
    }

    if (results.recurringPatterns?.patterns?.some(p => p.isMonthly)) {
      results.analysis.hasUsefulData = true;
      const monthlyPattern = results.recurringPatterns.patterns.find(p => p.isMonthly);
      results.analysis.recommendations.push(
        `Found monthly pattern on day ${monthlyPattern.dayOfMonth} - could be payment or statement date`
      );
    }

    if (!results.analysis.hasUsefulData) {
      results.analysis.recommendations.push(
        'No reliable cycle data found in Plaid APIs',
        'Consider allowing manual date entry for Robinhood cards'
      );
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in Robinhood assets check:', error);
    return NextResponse.json({ error: 'Failed to check assets' }, { status: 500 });
  }
}

function extractDatePatterns(account: any): any {
  const patterns: any = {};
  
  // Look through all transaction dates to find patterns
  if (account.transactions && Array.isArray(account.transactions)) {
    const transactionDates = account.transactions.map((t: any) => ({
      date: t.date,
      dayOfMonth: new Date(t.date).getDate(),
      amount: t.amount
    }));
    
    // Group by day of month to find recurring patterns
    const dayGroups = new Map<number, number>();
    transactionDates.forEach((t: any) => {
      dayGroups.set(t.dayOfMonth, (dayGroups.get(t.dayOfMonth) || 0) + 1);
    });
    
    // Find most common transaction days
    patterns.commonTransactionDays = Array.from(dayGroups.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([day, count]) => ({ day, count }));
  }
  
  return patterns;
}