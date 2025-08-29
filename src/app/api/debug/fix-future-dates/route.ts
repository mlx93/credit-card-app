import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('🔧 FIX FUTURE DATES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    
    // Find cards with future dates
    const cardsWithFutureDates = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        OR: [
          {
            openDate: {
              gt: now
            }
          },
          {
            lastStatementIssueDate: {
              gt: now
            }
          },
          {
            nextPaymentDueDate: {
              gt: new Date(currentYear + 1, 0, 1) // More than 1 year in future
            }
          }
        ]
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true
          }
        }
      }
    });

    console.log(`Found ${cardsWithFutureDates.length} cards with future dates`);

    const fixes = [];
    
    for (const card of cardsWithFutureDates) {
      const updates: any = {};
      let fixesApplied = [];
      
      // Fix future open date
      if (card.openDate && card.openDate > now) {
        const correctedOpenDate = new Date(card.openDate);
        // If year is 2025+, change to 2024, if still future, change to 2023
        if (correctedOpenDate.getFullYear() >= 2025) {
          correctedOpenDate.setFullYear(2024);
        }
        if (correctedOpenDate > now) {
          correctedOpenDate.setFullYear(2023);
        }
        
        updates.openDate = correctedOpenDate;
        fixesApplied.push(`Open date: ${card.openDate.toDateString()} → ${correctedOpenDate.toDateString()}`);
      }
      
      // Fix future statement date
      if (card.lastStatementIssueDate && card.lastStatementIssueDate > now) {
        const correctedStatementDate = new Date(card.lastStatementIssueDate);
        // If year is 2025+, change to 2024, if still future, go back further
        if (correctedStatementDate.getFullYear() >= 2025) {
          correctedStatementDate.setFullYear(2024);
        }
        if (correctedStatementDate > now) {
          // Move back a few months to ensure it's in the past
          correctedStatementDate.setMonth(correctedStatementDate.getMonth() - 3);
        }
        
        updates.lastStatementIssueDate = correctedStatementDate;
        fixesApplied.push(`Statement date: ${card.lastStatementIssueDate.toDateString()} → ${correctedStatementDate.toDateString()}`);
      }
      
      // Fix future due date (if more than 1 year in future)
      if (card.nextPaymentDueDate && card.nextPaymentDueDate > new Date(currentYear + 1, 0, 1)) {
        const correctedDueDate = new Date(card.nextPaymentDueDate);
        if (correctedDueDate.getFullYear() >= 2025) {
          correctedDueDate.setFullYear(2024);
        }
        // Due dates can be in the future, but not more than a few months
        const maxFuture = new Date();
        maxFuture.setMonth(maxFuture.getMonth() + 3);
        if (correctedDueDate > maxFuture) {
          correctedDueDate.setFullYear(2024);
          correctedDueDate.setMonth(correctedDueDate.getMonth() - 6);
        }
        
        updates.nextPaymentDueDate = correctedDueDate;
        fixesApplied.push(`Due date: ${card.nextPaymentDueDate.toDateString()} → ${correctedDueDate.toDateString()}`);
      }
      
      // Add default open date if missing
      if (!card.openDate && card.lastStatementIssueDate) {
        // Estimate open date as 6 months before the corrected statement date
        const estimatedOpenDate = new Date(updates.lastStatementIssueDate || card.lastStatementIssueDate);
        estimatedOpenDate.setMonth(estimatedOpenDate.getMonth() - 6);
        
        updates.openDate = estimatedOpenDate;
        fixesApplied.push(`Added estimated open date: ${estimatedOpenDate.toDateString()}`);
      }
      
      if (Object.keys(updates).length > 0) {
        console.log(`Fixing ${card.name}:`, fixesApplied);
        
        await prisma.creditCard.update({
          where: { id: card.id },
          data: updates
        });
        
        fixes.push({
          cardName: card.name,
          institutionName: card.plaidItem?.institutionName,
          fixesApplied
        });
      }
    }

    // After fixing dates, delete all existing billing cycles so they can be regenerated
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration...');
      const deleteResult = await prisma.billingCycle.deleteMany({
        where: {
          creditCard: {
            plaidItem: {
              userId: session.user.id
            }
          }
        }
      });
      console.log(`Deleted ${deleteResult.count} existing billing cycles`);
    }

    console.log('🔧 FUTURE DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Future dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesDeleted: fixes.length > 0 ? 'All existing cycles deleted for regeneration' : 'No cycles deleted'
    });
  } catch (error) {
    console.error('🔧 FIX FUTURE DATES ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix future dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}