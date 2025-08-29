import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('🔍 BOA BILLING CYCLE DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the Bank of America card
    const boaCard = await prisma.creditCard.findFirst({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        name: {
          contains: 'Customized Cash Rewards'
        }
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true
          }
        },
        transactions: {
          orderBy: { date: 'asc' },
          take: 10 // Get first 10 transactions to see the pattern
        },
        billingCycles: {
          orderBy: { startDate: 'asc' }
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'BoA card not found' }, { status: 404 });
    }

    // Simulate the billing cycle calculation logic
    const lastStatementDate = boaCard.lastStatementIssueDate;
    const nextDueDate = boaCard.nextPaymentDueDate;
    const openDate = boaCard.openDate;
    
    console.log('=== BILLING CYCLE DEBUG DATA ===');
    console.log('Card name:', boaCard.name);
    console.log('Open date:', openDate?.toDateString());
    console.log('Last statement date:', lastStatementDate?.toDateString());
    console.log('Next due date:', nextDueDate?.toDateString());
    
    // Calculate cycle length (same logic as billingCycles.ts)
    let cycleLength = 30; // Default
    if (lastStatementDate && nextDueDate) {
      const daysBetween = Math.ceil((nextDueDate.getTime() - lastStatementDate.getTime()) / (1000 * 60 * 60 * 24));
      const estimatedCycleLength = Math.max(daysBetween - 21, 25); // Assume ~21 day grace period
      cycleLength = Math.min(Math.max(estimatedCycleLength, 25), 35); // Between 25-35 days
    }
    
    console.log('Calculated cycle length:', cycleLength);
    
    // Calculate the closed cycle (contains statement balance)
    const closedCycleEnd = new Date(lastStatementDate!);
    const closedCycleStart = new Date(closedCycleEnd);
    closedCycleStart.setDate(closedCycleStart.getDate() - cycleLength + 1);
    
    console.log('Closed cycle:', closedCycleStart.toDateString(), 'to', closedCycleEnd.toDateString());
    
    // Calculate what the next historical cycle should be
    let historicalCycleEnd = new Date(closedCycleStart);
    historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
    const historicalCycleStart = new Date(historicalCycleEnd);
    historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);
    
    console.log('Next historical cycle should be:', historicalCycleStart.toDateString(), 'to', historicalCycleEnd.toDateString());
    console.log('Historical cycle start vs open date:', {
      cycleStart: historicalCycleStart.toDateString(),
      openDate: openDate?.toDateString(),
      startsAfterOpen: historicalCycleStart >= new Date(openDate!)
    });
    
    // Check which transactions would be in this missing cycle
    const transactionsInMissingCycle = boaCard.transactions.filter(t => {
      const transDate = new Date(t.date);
      return transDate >= historicalCycleStart && transDate <= historicalCycleEnd;
    });
    
    console.log('Transactions that should be in missing cycle:', transactionsInMissingCycle.map(t => ({
      date: t.date.toDateString(),
      name: t.name,
      amount: t.amount
    })));

    return NextResponse.json({
      message: 'BoA billing cycle debug completed',
      cardName: boaCard.name,
      dates: {
        openDate: openDate?.toDateString(),
        lastStatementDate: lastStatementDate?.toDateString(),
        nextDueDate: nextDueDate?.toDateString()
      },
      cycleCalculation: {
        cycleLength,
        closedCycle: {
          start: closedCycleStart.toDateString(),
          end: closedCycleEnd.toDateString()
        },
        missingHistoricalCycle: {
          start: historicalCycleStart.toDateString(),
          end: historicalCycleEnd.toDateString(),
          shouldExist: historicalCycleStart >= new Date(openDate!),
          transactionCount: transactionsInMissingCycle.length
        }
      },
      existingCycles: boaCard.billingCycles.map(cycle => ({
        start: cycle.startDate.toDateString(),
        end: cycle.endDate.toDateString(),
        totalSpend: cycle.totalSpend
      })),
      transactionsInMissingCycle: transactionsInMissingCycle.map(t => ({
        date: t.date.toDateString(),
        name: t.name,
        amount: t.amount
      }))
    });

  } catch (error) {
    console.error('🔍 BOA BILLING DEBUG ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to debug BoA billing cycles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}