import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🧠 SMART FIX BOA CYCLES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the Bank of America card and analyze its transaction patterns
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
          take: 50 // Get more transactions to analyze patterns
        },
        billingCycles: {
          orderBy: { startDate: 'asc' },
          include: {
            transactions: {
              select: {
                id: true
              }
            }
          }
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'Bank of America card not found' }, { status: 404 });
    }

    console.log('=== TRANSACTION ANALYSIS ===');
    
    // Analyze transaction patterns
    const allTransactions = boaCard.transactions;
    const earliestTransaction = allTransactions[0];
    const transactionDates = allTransactions.slice(0, 10).map(t => ({
      date: t.date.toDateString(),
      name: t.name,
      amount: t.amount
    }));

    console.log('Earliest 10 transactions:', transactionDates);

    // Analyze existing cycles to see which ones have transaction data
    console.log('=== EXISTING CYCLES ANALYSIS ===');
    const cyclesWithTransactions = boaCard.billingCycles
      .filter(cycle => cycle.transactions.length > 0)
      .map(cycle => ({
        startDate: cycle.startDate.toDateString(),
        endDate: cycle.endDate.toDateString(),
        transactionCount: cycle.transactions.length,
        totalSpend: cycle.totalSpend
      }));

    console.log('Cycles with transactions:', cyclesWithTransactions);

    // Find the earliest cycle that has transactions (this should be preserved)
    const earliestCycleWithTransactions = boaCard.billingCycles
      .filter(cycle => cycle.transactions.length > 0)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

    if (!earliestCycleWithTransactions) {
      return NextResponse.json({ error: 'No cycles with transactions found' }, { status: 400 });
    }

    console.log('Earliest cycle with transactions:', {
      startDate: earliestCycleWithTransactions.startDate.toDateString(),
      endDate: earliestCycleWithTransactions.endDate.toDateString(),
      transactionCount: earliestCycleWithTransactions.transactions.length,
      totalSpend: earliestCycleWithTransactions.totalSpend
    });

    // Set open date to be 2-3 weeks before the earliest cycle with transactions
    const smartOpenDate = new Date(earliestCycleWithTransactions.startDate);
    smartOpenDate.setDate(smartOpenDate.getDate() - 21); // 3 weeks before first real cycle

    console.log('=== SMART OPEN DATE CALCULATION ===');
    console.log('Current open date:', boaCard.openDate?.toDateString() || 'null');
    console.log('Earliest transaction date:', earliestTransaction?.date.toDateString() || 'none');
    console.log('Earliest cycle with transactions starts:', earliestCycleWithTransactions.startDate.toDateString());
    console.log('Smart open date (3 weeks before first real cycle):', smartOpenDate.toDateString());

    // Update with the smart open date using a transaction
    const updateResult = await prisma.$transaction(async (tx) => {
      // Update the card with smart open date
      const updatedCard = await tx.creditCard.update({
        where: { id: boaCard.id },
        data: { 
          openDate: smartOpenDate,
          updatedAt: new Date()
        }
      });

      // Delete only cycles that start before the smart open date AND have no transactions
      const deleteResult = await tx.billingCycle.deleteMany({
        where: {
          creditCardId: boaCard.id,
          startDate: {
            lt: smartOpenDate
          },
          // This ensures we only delete empty cycles
          transactions: {
            none: {}
          }
        }
      });

      return { updatedCard, deletedEmptyCycles: deleteResult.count };
    });

    console.log('Smart update completed:', {
      newOpenDate: updateResult.updatedCard.openDate?.toDateString(),
      deletedEmptyCycles: updateResult.deletedEmptyCycles,
      preservedCyclesWithTransactions: cyclesWithTransactions.length
    });

    // Regenerate billing cycles to fill any gaps
    console.log('Triggering billing cycle regeneration...');
    try {
      const regenResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/billing-cycles/regenerate`, {
        method: 'POST'
      });
      
      if (regenResponse.ok) {
        console.log('✅ Billing cycles regenerated successfully');
      } else {
        console.warn('⚠️ Billing cycle regeneration failed');
      }
    } catch (regenError) {
      console.error('Error regenerating billing cycles:', regenError);
    }

    console.log('🧠 SMART BOA CYCLES FIX COMPLETED');
    
    return NextResponse.json({ 
      message: 'BoA cycles intelligently corrected',
      cardName: boaCard.name,
      analysis: {
        oldOpenDate: boaCard.openDate?.toDateString() || 'null',
        newSmartOpenDate: smartOpenDate.toDateString(),
        earliestTransactionDate: earliestTransaction?.date.toDateString() || 'none',
        earliestCycleWithTransactionsStart: earliestCycleWithTransactions.startDate.toDateString(),
        earliestCycleWithTransactionsEnd: earliestCycleWithTransactions.endDate.toDateString()
      },
      preservedCycles: cyclesWithTransactions,
      deletedEmptyCycles: updateResult.deletedEmptyCycles,
      billingCyclesRegenerated: true
    });

  } catch (error) {
    console.error('🧠 SMART BOA CYCLES FIX ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to smart fix BoA cycles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}