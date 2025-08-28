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

    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
    });

    const syncPromises = plaidItems.map(async (item) => {
      try {
        console.log(`=== SYNC DEBUG: Starting sync for ${item.institutionName} (${item.itemId}) ===`);
        const decryptedAccessToken = decrypt(item.accessToken);
        
        console.log('Step 1: Syncing accounts...');
        await plaidService.syncAccounts(decryptedAccessToken, item.itemId);
        console.log('Step 1: Account sync completed');
        
        console.log('Step 2: Syncing transactions...');
        await plaidService.syncTransactions(item.itemId);
        console.log('Step 2: Transaction sync completed');
        
        console.log(`=== SYNC DEBUG: Completed sync for ${item.institutionName} ===`);
        return { itemId: item.itemId, status: 'success' };
      } catch (error) {
        console.error(`=== SYNC ERROR for ${item.institutionName} (${item.itemId}):`, error);
        return { itemId: item.itemId, status: 'error', error: error.message };
      }
    });

    const results = await Promise.all(syncPromises);
    
    return NextResponse.json({ 
      message: 'Sync completed',
      results 
    });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}