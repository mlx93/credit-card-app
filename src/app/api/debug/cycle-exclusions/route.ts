import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'cycle-exclusions',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const cardId = url.searchParams.get('cardId');

    // Get user's credit cards
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({ cycleExclusions: [] });
    }

    // Get credit cards
    let cardsQuery = supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardId) {
      cardsQuery = cardsQuery.eq('id', cardId);
    }

    const { data: cards, error: cardsError } = await cardsQuery;

    if (cardsError) {
      throw new Error(`Failed to fetch cards: ${cardsError.message}`);
    }

    if (!cards || cards.length === 0) {
      return NextResponse.json({ cycleExclusions: [] });
    }

    // Get billing cycles for these cards
    const { data: billingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .in('creditCardId', cards.map(c => c.id))
      .order('endDate', { ascending: false })
      .limit(10); // Last 10 cycles

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    const result = [];

    // For each billing cycle, analyze what transactions were excluded
    for (const cycle of billingCycles || []) {
      const card = cards.find(c => c.id === cycle.creditCardId);
      if (!card) continue;

      const cycleStart = new Date(cycle.startDate);
      const cycleEnd = new Date(cycle.endDate);
      const today = new Date();
      const effectiveEndDate = cycleEnd > today ? today : cycleEnd;

      // Get ALL transactions in the cycle date range
      const { data: allCycleTransactions, error: transError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('creditCardId', cycle.creditCardId)
        .gte('date', cycleStart.toISOString())
        .lte('date', effectiveEndDate.toISOString())
        .order('date', { ascending: false });

      if (transError) {
        console.error(`Error fetching transactions for cycle ${cycle.id}:`, transError);
        continue;
      }

      // Categorize transactions
      const included = [];
      const excludedPayments = [];
      const excludedPending = [];

      for (const transaction of allCycleTransactions || []) {
        const isPayment = isPaymentTransaction(transaction.name || '');
        const isPending = transaction.authorizedDate === null;

        if (isPayment) {
          excludedPayments.push({
            ...transaction,
            exclusionReason: 'Payment transaction'
          });
        } else if (isPending) {
          excludedPending.push({
            ...transaction,
            exclusionReason: 'Pending/unauthorized'
          });
        } else {
          included.push(transaction);
        }
      }

      // Calculate totals
      const includedSpend = included.reduce((sum, t) => sum + t.amount, 0);
      const excludedPaymentAmount = excludedPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const excludedPendingAmount = excludedPending.reduce((sum, t) => sum + Math.abs(t.amount), 0);

      result.push({
        cycle: {
          id: cycle.id,
          cardName: card.name,
          cardMask: card.mask,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          totalSpend: cycle.totalSpend,
          statementBalance: cycle.statementBalance
        },
        transactions: {
          total: allCycleTransactions?.length || 0,
          included: included.length,
          excludedPayments: excludedPayments.length,
          excludedPending: excludedPending.length
        },
        amounts: {
          includedSpend: includedSpend,
          excludedPaymentAmount: excludedPaymentAmount,
          excludedPendingAmount: excludedPendingAmount,
          cycleSpendMatches: Math.abs(includedSpend - (cycle.totalSpend || 0)) < 0.01
        },
        excludedTransactions: {
          payments: excludedPayments.map(t => ({
            id: t.id,
            name: t.name,
            amount: t.amount,
            date: t.date,
            merchantName: t.merchantName,
            exclusionReason: t.exclusionReason
          })),
          pending: excludedPending.map(t => ({
            id: t.id,
            name: t.name,
            amount: t.amount,
            date: t.date,
            authorizedDate: t.authorizedDate,
            merchantName: t.merchantName,
            exclusionReason: t.exclusionReason
          }))
        }
      });
    }

    return NextResponse.json({
      cycleExclusions: result,
      summary: {
        totalCycles: result.length,
        totalExcludedPayments: result.reduce((sum, r) => sum + r.transactions.excludedPayments, 0),
        totalExcludedPending: result.reduce((sum, r) => sum + r.transactions.excludedPending, 0),
        totalPaymentAmount: result.reduce((sum, r) => sum + r.amounts.excludedPaymentAmount, 0),
        totalPendingAmount: result.reduce((sum, r) => sum + r.amounts.excludedPendingAmount, 0)
      }
    });

  } catch (error) {
    console.error('Error fetching cycle exclusions:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch cycle exclusions',
      details: error.message 
    }, { status: 500 });
  }
}