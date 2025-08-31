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
      .select('id, itemId, institutionName, status, lastSyncAt, errorMessage')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({ creditCards: [] });
    }

    // Get credit cards for user's plaid items
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .order('createdAt', { ascending: false });

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    const creditCardIds = (creditCards || []).map(card => card.id);

    // Get APRs for all credit cards
    const { data: aprs, error: aprsError } = await supabaseAdmin
      .from('aprs')
      .select('*')
      .in('creditCardId', creditCardIds);

    if (aprsError) {
      throw new Error(`Failed to fetch APRs: ${aprsError.message}`);
    }

    // Get transaction counts for each credit card
    const transactionCounts = new Map();
    if (creditCardIds.length > 0) {
      const { data: transactions, error: transactionError } = await supabaseAdmin
        .from('transactions')
        .select('creditCardId')
        .in('creditCardId', creditCardIds)
        .not('creditCardId', 'is', null);

      if (!transactionError && transactions) {
        transactions.forEach(t => {
          const count = transactionCounts.get(t.creditCardId) || 0;
          transactionCounts.set(t.creditCardId, count + 1);
        });
      }
    }

    // Create maps for efficient lookup
    const plaidItemMap = new Map();
    (plaidItems || []).forEach(item => {
      plaidItemMap.set(item.id, item);
    });

    const aprMap = new Map();
    (aprs || []).forEach(apr => {
      const cardAprs = aprMap.get(apr.creditCardId) || [];
      cardAprs.push(apr);
      aprMap.set(apr.creditCardId, cardAprs);
    });

    // Combine all data
    const formattedCreditCards = (creditCards || []).map(card => ({
      ...card,
      plaidItem: plaidItemMap.get(card.plaidItemId) || null,
      aprs: aprMap.get(card.id) || [],
      _count: {
        transactions: transactionCounts.get(card.id) || 0,
      },
    }));

    const response = NextResponse.json({ creditCards: formattedCreditCards });
    
    // Add no-cache headers to ensure fresh data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('Error fetching credit cards:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}