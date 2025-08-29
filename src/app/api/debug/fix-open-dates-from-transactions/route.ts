import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🔧 FIX OPEN DATES FROM TRANSACTIONS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find cards without open dates
    const cardsWithoutOpenDates = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        openDate: null
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

    console.log(`Found ${cardsWithoutOpenDates.length} cards without open dates`);

    const fixes = [];

    for (const card of cardsWithoutOpenDates) {
      if (card.transactions.length > 0) {
        const earliestTransaction = card.transactions[0];
        const estimatedOpenDate = new Date(earliestTransaction.date);
        
        // Move the estimated open date back by a few days to be conservative
        // (first transaction might not be the very first day the card was opened)
        estimatedOpenDate.setDate(estimatedOpenDate.getDate() - 7);
        
        console.log(`Setting open date for ${card.name} based on earliest transaction:`, {
          cardName: card.name,
          earliestTransactionDate: earliestTransaction.date.toDateString(),
          earliestTransactionName: earliestTransaction.name,
          estimatedOpenDate: estimatedOpenDate.toDateString()
        });

        // Update the card with the estimated open date
        await prisma.creditCard.update({
          where: { id: card.id },
          data: { openDate: estimatedOpenDate }
        });

        fixes.push({
          cardName: card.name,
          institutionName: card.plaidItem?.institutionName,
          method: 'earliest_transaction',
          earliestTransactionDate: earliestTransaction.date.toDateString(),
          estimatedOpenDate: estimatedOpenDate.toDateString(),
          transactionUsed: {
            name: earliestTransaction.name,
            amount: earliestTransaction.amount,
            date: earliestTransaction.date.toDateString()
          }
        });
      } else {
        // No transactions available - use statement date as fallback
        if (card.lastStatementIssueDate) {
          const statementDate = new Date(card.lastStatementIssueDate);
          const estimatedOpenDate = new Date(statementDate);
          estimatedOpenDate.setMonth(estimatedOpenDate.getMonth() - 6); // 6 months before first statement

          console.log(`Setting open date for ${card.name} based on statement date:`, {
            cardName: card.name,
            lastStatementDate: card.lastStatementIssueDate.toDateString(),
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });

          await prisma.creditCard.update({
            where: { id: card.id },
            data: { openDate: estimatedOpenDate }
          });

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            method: 'statement_date_minus_6_months',
            lastStatementDate: card.lastStatementIssueDate.toDateString(),
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });
        } else {
          // Last resort - use current date minus 1 year
          const estimatedOpenDate = new Date();
          estimatedOpenDate.setFullYear(estimatedOpenDate.getFullYear() - 1);

          console.log(`Setting fallback open date for ${card.name}:`, {
            cardName: card.name,
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });

          await prisma.creditCard.update({
            where: { id: card.id },
            data: { openDate: estimatedOpenDate }
          });

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            method: 'fallback_1_year_ago',
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });
        }
      }
    }

    // After fixing open dates, we should regenerate billing cycles
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration with correct open dates...');
      
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

    console.log('🔧 OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesRegenerated: fixes.length > 0
    });

  } catch (error) {
    console.error('🔧 FIX OPEN DATES FROM TRANSACTIONS ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix open dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}