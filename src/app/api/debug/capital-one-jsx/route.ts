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

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards
    const { data: allCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Filter for Capital One cards
    const capitalOneIndicators = ['capital one', 'quicksilver', 'venture'];
    const capitalOneCards = (allCards || []).filter(card => {
      const cardNameLower = card.name?.toLowerCase() || '';
      return capitalOneIndicators.some(indicator => cardNameLower.includes(indicator));
    });

    // Calculate the same values as DueDateCard component
    const cardDebugInfo = capitalOneCards.map(card => {
      const hasValidLimit = card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit) && !isNaN(card.balanceLimit);
      const utilization = hasValidLimit ? Math.abs(card.balanceCurrent || 0) / card.balanceLimit * 100 : 0;
      const currentBalance = Math.abs(card.balanceCurrent || 0);
      const minPayment = card.minimumPaymentAmount;
      const isPaidOff = (currentBalance === 0) || (minPayment === null || minPayment === undefined || minPayment === 0);

      return {
        name: card.name,
        mask: card.mask,
        rawValues: {
          balanceCurrent: card.balanceCurrent,
          balanceLimit: card.balanceLimit,
          balanceAvailable: card.balanceAvailable,
          lastStatementBalance: card.lastStatementBalance,
          minimumPaymentAmount: card.minimumPaymentAmount
        },
        calculatedValues: {
          hasValidLimit,
          utilization,
          currentBalance,
          isPaidOff,
          utilizationFormatted: `${utilization.toFixed(1)}%`
        },
        possibleStrayValues: {
          // These might be displayed as raw numbers somewhere
          utilizationRaw: utilization,
          utilizationRounded: Math.round(utilization),
          balanceLimitRaw: card.balanceLimit,
          balanceCurrentRaw: card.balanceCurrent
        }
      };
    });

    return NextResponse.json({
      success: true,
      totalCapitalOneCards: capitalOneCards.length,
      cardDebugInfo
    });

  } catch (error) {
    console.error('Capital One JSX debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}