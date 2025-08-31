import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    console.log('🔍 VERIFY REFRESH PIPELINE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Check Plaid Items status
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, institutionName, status, lastSyncAt, errorCode')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    // 2. Check Credit Cards
    const plaidItemIds = (plaidItems || []).map(item => item.id);
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, accountId, openDate, lastStatementIssueDate, plaidItemId')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // 3. Check unlinked transactions
    const { data: unlinkedTransactions, error: unlinkedError } = await supabaseAdmin
      .from('transactions')
      .select('id, transactionId, date, amount, name, plaidItemId')
      .in('plaidItemId', plaidItemIds)
      .is('creditCardId', null);

    if (unlinkedError) {
      throw new Error(`Failed to fetch unlinked transactions: ${unlinkedError.message}`);
    }

    // 4. Check billing cycles
    const creditCardIds = (creditCards || []).map(card => card.id);
    const { data: billingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*, creditCardId')
      .in('creditCardId', creditCardIds)
      .order('startDate', { ascending: false });

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // 5. Check recent transactions
    const { data: recentTransactions, error: recentError } = await supabaseAdmin
      .from('transactions')
      .select('id, date, amount, name, creditCardId')
      .in('plaidItemId', plaidItemIds)
      .order('date', { ascending: false })
      .limit(5);

    if (recentError) {
      throw new Error(`Failed to fetch recent transactions: ${recentError.message}`);
    }

    // Get transaction counts for credit cards
    const cardTransactionCounts = await Promise.all(
      (creditCards || []).map(async (card) => {
        const { count: transactionCount } = await supabaseAdmin
          .from('transactions')
          .select('*', { count: 'exact' })
          .eq('creditCardId', card.id);
        const { count: billingCycleCount } = await supabaseAdmin
          .from('billing_cycles')
          .select('*', { count: 'exact' })
          .eq('creditCardId', card.id);
        return { ...card, _count: { transactions: transactionCount || 0, billingCycles: billingCycleCount || 0 } };
      })
    );

    // Get account/transaction counts for plaid items  
    const plaidItemCounts = await Promise.all(
      (plaidItems || []).map(async (item) => {
        const { count: accountCount } = await supabaseAdmin
          .from('credit_cards')
          .select('*', { count: 'exact' })
          .eq('plaidItemId', item.id);
        const { count: transactionCount } = await supabaseAdmin
          .from('transactions')
          .select('*', { count: 'exact' })
          .eq('plaidItemId', item.id);
        return { ...item, _count: { accounts: accountCount || 0, transactions: transactionCount || 0 } };
      })
    );

    // Analysis
    const analysis = {
      dataIntegrity: {
        totalPlaidItems: (plaidItemCounts || []).length,
        activeItems: (plaidItemCounts || []).filter(i => i.status === 'active').length,
        errorItems: (plaidItemCounts || []).filter(i => i.status === 'error' || i.status === 'expired').length,
        totalCreditCards: (cardTransactionCounts || []).length,
        cardsWithTransactions: (cardTransactionCounts || []).filter(c => c._count.transactions > 0).length,
        cardsWithoutTransactions: (cardTransactionCounts || []).filter(c => c._count.transactions === 0).length,
        totalUnlinkedTransactions: (unlinkedTransactions || []).length
      },
      potentialIssues: []
    };

    // Identify issues
    if ((unlinkedTransactions || []).length > 0) {
      analysis.potentialIssues.push({
        type: 'UNLINKED_TRANSACTIONS',
        severity: 'HIGH',
        count: (unlinkedTransactions || []).length,
        message: `${(unlinkedTransactions || []).length} transactions not linked to any credit card`,
        impact: 'Billing cycles will show $0.00 spend'
      });
    }

    if (analysis.dataIntegrity.cardsWithoutTransactions > 0) {
      analysis.potentialIssues.push({
        type: 'CARDS_WITHOUT_TRANSACTIONS',
        severity: 'MEDIUM',
        count: analysis.dataIntegrity.cardsWithoutTransactions,
        message: `${analysis.dataIntegrity.cardsWithoutTransactions} cards have no transactions`,
        impact: 'No spending data available for these cards'
      });
    }


    const lastSyncTimes = (plaidItemCounts || []).map(item => ({
      institution: item.institutionName,
      lastSync: item.lastSyncAt,
      minutesAgo: item.lastSyncAt ? Math.round((Date.now() - new Date(item.lastSyncAt).getTime()) / 60000) : null
    }));

    return NextResponse.json({
      message: 'Refresh pipeline verification completed',
      timestamp: new Date().toISOString(),
      analysis,
      details: {
        plaidItems: (plaidItemCounts || []).map(item => ({
          institution: item.institutionName,
          status: item.status,
          accounts: item._count.accounts,
          transactions: item._count.transactions,
          lastSync: item.lastSyncAt,
          errorCode: item.errorCode
        })),
        creditCards: (cardTransactionCounts || []).map(card => ({
          name: card.name,
          transactions: card._count.transactions,
          billingCycles: card._count.billingCycles,
          openDate: card.openDate,
          hasOpenDate: !!card.openDate
        })),
        unlinkedTransactions: (unlinkedTransactions || []).slice(0, 5).map(t => ({
          date: t.date,
          name: t.name,
          amount: t.amount
        })),
        allBillingCycles: (billingCycles || []).map(cycle => {
          const card = (cardTransactionCounts || []).find(c => c.id === cycle.creditCardId);
          return {
            card: card?.name || 'Unknown',
            period: `${new Date(cycle.startDate).toLocaleDateString()} - ${new Date(cycle.endDate).toLocaleDateString()}`,
            totalSpend: cycle.totalSpend,
            statementBalance: cycle.statementBalance
          };
        }),
        lastSyncTimes
      },
      recommendations: [
        (unlinkedTransactions || []).length > 0 && 'Run billing cycle regeneration to link orphaned transactions',
        analysis.dataIntegrity.errorItems > 0 && 'Reconnect failed Plaid items'
      ].filter(Boolean)
    });

  } catch (error) {
    console.error('🔍 VERIFY REFRESH PIPELINE ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to verify refresh pipeline',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}