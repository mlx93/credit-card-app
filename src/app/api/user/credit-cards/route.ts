import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Supabase query with joins
    const { data: creditCards, error } = await supabase
      .from('credit_cards')
      .select(`
        *,
        plaid_items!inner (
          id,
          item_id,
          institution_name,
          status,
          last_sync_at,
          error_message
        ),
        aprs (*)
      `)
      .eq('plaid_items.user_id', session.user.id)
      .order('created_at', { ascending: false });

    // Get transaction counts separately (Supabase doesn't support _count like Prisma)
    if (creditCards && creditCards.length > 0) {
      for (const card of creditCards) {
        const { count } = await supabase
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .eq('credit_card_id', card.id);
        
        card._count = { transactions: count || 0 };
      }
    }

    if (error) {
      console.error('Supabase error fetching credit cards:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    const response = NextResponse.json({ creditCards });
    
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