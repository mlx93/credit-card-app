import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { calculateBillingCycles } from '@/utils/billingCycles';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 BILLING CYCLES REGENERATION CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all credit cards for the user
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      include: {
        plaidItem: true
      }
    });

    console.log(`Found ${creditCards.length} credit cards for user`);

    // Delete existing billing cycles to force regeneration
    console.log('Deleting existing billing cycles...');
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

    // Regenerate billing cycles for each credit card
    const results = [];
    for (const card of creditCards) {
      console.log(`Regenerating cycles for ${card.name}...`);
      
      // First, ensure transactions are properly linked
      const unlinkedTransactions = await prisma.transaction.findMany({
        where: {
          plaidItemId: card.plaidItemId,
          creditCardId: null
        }
      });
      
      if (unlinkedTransactions.length > 0) {
        console.log(`Found ${unlinkedTransactions.length} unlinked transactions, linking them to ${card.name}...`);
        
        // Link transactions to the credit card based on accountId
        for (const transaction of unlinkedTransactions) {
          // Get the account ID from the Plaid transaction data
          // This would normally come from the transaction, but we need to check if it matches
          const creditCardForTransaction = await prisma.creditCard.findFirst({
            where: {
              plaidItemId: card.plaidItemId,
              accountId: transaction.accountId // Assuming transaction has accountId field
            }
          });
          
          if (creditCardForTransaction && creditCardForTransaction.id === card.id) {
            await prisma.transaction.update({
              where: { id: transaction.id },
              data: { creditCardId: card.id }
            });
          }
        }
      }
      
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles for ${card.name}`);
      
      // Log cycle details for debugging
      const historicalCycles = cycles.filter(c => c.statementBalance !== undefined);
      const currentCycle = cycles.find(c => !c.statementBalance && c.endDate > new Date());
      
      console.log(`Historical cycles with spend data: ${historicalCycles.length}`);
      console.log(`Current cycle found: ${currentCycle ? 'Yes' : 'No'}`);
      
      if (historicalCycles.length > 0) {
        console.log('Sample historical cycles:', historicalCycles.slice(0, 3).map(c => ({
          period: `${c.startDate.toLocaleDateString()} - ${c.endDate.toLocaleDateString()}`,
          totalSpend: c.totalSpend,
          transactionCount: c.transactionCount,
          statementBalance: c.statementBalance
        })));
      }
      
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length,
        historicalCyclesWithData: historicalCycles.length,
        currentCycle: currentCycle ? {
          totalSpend: currentCycle.totalSpend,
          transactionCount: currentCycle.transactionCount
        } : null
      });
    }

    console.log('🔄 BILLING CYCLES REGENERATION COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles regenerated successfully',
      results 
    });
  } catch (error) {
    console.error('🔄 BILLING CYCLES REGENERATION ERROR:', error);
    return NextResponse.json({ error: 'Failed to regenerate billing cycles' }, { status: 500 });
  }
}