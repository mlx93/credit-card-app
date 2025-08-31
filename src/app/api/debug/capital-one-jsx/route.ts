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

    // Get Capital One cards with all relevant fields
    const capitalOneCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: { userId: session.user.id },
        OR: [
          { name: { contains: 'Capital One', mode: 'insensitive' } },
          { name: { contains: 'Quicksilver', mode: 'insensitive' } },
          { name: { contains: 'Venture', mode: 'insensitive' } },
        ]
      },
      select: {
        id: true,
        name: true,
        mask: true,
        balanceCurrent: true,
        balanceLimit: true,
        balanceAvailable: true,
        lastStatementBalance: true,
        nextPaymentDueDate: true,
        minimumPaymentAmount: true
      }
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