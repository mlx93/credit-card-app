import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-inspect-boa-data',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 INSPECTING BOA DATABASE DATA');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get the BoA Customized Cash Rewards card
    const { data: boaCards, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .ilike('name', '%Customized%');

    if (cardError) {
      throw new Error(`Failed to fetch credit cards: ${cardError.message}`);
    }

    const boaCard = boaCards?.[0];

    if (!boaCard) {
      return NextResponse.json({ error: 'BoA Customized card not found' }, { status: 404 });
    }

    const plaidItem = plaidItems?.find(item => item.id === boaCard.plaidItemId);

    if (!boaCard) {
      return NextResponse.json({ error: 'BoA Customized card not found' }, { status: 404 });
    }

    // Get ALL transactions for this card
    const { data: allTransactions, error: txnError } = await supabaseAdmin
      .from('transactions')
      .select('id, transactionId, date, amount, name, category, merchantName')
      .eq('creditCardId', boaCard.id)
      .order('date', { ascending: false });

    if (txnError) {
      throw new Error(`Failed to fetch transactions: ${txnError.message}`);
    }

    // Get ALL billing cycles for this card
    const { data: allBillingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .order('startDate', { ascending: false });

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // Group transactions by month for easier analysis
    const transactionsByMonth = (allTransactions || []).reduce((acc: any, t) => {
      const date = new Date(t.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[monthKey]) acc[monthKey] = [];
      acc[monthKey].push(t);
      return acc;
    }, {});

    // Find June 2025 transactions specifically
    const june2025Transactions = transactionsByMonth['2025-06'] || [];

    // Analyze billing cycles
    const cycleAnalysis = (allBillingCycles || []).map(cycle => ({
      id: cycle.id,
      period: `${new Date(cycle.startDate).toISOString().split('T')[0]} to ${new Date(cycle.endDate).toISOString().split('T')[0]}`,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      totalSpend: cycle.totalSpend,
      statementBalance: cycle.statementBalance,
      isHistorical: cycle.statementBalance !== null,
      isCurrent: cycle.statementBalance === null
    }));

    return NextResponse.json({
      message: 'BoA card database inspection completed',
      cardInfo: {
        id: boaCard.id,
        name: boaCard.name,
        accountId: boaCard.accountId,
        openDate: boaCard.openDate,
        lastStatementIssueDate: boaCard.lastStatementIssueDate,
        lastStatementBalance: boaCard.lastStatementBalance,
        nextPaymentDueDate: boaCard.nextPaymentDueDate,
        plaidStatus: plaidItem?.status,
        lastSync: plaidItem?.lastSyncAt
      },
      transactionSummary: {
        totalTransactions: (allTransactions || []).length,
        transactionsByMonth: Object.keys(transactionsByMonth).sort().map(month => ({
          month,
          count: transactionsByMonth[month].length,
          totalAmount: transactionsByMonth[month].reduce((sum: number, t: any) => sum + t.amount, 0)
        })),
        june2025Count: june2025Transactions.length,
        june2025TotalSpend: june2025Transactions.reduce((sum: number, t: any) => sum + t.amount, 0)
      },
      billingCycleSummary: {
        totalCycles: (allBillingCycles || []).length,
        historicalCycles: cycleAnalysis.filter(c => c.isHistorical).length,
        currentCycles: cycleAnalysis.filter(c => c.isCurrent).length,
        cycleDetails: cycleAnalysis
      },
      rawData: {
        june2025Transactions: june2025Transactions.slice(0, 10), // First 10 June transactions
        allBillingCycles: cycleAnalysis,
        sampleTransactions: (allTransactions || []).slice(0, 10) // First 10 recent transactions
      }
    });

  } catch (error) {
    console.error('🔍 BOA DATA INSPECTION ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to inspect BoA data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}