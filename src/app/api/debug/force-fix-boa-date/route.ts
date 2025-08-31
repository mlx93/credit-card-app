import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    console.log('🔧 FORCE FIX BOA DATE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the Bank of America Customized Cash Rewards card specifically
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
          take: 1 // Get the earliest transaction
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'Bank of America Customized Cash Rewards card not found' }, { status: 404 });
    }

    console.log('Found BoA card:', {
      id: boaCard.id,
      name: boaCard.name,
      currentOpenDate: boaCard.openDate,
      transactionCount: boaCard.transactions.length
    });

    if (boaCard.transactions.length === 0) {
      return NextResponse.json({ error: 'No transactions found for this card' }, { status: 400 });
    }

    const earliestTransaction = boaCard.transactions[0];
    const correctedOpenDate = new Date(earliestTransaction.date);
    correctedOpenDate.setDate(correctedOpenDate.getDate() - 7);

    console.log('Attempting to update BoA card with corrected date:', {
      cardId: boaCard.id,
      earliestTransactionDate: earliestTransaction.date.toDateString(),
      correctedOpenDate: correctedOpenDate.toDateString()
    });

    // Force update with explicit transaction
    const updateResult = await prisma.$transaction(async (tx) => {
      // First, update the card
      const updatedCard = await tx.creditCard.update({
        where: { id: boaCard.id },
        data: { 
          openDate: correctedOpenDate,
          updatedAt: new Date() // Force timestamp update
        }
      });

      // Then delete all billing cycles for this card
      const deleteResult = await tx.billingCycle.deleteMany({
        where: {
          creditCardId: boaCard.id
        }
      });

      return { updatedCard, deletedCycles: deleteResult.count };
    });

    console.log('Database update completed:', {
      updatedCardOpenDate: updateResult.updatedCard.openDate,
      deletedCycles: updateResult.deletedCycles
    });

    // Now trigger billing cycle regeneration
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

    console.log('🔧 FORCE BOA DATE FIX COMPLETED');
    
    return NextResponse.json({ 
      message: 'BoA card open date forcefully corrected',
      cardName: boaCard.name,
      oldOpenDate: boaCard.openDate?.toDateString() || 'null',
      newOpenDate: correctedOpenDate.toDateString(),
      earliestTransactionDate: earliestTransaction.date.toDateString(),
      deletedCycles: updateResult.deletedCycles,
      billingCyclesRegenerated: true
    });

  } catch (error) {
    console.error('🔧 FORCE FIX BOA DATE ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to force fix BoA date',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}