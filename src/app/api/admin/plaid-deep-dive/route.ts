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
      .ilike('institutionName', '%robinhood%')
      .single();

    if (!plaidItems) {
      return NextResponse.json({ error: 'No Robinhood connection found' }, { status: 404 });
    }

    // Decrypt the access token
    const encryptedToken = plaidItems.accessToken;
    const accessToken = decrypt(encryptedToken);
    const results: any = {};

    // Debug info
    results.debug = {
      hasAccessToken: !!accessToken,
      tokenLength: accessToken?.length,
      tokenFormat: accessToken?.startsWith('access-') ? 'Valid Plaid format' : 'Invalid format',
      itemId: plaidItems.itemId,
      institutionName: plaidItems.institutionName
    };

    // First, check what products are actually enabled for this item
    try {
      const itemResponse = await plaidClient.itemGet({
        access_token: accessToken,
      });
      results.itemInfo = {
        institutionId: itemResponse.data.item.institution_id,
        products: itemResponse.data.item.products,
        billedProducts: itemResponse.data.item.billed_products,
        availableProducts: itemResponse.data.item.available_products,
        consentedProducts: itemResponse.data.item.consented_products,
        updateType: itemResponse.data.item.update_type,
        webhook: itemResponse.data.item.webhook
      };
    } catch (error: any) {
      console.error('ItemGet error:', error.response?.data || error.message);
      results.itemInfo = { 
        error: error.message,
        errorCode: error.response?.data?.error_code,
        errorType: error.response?.data?.error_type,
        errorMessage: error.response?.data?.error_message,
        displayMessage: error.response?.data?.display_message
      };
    }

    // 1. Get Investments Holdings (might have statement info) - only if investments is enabled
    try {
      const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
      if (!itemResponse.data.item.products.includes('investments')) {
        results.investments = { error: 'Investments product not enabled for this item' };
      } else {
        const investmentsResponse = await plaidClient.investmentsHoldingsGet({
          access_token: accessToken,
        });
        results.investments = {
        accounts: investmentsResponse.data.accounts.map(acc => ({
          account_id: acc.account_id,
          name: acc.name,
          type: acc.type,
          subtype: acc.subtype,
          balances: acc.balances,
          // Check for any additional fields
          allFields: Object.keys(acc)
        })),
        securities: investmentsResponse.data.securities?.length || 0,
        holdings: investmentsResponse.data.holdings?.length || 0,
        // Check if there's any statement-related data
        rawSample: investmentsResponse.data.accounts[0]
      };
      }
    } catch (error: any) {
      results.investments = { error: error.message };
    }

    // 2. Get Investments Transactions (might have statement markers)
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      const endDate = new Date();
      
      const investTransResponse = await plaidClient.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
      });
      
      // Look for statement-related transactions
      const statementTransactions = investTransResponse.data.investment_transactions?.filter(t => 
        t.name?.toLowerCase().includes('statement') ||
        t.name?.toLowerCase().includes('interest') ||
        t.name?.toLowerCase().includes('fee') ||
        t.type === 'fee' ||
        t.subtype?.includes('fee')
      );
      
      results.investmentTransactions = {
        total: investTransResponse.data.investment_transactions?.length || 0,
        types: [...new Set(investTransResponse.data.investment_transactions?.map(t => t.type))],
        subtypes: [...new Set(investTransResponse.data.investment_transactions?.map(t => t.subtype))],
        statementRelated: statementTransactions?.map(t => ({
          date: t.date,
          name: t.name,
          type: t.type,
          subtype: t.subtype,
          amount: t.amount
        })),
        sample: investTransResponse.data.investment_transactions?.slice(0, 5)
      };
    } catch (error: any) {
      results.investmentTransactions = { error: error.message };
    }

    // 3. Get detailed Transactions with metadata
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 2);
      const endDate = new Date();
      
      // Try basic transaction call first
      const transResponse = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      });
      
      // Look for patterns in transaction metadata
      const interestTransactions = transResponse.data.transactions.filter(t =>
        t.name?.toLowerCase().includes('interest') ||
        t.personal_finance_category?.primary === 'INTEREST' ||
        t.personal_finance_category?.detailed?.includes('INTEREST')
      );
      
      const feeTransactions = transResponse.data.transactions.filter(t =>
        t.name?.toLowerCase().includes('fee') ||
        t.personal_finance_category?.primary === 'BANK_FEES' ||
        t.personal_finance_category?.detailed?.includes('FEE')
      );
      
      // Check payment metadata for statement info
      const paymentsWithMeta = transResponse.data.transactions
        .filter(t => t.payment_meta || t.name?.toLowerCase().includes('payment'))
        .map(t => ({
          date: t.date,
          name: t.name,
          amount: t.amount,
          payment_meta: t.payment_meta,
          dayOfMonth: new Date(t.date).getDate()
        }));
      
      results.transactions = {
        total: transResponse.data.transactions.length,
        interestCharges: interestTransactions.map(t => ({
          date: t.date,
          name: t.name,
          amount: t.amount,
          dayOfMonth: new Date(t.date).getDate()
        })),
        fees: feeTransactions.map(t => ({
          date: t.date,
          name: t.name,
          amount: t.amount
        })),
        paymentsWithMetadata: paymentsWithMeta,
        // Check what fields are available
        availableFields: transResponse.data.transactions[0] ? Object.keys(transResponse.data.transactions[0]) : []
      };
    } catch (error: any) {
      results.transactions = { error: error.message };
    }

    // 4. Try Recurring Transactions to identify payment patterns
    try {
      const recurringResponse = await plaidClient.transactionsRecurringGet({
        access_token: accessToken,
      });
      
      const creditCardPayments = recurringResponse.data.recurring_transactions?.filter(rt =>
        rt.merchant_name?.toLowerCase().includes('robinhood') ||
        rt.personal_finance_category?.primary === 'LOAN_PAYMENTS' ||
        rt.personal_finance_category?.detailed?.includes('CREDIT_CARD_PAYMENT') ||
        rt.description?.toLowerCase().includes('payment')
      );
      
      results.recurringTransactions = {
        total: recurringResponse.data.recurring_transactions?.length || 0,
        creditCardPayments: creditCardPayments?.map(rt => ({
          description: rt.description,
          merchant_name: rt.merchant_name,
          frequency: rt.frequency,
          last_date: rt.last_date,
          is_active: rt.is_active,
          average_amount: rt.average_amount,
          last_amount: rt.last_amount,
          // This might give us cycle frequency
          days_between: rt.frequency === 'MONTHLY' ? 'Monthly cycle' : rt.frequency
        }))
      };
    } catch (error: any) {
      results.recurringTransactions = { error: error.message || 'Not available' };
    }

    // 5. Check Assets product (might have statement data)
    try {
      const assetsResponse = await plaidClient.assetReportGet({
        asset_report_token: accessToken, // This might need a different token
      });
      results.assets = {
        data: 'Available',
        // Check what's in the report
        fields: assetsResponse.data.report ? Object.keys(assetsResponse.data.report) : []
      };
    } catch (error: any) {
      results.assets = { error: 'Not available or requires separate token' };
    }

    // 6. Get raw account data to see all available fields
    try {
      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken,
      });
      
      const robinhoodAccount = accountsResponse.data.accounts.find(acc => 
        acc.name?.toLowerCase().includes('gold') ||
        acc.name?.toLowerCase().includes('robinhood')
      );
      
      results.rawAccountData = {
        account: robinhoodAccount,
        allFields: robinhoodAccount ? Object.keys(robinhoodAccount) : [],
        // Check if there are any hidden statement fields
        hasStatementFields: robinhoodAccount ? 
          Object.keys(robinhoodAccount).some(key => 
            key.includes('statement') || 
            key.includes('cycle') || 
            key.includes('billing')
          ) : false
      };
    } catch (error: any) {
      results.rawAccountData = { error: error.message };
    }

    return NextResponse.json({
      message: 'Deep dive into Plaid data for Robinhood',
      institution: plaidItems.institutionName,
      results,
      recommendations: [
        'Check investmentTransactions for fee/interest patterns',
        'Use recurringTransactions to identify payment cycle',
        'Look for interest charges in transactions - they often post on statement close dates',
        'Payment dates are typically 25 days after statement close'
      ]
    });
  } catch (error) {
    console.error('Error in Plaid deep dive:', error);
    return NextResponse.json({ error: 'Failed to analyze Plaid data' }, { status: 500 });
  }
}