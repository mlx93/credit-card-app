import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;

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
      return NextResponse.json({ transactions: [] });
    }

    // Build query for transactions
    let query = supabaseAdmin
      .from('transactions')
      .select(`
        *,
        credit_cards!inner(name, mask)
      `)
      .in('plaiditemid', plaidItemIds)
      .order('date', { ascending: false })
      .limit(limit);

    // Add date filtering if provided
    if (startDate && endDate) {
      query = query
        .gte('date', new Date(startDate).toISOString())
        .lte('date', new Date(endDate).toISOString());
    }

    const { data: transactions, error: transactionsError } = await query;

    if (transactionsError) {
      throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
    }

    // Format the response to match the original Prisma structure
    const formattedTransactions = (transactions || []).map(transaction => ({
      ...transaction,
      creditCard: transaction.credit_cards ? {
        name: transaction.credit_cards.name,
        mask: transaction.credit_cards.mask,
      } : null
    }));

    return NextResponse.json({ transactions: formattedTransactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}