import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('🎯 SYNC ROUTE CALLED - Starting sync process');
    
    const session = await getServerSession(authOptions);
    console.log('Session check:', session?.user?.id ? 'Authorized' : 'Not authorized');
    
    if (!session?.user?.id) {
      console.log('Returning 401 - unauthorized');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Fetching Plaid items for user:', session.user.id);
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
    });
    
    console.log(`Found ${plaidItems.length} Plaid items for user`);
    plaidItems.forEach((item, index) => {
      console.log(`Item ${index + 1}: ${item.institutionName} (${item.itemId})`);
    });

    if (plaidItems.length === 0) {
      console.log('No Plaid items found - returning early');
      return NextResponse.json({ 
        message: 'No Plaid items to sync',
        results: [] 
      });
    }

    console.log('Starting sync promises...');
    const syncPromises = plaidItems.map(async (item) => {
      try {
        console.log(`=== SYNC DEBUG: Starting sync for ${item.institutionName} (${item.itemId}) ===`);
        const decryptedAccessToken = decrypt(item.accessToken);
        
        console.log('Step 1: Syncing accounts...');
        await plaidService.syncAccounts(decryptedAccessToken, item.itemId);
        console.log('Step 1: Account sync completed');
        
        console.log('Step 2: Syncing transactions...');
        console.log('About to call plaidService.syncTransactions with:', { itemId: item.itemId, hasAccessToken: !!decryptedAccessToken });
        console.log('PlaidService method exists?', typeof plaidService.syncTransactions);
        
        try {
          await plaidService.syncTransactions(item.itemId, decryptedAccessToken);
          console.log('Step 2: Transaction sync completed successfully');
        } catch (syncError) {
          console.error('🚨 TRANSACTION SYNC ERROR:', syncError);
          console.error('Error details:', {
            message: syncError.message,
            stack: syncError.stack,
            code: syncError.error_code,
            type: syncError.error_type
          });
          throw syncError; // Re-throw to be caught by outer try-catch
        }
        
        console.log('Step 3: Regenerating billing cycles with new transaction data...');
        // Import at the top of the file
        const { calculateBillingCycles } = await import('@/utils/billingCycles');
        
        // Get all credit cards for this Plaid item
        const creditCards = await prisma.creditCard.findMany({
          where: { plaidItemId: item.id }
        });
        
        for (const card of creditCards) {
          console.log(`Regenerating billing cycles for ${card.name}...`);
          const cycles = await calculateBillingCycles(card.id);
          console.log(`Generated ${cycles.length} billing cycles for ${card.name}`);
        }
        console.log('Step 3: Billing cycle regeneration completed');
        
        // Update connection status to active on successful sync
        await prisma.plaidItem.update({
          where: { itemId: item.itemId },
          data: {
            status: 'active',
            lastSyncAt: new Date(),
            errorCode: null,
            errorMessage: null
          }
        });
        
        console.log(`=== SYNC DEBUG: Completed sync for ${item.institutionName} ===`);
        return { itemId: item.itemId, status: 'success' };
      } catch (error) {
        console.error(`=== SYNC ERROR for ${item.institutionName} (${item.itemId}):`, error);
        
        // Update connection status to error
        await prisma.plaidItem.update({
          where: { itemId: item.itemId },
          data: {
            status: 'error',
            errorCode: error.error_code || 'SYNC_ERROR',
            errorMessage: error.message || 'Unknown sync error'
          }
        });
        
        return { itemId: item.itemId, status: 'error', error: error.message };
      }
    });

    console.log('Waiting for all sync promises to complete...');
    const results = await Promise.all(syncPromises);
    
    console.log('All sync promises completed. Results:', results);
    console.log('=== SYNC ROUTE COMPLETED SUCCESSFULLY ===');
    
    return NextResponse.json({ 
      message: 'Sync completed',
      results 
    });
  } catch (error) {
    console.error('=== SYNC ROUTE ERROR ===');
    console.error('Sync error:', error);
    console.error('Error stack:', error.stack);
    console.error('=== END SYNC ROUTE ERROR ===');
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}