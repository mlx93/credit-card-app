import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'billing-cycles-status',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if all user's credit cards have billing cycles
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name')
      .eq('userId', session.user.id);

    if (cardsError) {
      return NextResponse.json({ error: 'Failed to fetch cards' }, { status: 500 });
    }

    if (!creditCards || creditCards.length === 0) {
      return NextResponse.json({ 
        ready: true, 
        message: 'No cards to check' 
      });
    }

    // Check if each card has billing cycles
    const cardStatuses = await Promise.all(
      creditCards.map(async (card) => {
        const { count, error } = await supabaseAdmin
          .from('billing_cycles')
          .select('id', { count: 'exact' })
          .eq('creditCardId', card.id);

        return {
          cardId: card.id,
          cardName: card.name,
          hasCycles: !error && (count || 0) > 0,
          cycleCount: count || 0
        };
      })
    );

    const allCardsReady = cardStatuses.every(status => status.hasCycles);
    const totalCycles = cardStatuses.reduce((sum, status) => sum + status.cycleCount, 0);

    return NextResponse.json({
      ready: allCardsReady,
      cardStatuses,
      totalCycles,
      message: allCardsReady 
        ? `All ${creditCards.length} cards have billing cycles (${totalCycles} total)`
        : `${cardStatuses.filter(s => !s.hasCycles).length} cards still generating cycles`
    });

  } catch (error) {
    console.error('Billing cycle status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}