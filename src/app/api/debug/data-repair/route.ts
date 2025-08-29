import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Helper function to identify payment transactions based on transaction name
function isPaymentTransaction(transactionName: string): boolean {
  const lowerName = transactionName.toLowerCase();
  
  // Common payment indicators across different banks
  const paymentIndicators = [
    'pymt',           // Capital One payments
    'payment',        // Amex and other banks
    'autopay',        // Automatic payments
    'online payment', // Online payments
    'mobile payment', // Mobile app payments
    'phone payment',  // Phone payments
    'bank payment',   // Bank transfers
    'ach payment',    // ACH payments
    'electronic payment', // Electronic payments
    'web payment',    // Web payments
  ];
  
  return paymentIndicators.some(indicator => lowerName.includes(indicator));
}

export async function POST() {
  try {
    console.log('🔧 DATA REPAIR ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all credit cards with related data
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      include: {
        plaidItem: true,
        transactions: {
          orderBy: { date: 'desc' }
        },
        billingCycles: {
          orderBy: { endDate: 'desc' }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards for repair`);

    const repairResults = [];

    for (const card of creditCards) {
      console.log(`\n=== REPAIRING ${card.name} ===`);
      
      const cardRepair = {
        cardName: card.name,
        cardId: card.id,
        repairs: [] as any[]
      };

      const today = new Date();

      for (const cycle of card.billingCycles) {
        const cycleStart = new Date(cycle.startDate);
        const cycleEnd = new Date(cycle.endDate);
        const isCurrentCycle = today >= cycleStart && today <= cycleEnd;
        const isHistoricalCycle = cycleEnd < today;
        
        // Get transactions for this cycle
        const effectiveEndDate = cycleEnd > today ? today : cycleEnd;
        const cycleTransactions = card.transactions.filter(t => 
          t.date >= cycleStart && t.date <= effectiveEndDate
        );
        
        const transactionBasedSpend = cycleTransactions.reduce((sum, t) => {
          // Exclude payment transactions, include charges and refunds
          if (isPaymentTransaction(t.name)) {
            return sum; // Skip payments
          }
          return sum + t.amount; // Include charges (positive) and refunds (negative)
        }, 0);
        
        // Calculate correct spend value
        let correctSpend = transactionBasedSpend;
        let correctStatementBalance = cycle.statementBalance;
        
        if (isCurrentCycle && card.balanceCurrent && card.lastStatementBalance) {
          // For current cycles, use balance-based calculation
          const currentBalance = Math.abs(card.balanceCurrent);
          const statementBalance = Math.abs(card.lastStatementBalance);
          correctSpend = Math.max(0, currentBalance - statementBalance);
          correctStatementBalance = null; // Current cycles shouldn't have statement balance
        } else if (isHistoricalCycle) {
          // For historical cycles, use transaction-based spend
          correctSpend = transactionBasedSpend;
          
          // Check if this is the exact statement cycle
          const lastStatementDate = card.lastStatementIssueDate ? new Date(card.lastStatementIssueDate) : null;
          const isExactStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
          
          if (isExactStatementCycle && card.lastStatementBalance) {
            // Use actual statement balance for the exact statement cycle
            correctStatementBalance = Math.abs(card.lastStatementBalance);
            correctSpend = correctStatementBalance; // For statement cycle, spend should match statement
          } else if (transactionBasedSpend > 0 && !correctStatementBalance) {
            // Set statement balance for historical cycles with transactions
            correctStatementBalance = transactionBasedSpend;
          }
        }
        
        // Check if repair is needed
        const needsSpendUpdate = Math.abs((cycle.totalSpend || 0) - correctSpend) > 0.01;
        const needsStatementUpdate = correctStatementBalance !== cycle.statementBalance;
        
        if (needsSpendUpdate || needsStatementUpdate) {
          console.log(`Repairing cycle ${cycleStart.toDateString()} - ${cycleEnd.toDateString()}:`, {
            oldTotalSpend: cycle.totalSpend,
            newTotalSpend: correctSpend,
            oldStatementBalance: cycle.statementBalance,
            newStatementBalance: correctStatementBalance,
            transactionCount: cycleTransactions.length,
            isCurrentCycle,
            isHistoricalCycle
          });
          
          try {
            const updatedCycle = await prisma.billingCycle.update({
              where: { id: cycle.id },
              data: {
                totalSpend: correctSpend,
                statementBalance: correctStatementBalance,
                minimumPayment: correctStatementBalance && correctStatementBalance > 0 
                  ? Math.max(25, correctStatementBalance * 0.02) 
                  : null
              }
            });
            
            cardRepair.repairs.push({
              cycleId: cycle.id,
              period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
              type: isCurrentCycle ? 'CURRENT_CYCLE' : 'HISTORICAL_CYCLE',
              changes: {
                totalSpend: { from: cycle.totalSpend, to: correctSpend },
                statementBalance: { from: cycle.statementBalance, to: correctStatementBalance }
              },
              success: true
            });
          } catch (error) {
            console.error(`Failed to update cycle ${cycle.id}:`, error);
            cardRepair.repairs.push({
              cycleId: cycle.id,
              period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
              success: false,
              error: error.message
            });
          }
        }
      }
      
      console.log(`Completed repairs for ${card.name}: ${cardRepair.repairs.length} cycles updated`);
      repairResults.push(cardRepair);
    }
    
    // Summary statistics
    const summary = {
      totalCards: repairResults.length,
      totalRepairs: repairResults.reduce((sum, r) => sum + r.repairs.length, 0),
      successfulRepairs: repairResults.reduce((sum, r) => 
        sum + r.repairs.filter(repair => repair.success).length, 0),
      failedRepairs: repairResults.reduce((sum, r) => 
        sum + r.repairs.filter(repair => !repair.success).length, 0)
    };

    console.log('\n🔧 DATA REPAIR COMPLETED');
    console.log('Summary:', summary);
    
    return NextResponse.json({ 
      message: 'Data repair completed',
      summary,
      results: repairResults
    });
  } catch (error) {
    console.error('🔧 DATA REPAIR ERROR:', error);
    return NextResponse.json({ error: 'Failed to perform data repair' }, { status: 500 });
  }
}