import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'filtered-transactions',
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
    const days = parseInt(url.searchParams.get('days') || '90');

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
      return NextResponse.json({ filteredTransactions: [], summary: { total: 0 } });
    }

    // Get credit cards
    let cardsQuery = supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask')
      .in('plaidItemId', plaidItemIds);

    if (cardId) {
      cardsQuery = cardsQuery.eq('id', cardId);
    }

    const { data: cards, error: cardsError } = await cardsQuery;

    if (cardsError) {
      throw new Error(`Failed to fetch cards: ${cardsError.message}`);
    }

    if (!cards || cards.length === 0) {
      return NextResponse.json({ filteredTransactions: [], summary: { total: 0 } });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all transactions in the date range
    const { data: allTransactions, error: transError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('creditCardId', cards.map(c => c.id))
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: false });

    if (transError) {
      throw new Error(`Failed to fetch transactions: ${transError.message}`);
    }

    // Categorize transactions by filter type
    const result = {
      filteredTransactions: [] as any[],
      summary: {
        total: allTransactions?.length || 0,
        paymentTransactions: 0,
        pendingTransactions: 0,
        includedInCycles: 0,
        breakdown: {} as any
      }
    };

    const filteredByType: any = {
      payments: [],
      pending: [],
      included: []
    };

    // Analyze each transaction
    for (const transaction of allTransactions || []) {
      const card = cards.find(c => c.id === transaction.creditCardId);
      const isPayment = isPaymentTransaction(transaction.name || '');
      const isPending = transaction.authorizedDate === null;
      
      const transactionData = {
        ...transaction,
        cardName: card?.name,
        cardMask: card?.mask,
        isPayment,
        isPending,
        filterReason: [] as string[]
      };

      // Determine why this transaction would be filtered
      if (isPayment) {
        transactionData.filterReason.push('Payment transaction');
        filteredByType.payments.push(transactionData);
        result.summary.paymentTransactions++;
      }
      
      if (isPending) {
        transactionData.filterReason.push('Pending/unauthorized');
        filteredByType.pending.push(transactionData);
        result.summary.pendingTransactions++;
      }

      // If neither payment nor pending, it would be included in billing cycles
      if (!isPayment && !isPending) {
        filteredByType.included.push(transactionData);
        result.summary.includedInCycles++;
      } else {
        result.filteredTransactions.push(transactionData);
      }
    }

    // Create breakdown by card
    for (const card of cards) {
      const cardTransactions = allTransactions?.filter(t => t.creditCardId === card.id) || [];
      const cardPayments = cardTransactions.filter(t => isPaymentTransaction(t.name || ''));
      const cardPending = cardTransactions.filter(t => t.authorizedDate === null);
      const cardIncluded = cardTransactions.filter(t => 
        !isPaymentTransaction(t.name || '') && t.authorizedDate !== null
      );

      result.summary.breakdown[card.name] = {
        total: cardTransactions.length,
        payments: cardPayments.length,
        pending: cardPending.length,
        included: cardIncluded.length,
        paymentAmount: cardPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0),
        includedAmount: cardIncluded.reduce((sum, t) => sum + t.amount, 0)
      };
    }

    // Sort by amount (largest payments first)
    result.filteredTransactions.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    return NextResponse.json({
      ...result,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        days
      },
      cards: cards.map(c => ({ id: c.id, name: c.name, mask: c.mask }))
    });

  } catch (error) {
    console.error('Error fetching filtered transactions:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch filtered transactions',
      details: error.message 
    }, { status: 500 });
  }
}