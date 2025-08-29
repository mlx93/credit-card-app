import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId, creditLimit } = await request.json();

    // Validate inputs
    if (!cardId) {
      return NextResponse.json({ error: 'Card ID is required' }, { status: 400 });
    }

    if (creditLimit !== null && (typeof creditLimit !== 'number' || creditLimit <= 0)) {
      return NextResponse.json({ 
        error: 'Credit limit must be a positive number or null to remove' 
      }, { status: 400 });
    }

    // Verify the card belongs to the authenticated user
    const card = await prisma.creditCard.findFirst({
      where: {
        id: cardId,
        plaidItem: {
          userId: session.user.id
        }
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true
          }
        }
      }
    });

    if (!card) {
      return NextResponse.json({ 
        error: 'Credit card not found or unauthorized' 
      }, { status: 404 });
    }

    // Update the credit limit
    const updatedCard = await prisma.creditCard.update({
      where: { id: cardId },
      data: { 
        balanceLimit: creditLimit 
      }
    });

    console.log(`✅ Manual credit limit updated for ${card.name}:`, {
      cardName: card.name,
      institution: card.plaidItem?.institutionName,
      oldLimit: card.balanceLimit,
      newLimit: creditLimit,
      userId: session.user.id
    });

    return NextResponse.json({
      success: true,
      message: `Credit limit ${creditLimit ? `set to $${creditLimit.toLocaleString()}` : 'removed'} for ${card.name}`,
      card: {
        id: updatedCard.id,
        name: updatedCard.name,
        balanceLimit: updatedCard.balanceLimit
      }
    });

  } catch (error) {
    console.error('Error updating credit limit:', error);
    return NextResponse.json(
      { error: 'Failed to update credit limit' },
      { status: 500 }
    );
  }
}