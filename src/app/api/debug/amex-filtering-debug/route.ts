import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the exact data that getAllUserBillingCycles processes
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      include: {
        accounts: true,
      },
    });

    const amexDebugInfo = [];

    for (const item of plaidItems) {
      for (const card of item.accounts) {
        if (card.name?.includes('Platinum')) {
          // Get all cycles for this card
          const allCycles = await prisma.billingCycle.findMany({
            where: { creditCardId: card.id },
            orderBy: { startDate: 'desc' }
          });

          // Simulate the filtering logic from getAllUserBillingCycles
          const oneYearAgo = new Date();
          oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
          const cardOpenDate = card.openDate ? new Date(card.openDate) : oneYearAgo;
          const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;

          const filteredCycles = allCycles.filter(cycle => {
            const cycleEnd = new Date(cycle.endDate);
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