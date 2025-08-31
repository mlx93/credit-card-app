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

    // Get user's Plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, item_id, institution_name')
      .eq('user_id', session.user.id);
    
    if (plaidError) {
      console.error('Error fetching plaid items:', plaidError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Get user's credit cards with transaction counts
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select(`
        id,
        account_id,
        name,
        mask,
        plaid_item_id,
        balance_current,
        balance_limit,
        last_statement_balance,
        plaid_items!inner(user_id),
        transactions(id)
      `)
      .eq('plaid_items.user_id', session.user.id);
    
    if (cardsError) {
      console.error('Error fetching credit cards:', cardsError);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Get total transaction count
    const { count: totalTransactions, error: countError } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('plaid_item_id', (plaidItems || []).map(item => item.id));
    
    if (countError) {
      console.error('Error counting transactions:', countError);
    }

    // Get recent transactions
    const { data: recentTransactions, error: recentError } = await supabaseAdmin
      .from('transactions')
      .select('id, transaction_id, name, amount, date, credit_card_id, plaid_item_id')
      .in('plaid_item_id', (plaidItems || []).map(item => item.id))
      .order('date', { ascending: false })
      .limit(10);
    
    if (recentError) {
      console.error('Error fetching recent transactions:', recentError);
    }

    // Get transaction counts by credit card (manual grouping with Supabase)
    const transactionsByCard = (creditCards || []).map(card => ({
      creditCardId: card.id,
      _count: {
        _all: card.transactions?.length || 0
      }
    }));

    // Get date range of transactions
    const { data: dateRangeData, error: dateError } = await supabaseAdmin
      .from('transactions')
      .select('date')
      .in('plaid_item_id', (plaidItems || []).map(item => item.id))
      .order('date', { ascending: true })
      .limit(1);
    
    const { data: maxDateData, error: maxDateError } = await supabaseAdmin
      .from('transactions')
      .select('date')
      .in('plaid_item_id', (plaidItems || []).map(item => item.id))
      .order('date', { ascending: false })
      .limit(1);
    
    const dateRange = {
      _min: { date: dateRangeData?.[0]?.date || null },
      _max: { date: maxDateData?.[0]?.date || null }
    };
    
    if (dateError) console.error('Error fetching min date:', dateError);
    if (maxDateError) console.error('Error fetching max date:', maxDateError);

    return NextResponse.json({
      plaidItems: (plaidItems || []).map(item => ({
        id: item.id,
        itemId: item.item_id,
        institutionName: item.institution_name
      })),
      creditCards: (creditCards || []).map(card => ({
        id: card.id,
        accountId: card.account_id,
        name: card.name,
        mask: card.mask,
        plaidItemId: card.plaid_item_id,
        balanceCurrent: card.balance_current,
        balanceLimit: card.balance_limit,
        lastStatementBalance: card.last_statement_balance,
        _count: {
          transactions: card.transactions?.length || 0
        }
      })),
      transactionStats: {
        total: totalTransactions || 0,
        byCard: transactionsByCard,
        dateRange: {
          earliest: dateRange._min.date,
          latest: dateRange._max.date
        }
      },
      recentTransactions: (recentTransactions || []).map(t => ({
        id: t.id,
        transactionId: t.transaction_id,
        name: t.name,
        amount: t.amount,
        date: t.date,
        creditCardId: t.credit_card_id,
        plaidItemId: t.plaid_item_id
      }))
    });

  } catch (error) {
    console.error('Database debug error:', error);
    return NextResponse.json({ error: 'Debug failed' }, { status: 500 });
  }
}