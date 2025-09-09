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
    endpointName: 'admin-robinhood-plaid-explorer',
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
      return NextResponse.json({ error: 'No Robinhood connection found (ins_54)' }, { status: 404 });
    }

    const accessToken = decrypt(plaidItems.accessToken);
    const results: any = {
      institution: {
        id: plaidItems.institutionId,
        name: plaidItems.institutionName
      },
      exploredProducts: []
    };

    // 1. ASSETS PRODUCT - Most comprehensive financial data
    console.log('Exploring Assets product...');
    try {
      // First create an asset report
      const assetReportCreateResponse = await plaidClient.assetReportCreate({
        access_tokens: [accessToken],
        days_requested: 90, // Get 90 days of data
        options: {
          client_report_id: `robinhood_explore_${Date.now()}`,
          include_investments: true, // Include investment accounts
          include_fast_report: true
        }
      });

      const assetReportToken = assetReportCreateResponse.data.asset_report_token;
      
      // Wait a bit for report generation
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try to get the asset report
      try {
        const assetReportGetResponse = await plaidClient.assetReportGet({
          asset_report_token: assetReportToken,
          include_insights: true
        });

        const report = assetReportGetResponse.data.report;
        
        // Look for credit card accounts in the asset report
        const creditCardAccounts = report.items?.[0]?.accounts?.filter(acc => 
          acc.type === 'credit' || 
          acc.subtype === 'credit card' ||
          acc.name?.toLowerCase().includes('gold') ||
          acc.name?.toLowerCase().includes('credit')
        );

        results.exploredProducts.push({
          product: 'Assets',
          success: true,
          findings: {
            totalAccounts: report.items?.[0]?.accounts?.length || 0,
            creditCardAccounts: creditCardAccounts?.length || 0,
            creditCardDetails: creditCardAccounts?.map(acc => ({
              name: acc.name,
              type: acc.type,
              subtype: acc.subtype,
              balances: acc.balances,
              // Check for any statement-related fields
              days_available: acc.days_available,
              transactions: acc.transactions?.length || 0,
              historical_balances: acc.historical_balances?.length || 0,
              // Look for any custom fields that might contain statement data
              allFields: Object.keys(acc).filter(key => 
                key.includes('statement') || 
                key.includes('billing') || 
                key.includes('cycle') ||
                key.includes('due') ||
                key.includes('close')
              )
            })),
            // Check if there's statement data in the report
            hasStatementData: JSON.stringify(report).includes('statement'),
            hasBillingData: JSON.stringify(report).includes('billing'),
            hasCycleData: JSON.stringify(report).includes('cycle')
          }
        });

        // Clean up the asset report
        await plaidClient.assetReportRemove({
          asset_report_token: assetReportToken
        });

      } catch (getError: any) {
        if (getError.response?.data?.error_code === 'PRODUCT_NOT_READY') {
          results.exploredProducts.push({
            product: 'Assets',
            success: false,
            error: 'Asset report not ready yet - needs more time to generate',
            note: 'Asset reports can take 1-2 minutes to generate'
          });
        } else {
          throw getError;
        }
      }
    } catch (error: any) {
      results.exploredProducts.push({
        product: 'Assets',
        success: false,
        error: error.response?.data?.error_message || error.message,
        errorCode: error.response?.data?.error_code
      });
    }

    // 2. INVESTMENTS PRODUCT - Deep dive into investment account data
    console.log('Exploring Investments product...');
    try {
      // Get investment holdings
      const holdingsResponse = await plaidClient.investmentsHoldingsGet({
        access_token: accessToken,
      });

      // Get investment transactions for patterns
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      
      const investTransResponse = await plaidClient.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        options: {
          count: 500,
          offset: 0
        }
      });

      // Look for credit card related accounts
      const creditRelatedAccounts = holdingsResponse.data.accounts.filter(acc =>
        acc.type === 'credit' ||
        acc.subtype === 'credit card' ||
        acc.name?.toLowerCase().includes('gold') ||
        acc.name?.toLowerCase().includes('credit') ||
        acc.balances?.current && acc.balances.current < 0 // Negative balance might indicate credit
      );

      // Look for statement-related investment transactions
      const statementTransactions = investTransResponse.data.investment_transactions?.filter(t =>
        t.name?.toLowerCase().includes('statement') ||
        t.name?.toLowerCase().includes('interest') ||
        t.name?.toLowerCase().includes('billing') ||
        t.type === 'fee' ||
        t.subtype?.includes('management_fee')
      );

      // Extract any date patterns from investment transactions
      const interestDates = investTransResponse.data.investment_transactions
        ?.filter(t => t.name?.toLowerCase().includes('interest'))
        ?.map(t => ({
          date: t.date,
          dayOfMonth: new Date(t.date).getDate(),
          amount: t.amount,
          name: t.name
        }));

      results.exploredProducts.push({
        product: 'Investments',
        success: true,
        findings: {
          totalAccounts: holdingsResponse.data.accounts.length,
          creditRelatedAccounts: creditRelatedAccounts.length,
          creditAccountDetails: creditRelatedAccounts.map(acc => ({
            account_id: acc.account_id,
            name: acc.name,
            type: acc.type,
            subtype: acc.subtype,
            balances: acc.balances,
            // Check all available fields
            availableFields: Object.keys(acc),
            // Check for any hidden statement fields
            statementFields: Object.entries(acc)
              .filter(([key]) => 
                key.includes('statement') || 
                key.includes('billing') || 
                key.includes('cycle') ||
                key.includes('due')
              )
              .map(([key, value]) => ({ [key]: value }))
          })),
          statementTransactions: statementTransactions?.length || 0,
          statementTransactionSamples: statementTransactions?.slice(0, 5),
          interestChargePattern: interestDates?.length > 0 ? {
            count: interestDates.length,
            dates: interestDates,
            mostCommonDay: findMostFrequentDay(interestDates.map(d => d.dayOfMonth))
          } : null,
          investmentTransactionTypes: [...new Set(investTransResponse.data.investment_transactions?.map(t => t.type))],
          investmentTransactionSubtypes: [...new Set(investTransResponse.data.investment_transactions?.map(t => t.subtype))]
        }
      });
    } catch (error: any) {
      results.exploredProducts.push({
        product: 'Investments',
        success: false,
        error: error.response?.data?.error_message || error.message,
        errorCode: error.response?.data?.error_code
      });
    }

    // 3. RECURRING TRANSACTIONS - Check for billing cycle patterns
    console.log('Exploring Recurring Transactions...');
    try {
      const recurringResponse = await plaidClient.transactionsRecurringGet({
        access_token: accessToken,
        options: {
          include_personal_finance_category: true
        }
      });

      // Look for credit card related recurring transactions
      const creditCardRecurring = recurringResponse.data.recurring_transactions?.filter(rt =>
        rt.personal_finance_category?.primary === 'LOAN_PAYMENTS' ||
        rt.personal_finance_category?.detailed?.includes('CREDIT_CARD') ||
        rt.merchant_name?.toLowerCase().includes('robinhood') ||
        rt.description?.toLowerCase().includes('interest') ||
        rt.description?.toLowerCase().includes('fee')
      );

      // Find statement/billing patterns
      const billingPatterns = recurringResponse.data.recurring_transactions?.filter(rt =>
        rt.frequency === 'MONTHLY' && (
          rt.description?.toLowerCase().includes('interest') ||
          rt.description?.toLowerCase().includes('fee') ||
          rt.description?.toLowerCase().includes('charge')
        )
      );

      results.exploredProducts.push({
        product: 'Recurring Transactions',
        success: true,
        findings: {
          totalRecurring: recurringResponse.data.recurring_transactions?.length || 0,
          creditCardRelated: creditCardRecurring?.length || 0,
          billingPatterns: billingPatterns?.map(bp => ({
            description: bp.description,
            frequency: bp.frequency,
            last_date: bp.last_date,
            dayOfMonth: bp.last_date ? new Date(bp.last_date).getDate() : null,
            average_amount: bp.average_amount,
            is_active: bp.is_active,
            // This could indicate statement cycle
            stream_id: bp.stream_id
          })),
          creditCardRecurringSamples: creditCardRecurring?.slice(0, 5)
        }
      });
    } catch (error: any) {
      results.exploredProducts.push({
        product: 'Recurring Transactions',
        success: false,
        error: error.response?.data?.error_message || error.message,
        errorCode: error.response?.data?.error_code
      });
    }

    // 4. PROCESSOR API - Check if processor endpoints have more data
    console.log('Checking Processor capabilities...');
    try {
      // Create a processor token to see what's available
      const processorTokenResponse = await plaidClient.processorTokenCreate({
        access_token: accessToken,
        account_id: plaidItems.accountId || '', // Need the specific account ID
        processor: 'dwolla' // Using dwolla as example processor
      });

      results.exploredProducts.push({
        product: 'Processor Token',
        success: true,
        findings: {
          processorTokenCreated: true,
          note: 'Processor APIs might have access to additional data not available in direct API'
        }
      });
    } catch (error: any) {
      results.exploredProducts.push({
        product: 'Processor Token',
        success: false,
        error: error.response?.data?.error_message || error.message,
        note: 'Processor APIs require specific account_id and processor partnership'
      });
    }

    // 5. BALANCE with detailed options
    console.log('Exploring Balance product with options...');
    try {
      const balanceResponse = await plaidClient.accountsBalanceGet({
        access_token: accessToken,
        options: {
          min_last_updated_datetime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      });

      const creditAccounts = balanceResponse.data.accounts.filter(acc =>
        acc.type === 'credit' ||
        acc.subtype === 'credit card' ||
        acc.name?.toLowerCase().includes('gold') ||
        (acc.balances?.current && acc.balances.current < 0)
      );

      results.exploredProducts.push({
        product: 'Balance',
        success: true,
        findings: {
          creditAccounts: creditAccounts.map(acc => ({
            name: acc.name,
            type: acc.type,
            subtype: acc.subtype,
            balances: acc.balances,
            // Check all balance fields
            allBalanceFields: acc.balances ? Object.keys(acc.balances) : [],
            // Look for any additional metadata
            metadata: Object.entries(acc)
              .filter(([key]) => !['account_id', 'name', 'type', 'subtype', 'balances', 'mask'].includes(key))
              .map(([key, value]) => ({ [key]: value }))
          }))
        }
      });
    } catch (error: any) {
      results.exploredProducts.push({
        product: 'Balance',
        success: false,
        error: error.response?.data?.error_message || error.message
      });
    }

    // 6. Check raw account data with all available options
    console.log('Getting raw account data...');
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
        options: {
          include_personal_finance_category_beta: true
        }
      });

      const robinhoodAccount = accountsResponse.data.accounts.find(acc =>
        acc.name?.toLowerCase().includes('gold') ||
        acc.name?.toLowerCase().includes('robinhood') ||
        acc.type === 'credit'
      );

      if (robinhoodAccount) {
        // Deep inspection of the account object
        const accountKeys = Object.keys(robinhoodAccount);
        const potentialStatementFields = accountKeys.filter(key =>
          key.includes('statement') ||
          key.includes('billing') ||
          key.includes('cycle') ||
          key.includes('due') ||
          key.includes('close') ||
          key.includes('period')
        );

        results.rawAccountInspection = {
          accountFound: true,
          accountName: robinhoodAccount.name,
          allFields: accountKeys,
          potentialStatementFields: potentialStatementFields,
          fieldCount: accountKeys.length,
          // Get the full raw object for inspection
          rawAccount: robinhoodAccount
        };
      }
    } catch (error: any) {
      results.rawAccountInspection = {
        error: error.response?.data?.error_message || error.message
      };
    }

    // Analysis and recommendations
    const hasStatementData = results.exploredProducts.some(p => 
      p.success && (
        p.findings?.hasStatementData ||
        p.findings?.billingPatterns?.length > 0 ||
        p.findings?.interestChargePattern
      )
    );

    results.analysis = {
      hasDirectStatementData: hasStatementData,
      recommendedApproach: determineRecommendedApproach(results),
      summary: generateSummary(results)
    };

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in Robinhood Plaid exploration:', error);
    return NextResponse.json({ error: 'Failed to explore Plaid products' }, { status: 500 });
  }
}

function findMostFrequentDay(days: number[]): number | null {
  if (!days || days.length === 0) return null;
  
  const frequency = new Map<number, number>();
  days.forEach(day => {
    frequency.set(day, (frequency.get(day) || 0) + 1);
  });
  
  let maxFreq = 0;
  let mostFrequentDay = days[0];
  
  frequency.forEach((freq, day) => {
    if (freq > maxFreq) {
      maxFreq = freq;
      mostFrequentDay = day;
    }
  });
  
  return mostFrequentDay;
}

function determineRecommendedApproach(results: any): string {
  // Check if Assets product has statement data
  const assetsProduct = results.exploredProducts.find(p => p.product === 'Assets');
  if (assetsProduct?.success && assetsProduct.findings?.creditCardAccounts > 0) {
    return 'Use Assets product with include_investments option for comprehensive financial data';
  }
  
  // Check if Investments has useful patterns
  const investmentsProduct = results.exploredProducts.find(p => p.product === 'Investments');
  if (investmentsProduct?.success && investmentsProduct.findings?.interestChargePattern) {
    return 'Use Investments product to track interest charge patterns for statement dates';
  }
  
  // Check if Recurring Transactions has billing patterns
  const recurringProduct = results.exploredProducts.find(p => p.product === 'Recurring Transactions');
  if (recurringProduct?.success && recurringProduct.findings?.billingPatterns?.length > 0) {
    return 'Use Recurring Transactions to identify monthly billing cycle patterns';
  }
  
  return 'No direct statement data found - may need to use transaction analysis or contact Plaid support for custom solution';
}

function generateSummary(results: any): string[] {
  const summary = [];
  
  results.exploredProducts.forEach(product => {
    if (product.success) {
      if (product.product === 'Assets' && product.findings?.creditCardAccounts > 0) {
        summary.push(`✅ Assets: Found ${product.findings.creditCardAccounts} credit card account(s)`);
      } else if (product.product === 'Investments' && product.findings?.interestChargePattern) {
        summary.push(`✅ Investments: Found interest pattern on day ${product.findings.interestChargePattern.mostCommonDay}`);
      } else if (product.product === 'Recurring Transactions' && product.findings?.billingPatterns?.length > 0) {
        summary.push(`✅ Recurring: Found ${product.findings.billingPatterns.length} billing pattern(s)`);
      } else {
        summary.push(`⚠️ ${product.product}: Connected but no statement data found`);
      }
    } else {
      summary.push(`❌ ${product.product}: ${product.errorCode || 'Failed'}`);
    }
  });
  
  return summary;
}