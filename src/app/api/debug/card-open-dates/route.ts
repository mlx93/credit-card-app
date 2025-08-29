import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🔍 CARD OPEN DATES DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all credit cards with their billing cycles
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      include: {
        plaidItem: true,
        billingCycles: {
          orderBy: { startDate: 'asc' }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards for open date debug`);

    const debugResults = [];

    for (const card of creditCards) {
      console.log(`\n=== DEBUGGING ${card.name} OPEN DATE ===`);
      
      const cardOpenDate = card.openDate ? new Date(card.openDate) : null;
      const totalCycles = card.billingCycles.length;
      
      // Find cycles that should be filtered out
      const invalidCycles = card.billingCycles.filter(cycle => {
        if (!cardOpenDate) return false; // No open date to filter against
        
        const cycleStart = new Date(cycle.startDate);
        const cycleEnd = new Date(cycle.endDate);
        
        // These are the cycles that should be filtered out
        return cycleStart < cardOpenDate || cycleEnd < cardOpenDate;
      });
      
      const validCycles = card.billingCycles.filter(cycle => {
        if (!cardOpenDate) return true; // No filtering if no open date
        
        const cycleStart = new Date(cycle.startDate);
        const cycleEnd = new Date(cycle.endDate);
        
        // These are the cycles that should remain
        return cycleStart >= cardOpenDate && cycleEnd >= cardOpenDate;
      });

      const debugInfo = {
        cardName: card.name,
        cardId: card.id,
        openDate: cardOpenDate ? cardOpenDate.toDateString() : 'NOT SET',
        openDateISO: cardOpenDate ? cardOpenDate.toISOString() : null,
        totalBillingCycles: totalCycles,
        cyclesShouldBeFiltered: invalidCycles.length,
        cyclesShouldRemain: validCycles.length,
        invalidCyclesDetails: invalidCycles.map(cycle => ({
          cycleId: cycle.id,
          startDate: new Date(cycle.startDate).toDateString(),
          endDate: new Date(cycle.endDate).toDateString(),
          startDateISO: cycle.startDate.toISOString(),
          endDateISO: cycle.endDate.toISOString(),
          totalSpend: cycle.totalSpend,
          reason: (() => {
            const start = new Date(cycle.startDate);
            const end = new Date(cycle.endDate);
            if (!cardOpenDate) return 'No card open date';
            if (start < cardOpenDate && end < cardOpenDate) return 'Both start and end before open date';
            if (start < cardOpenDate) return 'Start date before open date';
            if (end < cardOpenDate) return 'End date before open date';
            return 'Unknown';
          })()
        })),
        validCyclesDetails: validCycles.slice(0, 3).map(cycle => ({
          cycleId: cycle.id,
          startDate: new Date(cycle.startDate).toDateString(),
          endDate: new Date(cycle.endDate).toDateString(),
          totalSpend: cycle.totalSpend
        })),
        institutionName: card.plaidItem?.institutionName || 'Unknown'
      };

      console.log(`Card: ${card.name}`);
      console.log(`Open Date: ${cardOpenDate ? cardOpenDate.toDateString() : 'NOT SET'}`);
      console.log(`Total Cycles: ${totalCycles}`);
      console.log(`Invalid Cycles: ${invalidCycles.length}`);
      console.log(`Valid Cycles: ${validCycles.length}`);
      
      if (invalidCycles.length > 0) {
        console.log('Invalid cycles that should be filtered:');
        invalidCycles.forEach(cycle => {
          console.log(`  - ${new Date(cycle.startDate).toDateString()} to ${new Date(cycle.endDate).toDateString()}`);
        });
      }
      
      debugResults.push(debugInfo);
    }

    console.log('\n🔍 CARD OPEN DATES DEBUG COMPLETED');
    
    return NextResponse.json({ 
      message: 'Card open dates debug completed',
      results: debugResults,
      summary: {
        totalCards: debugResults.length,
        cardsWithOpenDate: debugResults.filter(r => r.openDate !== 'NOT SET').length,
        cardsWithInvalidCycles: debugResults.filter(r => r.cyclesShouldBeFiltered > 0).length,
        totalInvalidCycles: debugResults.reduce((sum, r) => sum + r.cyclesShouldBeFiltered, 0)
      }
    });
  } catch (error) {
    console.error('🔍 CARD OPEN DATES DEBUG ERROR:', error);
    return NextResponse.json({ error: 'Failed to debug card open dates' }, { status: 500 });
  }
}