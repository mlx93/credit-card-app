import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, institutionName')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    // Get transaction counts by plaid item
    const transactionStats = await Promise.all((plaidItems || []).map(async (item) => {
      // Get count of transactions
      const { count, error: countError } = await supabaseAdmin
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('plaidItemId', item.id);

      if (countError) {
        console.error(`Error counting transactions for item ${item.id}:`, countError);
      }

      // Get recent transactions
      const { data: recent, error: recentError } = await supabaseAdmin
        .from('transactions')
        .select('id, transactionId, date, amount, name, creditCardId')
        .eq('plaidItemId', item.id)
        .order('date', { ascending: false })
        .limit(5);

      if (recentError) {
        console.error(`Error fetching recent transactions for item ${item.id}:`, recentError);
      }

      // Get oldest transaction
      const { data: oldestData, error: oldestError } = await supabaseAdmin
        .from('transactions')
        .select('date')
        .eq('plaidItemId', item.id)
        .order('date', { ascending: true })
        .limit(1);

      if (oldestError) {
        console.error(`Error fetching oldest transaction for item ${item.id}:`, oldestError);
      }

      // Get newest transaction
      const { data: newestData, error: newestError } = await supabaseAdmin
        .from('transactions')
        .select('date')
        .eq('plaidItemId', item.id)
        .order('date', { ascending: false })
        .limit(1);

      if (newestError) {
        console.error(`Error fetching newest transaction for item ${item.id}:`, newestError);
      }

      const oldest = oldestData?.[0];
      const newest = newestData?.[0];

      return {
        institutionName: item.institutionName,
        itemId: item.itemId,
        totalTransactions: count || 0,
        dateRange: {
          oldest: oldest?.date,
          newest: newest?.date
        },
        recentTransactions: recent || []
      };
    }));

    // Get credit card info
    const plaidItemIds = (plaidItems || []).map(item => item.id);
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, accountId, plaidItemId')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Get recent transactions for each card
    const creditCardsWithTransactions = await Promise.all((creditCards || []).map(async (card) => {
      const { data: transactions, error: transError } = await supabaseAdmin
        .from('transactions')
        .select('id, date')
        .eq('creditCardId', card.id)
        .order('date', { ascending: false })
        .limit(3);

      if (transError) {
        console.error(`Error fetching transactions for card ${card.id}:`, transError);
      }

      return {
        ...card,
        transactions: transactions || []
      };
    }));

    return NextResponse.json({
      plaidItems: (plaidItems || []).length,
      transactionStats,
      creditCards: creditCardsWithTransactions.map(card => ({
        name: card.name,
        accountId: card.accountId,
        linkedTransactions: card.transactions.length,
        recentTransactionDates: card.transactions.map(t => t.date)
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ 
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}