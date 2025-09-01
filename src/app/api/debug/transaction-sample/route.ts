import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({ message: 'No plaid items found' });
    }

    // Get sample transactions with all details
    const { data: transactions, error: transactionsError } = await supabaseAdmin
      .from('transactions')
      .select(`
        *,
        credit_cards!inner(id, name, mask)
      `)
      .in('plaidItemId', plaidItemIds)
      .order('date', { ascending: false })
      .limit(5);

    if (transactionsError) {
      throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
    }

    return NextResponse.json({
      sampleTransactions: transactions,
      totalFound: transactions?.length || 0,
      fieldsAvailable: transactions?.[0] ? Object.keys(transactions[0]) : [],
      categoryInfo: {
        transactionsWithCategory: transactions?.filter(t => t.category)?.length || 0,
        uniqueCategories: [...new Set(transactions?.map(t => t.category).filter(Boolean))] || [],
        sampleCategory: transactions?.find(t => t.category)?.category || null
      },
      creditCardInfo: {
        transactionsWithCreditCard: transactions?.filter(t => t.creditCardId)?.length || 0,
        transactionsWithCreditCardData: transactions?.filter(t => t.credit_cards)?.length || 0,
        uniqueCreditCardIds: [...new Set(transactions?.map(t => t.creditCardId).filter(Boolean))] || [],
        uniqueCreditCardNames: [...new Set(transactions?.map(t => t.credit_cards?.name).filter(Boolean))] || []
      }
    });
  } catch (error) {
    console.error('Error in transaction sample debug:', error);
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
  }
}