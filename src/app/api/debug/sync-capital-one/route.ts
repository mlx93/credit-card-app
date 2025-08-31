import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE SYNC TEST ===');

    // Get Capital One Plaid item
    const capitalOnePlaidItem = await prisma.plaidItem.findFirst({
      where: {
        userId: session.user.id,
        institutionName: { contains: 'Capital One', mode: 'insensitive' }
      }
    });

    if (!capitalOnePlaidItem) {
      return NextResponse.json({ error: 'No Capital One Plaid item found' }, { status: 404 });
    }

    console.log('Found Capital One item:', capitalOnePlaidItem.institutionName);

    try {
      const decryptedAccessToken = decrypt(capitalOnePlaidItem.accessToken);
      
      // Run the sync specifically for this item
      console.log('Running account sync for Capital One...');
      await plaidService.syncAccounts(decryptedAccessToken, capitalOnePlaidItem.itemId);
      
      // Get updated card data
      const updatedCards = await prisma.creditCard.findMany({
        where: { plaidItemId: capitalOnePlaidItem.id },
        select: {
          id: true,
          name: true,
          mask: true,
          balanceLimit: true,
          balanceCurrent: true,
          balanceAvailable: true
        }
      });

      console.log('Updated Capital One cards after sync:', updatedCards);

      return NextResponse.json({
        success: true,
        message: 'Capital One sync completed',
        updatedCards
      });

    } catch (error) {
      console.error('Capital One sync error:', error);
      return NextResponse.json({
        success: false,
        error: 'Sync failed',
        details: error.message
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Capital One sync test error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Test failed',
      details: error.message 
    }, { status: 500 });
  }
}