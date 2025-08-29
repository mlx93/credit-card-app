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
        
        // Check for specific Plaid connection errors
        const errorCode = error.error_code || error?.response?.data?.error_code || 'SYNC_ERROR';
        const errorType = error.error_type || error?.response?.data?.error_type;
        const statusCode = error?.response?.status || 0;
        
        // Enhanced error detection - include 400 status codes and more error types
        const isConnectionError = (
          ['ITEM_LOGIN_REQUIRED', 'ACCESS_NOT_GRANTED', 'INVALID_ACCESS_TOKEN', 'ITEM_NOT_FOUND'].includes(errorCode) ||
          statusCode === 400 ||
          error.message?.includes('400') ||
          error.message?.toLowerCase().includes('invalid') ||
          error.message?.toLowerCase().includes('expired')
        );
        
        console.log('Enhanced error analysis:', {
          errorCode,
          errorType,
          statusCode,
          isConnectionError,
          errorMessage: error.message,
          shouldReconnect: isConnectionError
        });
        
        // If it's a connection error, try auto-reconnection ONCE
        if (isConnectionError && !item.errorCode) { // Only try if this isn't a repeated failure
          console.log(`🔄 Auto-reconnecting ${item.institutionName} due to connection error...`);
          
          try {
            // Import plaidService for reconnection
            const { plaidService } = await import('@/services/plaid');
            
            // Create update link token and mark for manual reconnection
            // We can't fully auto-reconnect without user interaction, but we can prepare
            await plaidService.createUpdateLinkToken(item.userId, item.itemId);
            
            console.log(`✅ Update link token created for ${item.institutionName}`);
            
            // Mark as requiring reconnection but provide the means to do it
            await prisma.plaidItem.update({
              where: { itemId: item.itemId },
              data: {
                status: 'expired',
                errorCode: errorCode,
                errorMessage: 'Connection expired - reconnection required'
              }
            });
            
            return { 
              itemId: item.itemId, 
              status: 'error', 
              error: 'Connection expired',
              requiresReconnection: true,
              canAutoReconnect: true
            };
            
          } catch (reconnectError) {
            console.error(`Failed to prepare reconnection for ${item.institutionName}:`, reconnectError);
            // Fall through to regular error handling
          }
        }
        
        // Update connection status based on error type
        const newStatus = isConnectionError ? 'expired' : 'error';
        
        await prisma.plaidItem.update({
          where: { itemId: item.itemId },
          data: {
            status: newStatus,
            errorCode: errorCode,
            errorMessage: error.message || error?.response?.data?.error_message || 'Unknown sync error'
          }
        });
        
        return { 
          itemId: item.itemId, 
          status: 'error', 
          error: error.message,
          requiresReconnection: isConnectionError
        };
      }
    });

    console.log('Waiting for all sync promises to complete...');
    const results = await Promise.all(syncPromises);
    
    console.log('All sync promises completed. Results:', results);
    
    // Log detailed sync results
    console.log('=== DETAILED SYNC RESULTS ===');
    for (const result of results) {
      if (result.status === 'success') {
        console.log(`✅ ${result.itemId}: Successfully synced`);
      } else {
        console.log(`❌ ${result.itemId}: ${result.error}`);
      }
    }
    
    // Regenerate billing cycles after successful sync
    console.log('=== REGENERATING BILLING CYCLES ===');
    try {
      const { calculateBillingCycles } = await import('@/utils/billingCycles');
      
      // Get all credit cards for this user
      const userCreditCards = await prisma.creditCard.findMany({
        where: {
          plaidItem: {
            userId: session.user.id
          }
        },
        include: {
          plaidItem: true
        }
      });

      console.log(`Found ${userCreditCards.length} credit cards for user billing cycle regeneration`);

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
      const regenResults = [];
      for (const card of userCreditCards) {
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
          
          for (const transaction of unlinkedTransactions) {
            await prisma.transaction.update({
              where: { id: transaction.id },
              data: { creditCardId: card.id }
            });
          }
        }
        
        const cycles = await calculateBillingCycles(card.id);
        console.log(`Generated ${cycles.length} cycles for ${card.name}`);
        
        regenResults.push({
          cardName: card.name,
          cyclesGenerated: cycles.length
        });
      }
      
      console.log('✅ Billing cycles regenerated successfully after sync');
      console.log('Regeneration results:', regenResults);
    } catch (regenError) {
      console.error('Error regenerating billing cycles after sync:', regenError);
      // Don't fail the sync if billing cycle regeneration fails
    }
    
    console.log('=== SYNC ROUTE COMPLETED SUCCESSFULLY ===');
    console.log(`Total items synced: ${results.length}`);
    console.log(`Successful syncs: ${results.filter(r => r.status === 'success').length}`);
    console.log(`Failed syncs: ${results.filter(r => r.status === 'error').length}`);
    
    return NextResponse.json({ 
      message: 'Sync completed',
      results,
      summary: {
        total: results.length,
        success: results.filter(r => r.status === 'success').length,
        errors: results.filter(r => r.status === 'error').length
      }
    });
  } catch (error) {
    console.error('=== SYNC ROUTE ERROR ===');
    console.error('Sync error:', error);
    console.error('Error stack:', error.stack);
    console.error('=== END SYNC ROUTE ERROR ===');
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}