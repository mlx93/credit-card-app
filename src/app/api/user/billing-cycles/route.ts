import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUserBillingCycles } from '@/utils/billingCycles';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const recentOnly = url.searchParams.get('recent') === '1' || url.searchParams.get('recent') === 'true';

    let billingCycles: any[] = [];
    if (recentOnly) {
      const { data: cards, error: cardsErr } = await supabaseAdmin
        .from('credit_cards')
        .select('id, name, mask, plaid_items!inner(userId)')
        .eq('plaid_items.userId', session.user.id);
      if (cardsErr) throw new Error(`Failed to fetch cards for cycles: ${cardsErr.message}`);
      const ids = (cards || []).map(c => c.id);
      if (ids.length === 0) {
        billingCycles = [];
      } else {
        const { data: cycles, error: cyclesErr } = await supabaseAdmin
          .from('billing_cycles')
          .select('*')
          .in('creditCardId', ids)
          .order('endDate', { ascending: false });
        if (cyclesErr) throw new Error(`Failed to fetch cycles: ${cyclesErr.message}`);
        const byCard = new Map<string, any[]>();
        for (const c of (cycles || [])) {
          const arr = byCard.get(c.creditCardId) || [];
          if (arr.length < 2) arr.push(c);
          byCard.set(c.creditCardId, arr);
        }
        billingCycles = Array.from(byCard.values()).flat();
      }
    } else {
      billingCycles = await getAllUserBillingCycles(session.user.id);
    }

    // Debug logging to compare with debug endpoint
    const amexCycles = billingCycles.filter(c => 
      c.creditCardName?.toLowerCase().includes('platinum')
    );
    
    console.log('🔍 USER BILLING CYCLES API:', {
      userId: session.user.id,
      totalCycles: billingCycles.length,
      amexCycles: amexCycles.length,
      amexCycleIds: amexCycles.slice(0, 5).map(c => ({
        id: c.id?.substring(0, 8),
        startDate: c.startDate,
        endDate: c.endDate
      }))
    });

    return NextResponse.json({ billingCycles });
  } catch (error) {
    console.error('Error fetching billing cycles:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}