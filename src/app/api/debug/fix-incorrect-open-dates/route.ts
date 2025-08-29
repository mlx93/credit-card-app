import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🔧 FIX INCORRECT OPEN DATES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find all cards and check if open date seems wrong compared to earliest transaction
    const allCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
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
          take: 1 // Get the earliest transaction
        }
      }
    });

    console.log(`Found ${allCards.length} total cards to check`);

    const fixes = [];

    for (const card of allCards) {
      if (card.transactions.length > 0 && card.openDate) {
        const earliestTransaction = card.transactions[0];
        const currentOpenDate = new Date(card.openDate);
        const earliestTransactionDate = new Date(earliestTransaction.date);
        
        // If open date is more than 30 days before earliest transaction, it's likely wrong
        const daysDifference = Math.abs((earliestTransactionDate.getTime() - currentOpenDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDifference > 90) { // More than 3 months difference suggests wrong open date
          console.log(`Card ${card.name} has suspicious open date:`, {
            cardName: card.name,
            currentOpenDate: currentOpenDate.toDateString(),
            earliestTransactionDate: earliestTransactionDate.toDateString(),
            daysDifference: Math.round(daysDifference)
          });
          
          // Use earliest transaction date minus 7 days as corrected open date
          const correctedOpenDate = new Date(earliestTransactionDate);
          correctedOpenDate.setDate(correctedOpenDate.getDate() - 7);
          
          console.log(`Correcting open date for ${card.name} from ${currentOpenDate.toDateString()} to ${correctedOpenDate.toDateString()}`);

          // Update the card with the corrected open date
          await prisma.creditCard.update({
            where: { id: card.id },
            data: { openDate: correctedOpenDate }
          });

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            oldOpenDate: currentOpenDate.toDateString(),
            newOpenDate: correctedOpenDate.toDateString(),
            earliestTransactionDate: earliestTransactionDate.toDateString(),
            daysDifferenceFound: Math.round(daysDifference),
            transactionUsed: {
              name: earliestTransaction.name,
              amount: earliestTransaction.amount,
              date: earliestTransaction.date.toDateString()
            }
          });
        }
      }
    }

    // After fixing open dates, regenerate billing cycles
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration with corrected open dates...');
      
      const deleteResult = await prisma.billingCycle.deleteMany({
        where: {
          creditCard: {
            plaidItem: {
              userId: session.user.id
            }
          }
        }
      });
      
      console.log(`Deleted ${deleteResult.count} billing cycles`);

      // Trigger billing cycle regeneration
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
    }

    console.log('🔧 INCORRECT OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Incorrect open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesRegenerated: fixes.length > 0
    });

  } catch (error) {
    console.error('🔧 FIX INCORRECT OPEN DATES ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix incorrect open dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}