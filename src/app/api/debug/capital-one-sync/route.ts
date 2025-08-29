import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE SYNC DEBUG ===');

    // Get Capital One cards from database
    const capitalOneCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: { userId: session.user.id },
        OR: [
          { name: { contains: 'Capital One', mode: 'insensitive' } },
          { name: { contains: 'Quicksilver', mode: 'insensitive' } },
          { name: { contains: 'Venture', mode: 'insensitive' } },
          { name: { contains: 'Savor', mode: 'insensitive' } },
          { name: { contains: 'Spark', mode: 'insensitive' } },
          { plaidItem: { institutionName: { contains: 'Capital One', mode: 'insensitive' } } },
        ]
      },
      include: {
        plaidItem: {
          select: {
            id: true,
            itemId: true,
            institutionName: true,
            accessToken: true
          }
        }
      }
    });

    if (capitalOneCards.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'No Capital One cards found',
        found: capitalOneCards.length 
      });
    }

    const results = [];

    for (const card of capitalOneCards) {
      console.log(`\n=== SYNCING CAPITAL ONE CARD: ${card.name} ===`);
      
      try {
        const decryptedToken = decrypt(card.plaidItem.accessToken);
        
        console.log('Before sync - current database values:');
        console.log('Card ID:', card.id);
        console.log('Balance Limit:', card.balanceLimit);
        console.log('Balance Current:', card.balanceCurrent);
        console.log('Balance Available:', card.balanceAvailable);
        
        // Trigger sync for this specific item
        console.log('Triggering syncAccounts...');
        await plaidService.syncAccounts(decryptedToken, card.plaidItem.itemId);
        
        // Check updated values
        const updatedCard = await prisma.creditCard.findUnique({
          where: { id: card.id }
        });
        
        console.log('After sync - updated database values:');
        console.log('Balance Limit:', updatedCard?.balanceLimit);
        console.log('Balance Current:', updatedCard?.balanceCurrent);
        console.log('Balance Available:', updatedCard?.balanceAvailable);
        
        results.push({
          cardName: card.name,
          beforeSync: {
            balanceLimit: card.balanceLimit,
            balanceCurrent: card.balanceCurrent,
            balanceAvailable: card.balanceAvailable
          },
          afterSync: {
            balanceLimit: updatedCard?.balanceLimit,
            balanceCurrent: updatedCard?.balanceCurrent,
            balanceAvailable: updatedCard?.balanceAvailable
          },
          limitDetected: !!(updatedCard?.balanceLimit && updatedCard.balanceLimit > 0)
        });

      } catch (error) {
        console.error(`Error syncing Capital One card ${card.name}:`, error);
        results.push({
          cardName: card.name,
          error: error.message,
          limitDetected: false
        });
      }
    }

    console.log('=== END CAPITAL ONE SYNC DEBUG ===');

    return NextResponse.json({
      success: true,
      totalCapitalOneCards: capitalOneCards.length,
      results,
      message: 'Capital One sync debug completed - check console logs for detailed output'
    });

  } catch (error) {
    console.error('Capital One sync debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}