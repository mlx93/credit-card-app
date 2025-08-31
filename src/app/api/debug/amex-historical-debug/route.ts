import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    console.log('🔍 DEBUGGING AMEX HISTORICAL CYCLES');
    
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
    
    // Find Amex Platinum card
    const { data: amexCards, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .ilike('name', '%Platinum%');

    if (cardError) {
      throw new Error(`Failed to fetch credit cards: ${cardError.message}`);
    }

    const amexCard = amexCards?.[0];

    if (!amexCard) {
      return NextResponse.json({ error: 'Amex card not found' }, { status: 404 });
    }

    // Get ALL billing cycles for Amex card (before any filtering)
    const { data: allAmexCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', amexCard.id)
      .order('startDate', { ascending: false });

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // Calculate date limits
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
    const cardOpenDate = amexCard.openDate ? new Date(amexCard.openDate) : oneYearAgo;
    const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;

    // Analyze each cycle
    const cycleAnalysis = (allAmexCycles || []).map(cycle => {
      const startDate = new Date(cycle.startDate);
      const endDate = new Date(cycle.endDate);
      
      return {
        id: cycle.id,
        period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        startDate: startDate.toDateString(),
        endDate: endDate.toDateString(),
        totalSpend: cycle.totalSpend,
        statementBalance: cycle.statementBalance,
        hasStatement: cycle.statementBalance !== null,
        isWithinOneYear: endDate >= oneYearAgo,
        isAfterCardOpen: endDate >= cardOpenDate,
        isAfterEarliestDate: endDate >= earliestCycleDate,
        monthsFromToday: Math.round((today.getTime() - endDate.getTime()) / (30 * 24 * 60 * 60 * 1000))
      };
    });

    return NextResponse.json({
      message: 'Amex historical cycles debug completed',
      amexCard: {
        id: amexCard.id,
        name: amexCard.name,
        openDate: amexCard.openDate?.toISOString().split('T')[0],
        accountId: amexCard.accountId
      },
      dateLimits: {
        today: today.toDateString(),
        oneYearAgo: oneYearAgo.toDateString(),
        cardOpenDate: cardOpenDate.toDateString(),
        earliestCycleDate: earliestCycleDate.toDateString(),
        cardOpenedRecently: cardOpenDate > oneYearAgo
      },
      cycleAnalysis: cycleAnalysis,
      summary: {
        totalCyclesInDatabase: (allAmexCycles || []).length,
        cyclesWithinOneYear: cycleAnalysis.filter(c => c.isWithinOneYear).length,
        cyclesAfterCardOpen: cycleAnalysis.filter(c => c.isAfterCardOpen).length,
        cyclesAfterEarliestDate: cycleAnalysis.filter(c => c.isAfterEarliestDate).length,
        historicalCycles: cycleAnalysis.filter(c => c.hasStatement).length,
        oldestCycleMonthsAgo: Math.max(...cycleAnalysis.map(c => c.monthsFromToday))
      }
    });

  } catch (error) {
    console.error('🔍 AMEX DEBUG ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to debug Amex historical cycles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}