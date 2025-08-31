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

    // Get the exact data that getAllUserBillingCycles processes
    const { data: plaidItems, error } = await supabaseAdmin
      .from('plaid_items')
      .select(`
        *,
        credit_cards (*)
      `)
      .eq('user_id', session.user.id);
    
    if (error) {
      console.error('Error fetching plaid items:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    const amexDebugInfo = [];

    for (const item of plaidItems) {
      for (const card of item.credit_cards || []) {
        if (card.name?.includes('Platinum')) {
          // Get all cycles for this card
          const { data: allCycles, error: cyclesError } = await supabaseAdmin
            .from('billing_cycles')
            .select('*')
            .eq('credit_card_id', card.id)
            .order('start_date', { ascending: false });
          
          if (cyclesError) {
            console.error('Error fetching billing cycles:', cyclesError);
            continue;
          }

          // Simulate the filtering logic from getAllUserBillingCycles
          const oneYearAgo = new Date();
          oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
          const cardOpenDate = card.open_date ? new Date(card.open_date) : oneYearAgo;
          const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;

          const filteredCycles = (allCycles || []).filter(cycle => {
            const cycleEnd = new Date(cycle.end_date);
            return cycleEnd >= cardOpenDate;
          });

          // Capital One detection function
          function isCapitalOneCard(institutionName?: string, cardName?: string): boolean {
            const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
            const institutionMatch = institutionName?.toLowerCase().includes('capital one') || false;
            const cardMatch = capitalOneIndicators.some(indicator => 
              cardName?.toLowerCase().includes(indicator)
            ) || false;
            
            return institutionMatch || cardMatch;
          }

          const isCapitalOne = isCapitalOneCard(item.institutionName, card.name);

          amexDebugInfo.push({
            cardId: card.id,
            cardName: card.name,
            institutionName: item.institutionName,
            itemId: item.id,
            isCapitalOne,
            allCyclesCount: allCycles.length,
            filteredCyclesCount: filteredCycles.length,
            cardOpenDate: card.openDate,
            oneYearAgo: oneYearAgo.toISOString(),
            earliestCycleDate: earliestCycleDate.toISOString(),
            wouldBeSlicedTo4: isCapitalOne ? 4 : filteredCycles.length,
            allCycleDates: allCycles.map(c => ({
              id: c.id,
              startDate: c.startDate.toISOString(),
              endDate: c.endDate.toISOString(),
              passesFilter: new Date(c.endDate) >= cardOpenDate
            }))
          });
        }
      }
    }

    return NextResponse.json({
      message: 'Amex filtering debug completed',
      amexCards: amexDebugInfo
    });

  } catch (error) {
    console.error('Amex filtering debug error:', error);
    return NextResponse.json({ 
      error: 'Failed to debug Amex filtering',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}