import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { calculateBillingCycles } from '@/utils/billingCycles';

export async function POST() {
  try {
    console.log('🔄 REGENERATE CYCLES DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Fetching all credit cards for user:', session.user.id);
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

    console.log(`Found ${creditCards.length} credit cards`);

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
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles for ${card.name}`);
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length
      });
    }

    console.log('🔄 REGENERATE CYCLES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles regenerated successfully',
      results 
    });
  } catch (error) {
    console.error('🔄 REGENERATE CYCLES ERROR:', error);
    return NextResponse.json({ error: 'Failed to regenerate cycles' }, { status: 500 });
  }
}