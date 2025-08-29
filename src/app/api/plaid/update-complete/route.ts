import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidClient } from '@/lib/plaid';
import { encrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 PLAID UPDATE COMPLETE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { public_token, itemId } = await request.json();
    
    if (!public_token || !itemId) {
      return NextResponse.json({ 
        error: 'Public token and item ID required for update' 
      }, { status: 400 });
    }

    console.log(`Processing update for item: ${itemId}`);

    // Exchange the public token for a new access token
    console.log('Exchanging public token for fresh access token...');
    const tokenResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const newAccessToken = tokenResponse.data.access_token;
    const newItemId = tokenResponse.data.item_id;

    console.log(`New access token obtained for item: ${newItemId}`);

    // Verify the item belongs to this user
    const existingItem = await prisma.plaidItem.findFirst({
      where: {
        itemId,
        userId: session.user.id
      }
    });

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found or unauthorized' }, { status: 404 });
    }

    // Update the access token in the database
    console.log(`Updating database with fresh access token for ${existingItem.institutionName}...`);
    
    const encryptedAccessToken = encrypt(newAccessToken);
    
    await prisma.plaidItem.update({
      where: { id: existingItem.id },
      data: {
        accessToken: encryptedAccessToken,
        itemId: newItemId, // Item ID might change during update
        status: 'active',
        lastSyncAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });

    console.log(`✅ Successfully updated connection for ${existingItem.institutionName}`);

    // Trigger a sync to refresh all data with the new token
    console.log('Triggering sync with fresh tokens...');
    try {
      const syncResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward the session cookie for internal API call
        }
      });

      if (syncResponse.ok) {
        console.log('✅ Post-update sync completed successfully');
      } else {
        console.warn('⚠️ Post-update sync failed, but connection update succeeded');
      }
    } catch (syncError) {
      console.error('Post-update sync error:', syncError);
      // Don't fail the update if sync fails - the connection is still fixed
    }

    return NextResponse.json({ 
      success: true,
      message: `Successfully reconnected ${existingItem.institutionName}`,
      institutionName: existingItem.institutionName,
      itemId: newItemId
    });

  } catch (error) {
    console.error('🔄 PLAID UPDATE COMPLETE ERROR:', error);
    
    return NextResponse.json({ 
      error: 'Failed to complete connection update',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}