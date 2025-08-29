import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidClient } from '@/lib/plaid';
import { encrypt, decrypt } from '@/lib/encryption';
import { plaidService } from '@/services/plaid';

export async function POST(request: NextRequest) {
  let dbTransaction: any = null;
  
  try {
    console.log('🔄 PLAID UPDATE COMPLETE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      console.error('❌ Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { public_token, itemId } = await request.json();
    
    if (!public_token || !itemId) {
      console.error('❌ Missing required parameters:', { public_token: !!public_token, itemId: !!itemId });
      return NextResponse.json({ 
        error: 'Public token and item ID required for update' 
      }, { status: 400 });
    }

    console.log(`🔄 Processing reconnection for item: ${itemId}`);
    console.log(`🔄 User: ${session.user.email} (${session.user.id})`);

    // Start database transaction for atomic updates
    dbTransaction = await prisma.$transaction(async (tx) => {
      console.log('🏦 Starting database transaction for reconnection...');

      // Exchange the public token for a new access token
      console.log('🔑 Exchanging public token for fresh access token...');
      const tokenResponse = await plaidClient.itemPublicTokenExchange({
        public_token,
      });

      const newAccessToken = tokenResponse.data.access_token;
      const newItemId = tokenResponse.data.item_id;

      console.log(`✅ New access token obtained for item: ${newItemId}`);

      // Verify the item belongs to this user
      const existingItem = await tx.plaidItem.findFirst({
        where: {
          itemId,
          userId: session.user.id
        }
      });

      if (!existingItem) {
        console.error(`❌ Item not found or unauthorized: ${itemId} for user ${session.user.id}`);
        throw new Error('Item not found or unauthorized');
      }

      console.log(`🔄 Updating ${existingItem.institutionName} connection...`);
      
      // Update the access token in the database
      const encryptedAccessToken = encrypt(newAccessToken);
      
      const updatedItem = await tx.plaidItem.update({
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

      console.log(`✅ Database updated for ${existingItem.institutionName}`);

      // Force comprehensive data refresh with new token
      console.log('🔄 Force syncing accounts with fresh access token...');
      
      try {
        // Use comprehensive forced reconnection sync
        console.log('🚀 Using comprehensive force reconnection sync...');
        const syncResult = await plaidService.forceReconnectionSync(newAccessToken, newItemId, session.user.id);
        
        if (syncResult.success) {
          console.log('✅ Comprehensive sync completed successfully');
          console.log('📊 Sync details:', syncResult.details);

          // Regenerate billing cycles with updated data
          console.log('🔄 Regenerating billing cycles with fresh data...');
          const { calculateBillingCycles } = await import('@/utils/billingCycles');
          
          // Get all credit cards for this Plaid item
          const creditCards = await tx.creditCard.findMany({
            where: { plaidItemId: updatedItem.id }
          });
          
          let totalCyclesGenerated = 0;
          for (const card of creditCards) {
            console.log(`🔄 Regenerating billing cycles for ${card.name}...`);
            const cycles = await calculateBillingCycles(card.id);
            totalCyclesGenerated += cycles.length;
            console.log(`✅ Generated ${cycles.length} billing cycles for ${card.name}`);
            
            // Log open date validation
            console.log(`📅 Card ${card.name} open date: ${card.openDate ? new Date(card.openDate).toDateString() : 'NOT SET'}`);
          }
          
          console.log(`✅ Total billing cycles regenerated: ${totalCyclesGenerated}`);
        } else {
          console.warn('⚠️ Comprehensive sync had issues:', syncResult.details);
          
          // Still mark connection as active but add warning
          await tx.plaidItem.update({
            where: { id: existingItem.id },
            data: {
              status: 'active', // Connection is fixed, but sync had issues
              errorCode: 'SYNC_WARNING',
              errorMessage: `Connection restored but sync incomplete: ${JSON.stringify(syncResult.details)}`
            }
          });
        }

      } catch (syncError) {
        console.error('❌ Comprehensive sync error during reconnection:', syncError);
        console.error('Sync error details:', {
          message: syncError?.message,
          stack: syncError?.stack,
          error_code: syncError?.error_code,
          error_type: syncError?.error_type
        });
        
        // Still update the connection status but mark as needs attention
        await tx.plaidItem.update({
          where: { id: existingItem.id },
          data: {
            status: 'active', // Connection is fixed, but sync had issues
            errorCode: 'SYNC_ERROR',
            errorMessage: `Connection restored but comprehensive sync failed: ${syncError?.message}`
          }
        });
        
        // Don't throw - connection update succeeded even if sync had issues
        console.warn('⚠️ Connection restored but comprehensive sync failed');
      }

      return {
        success: true,
        institutionName: existingItem.institutionName,
        itemId: newItemId,
        userId: session.user.id
      };
    });

    console.log('✅ Database transaction completed successfully');

    // Validate the updates persisted correctly
    console.log('🔍 Validating database updates persisted...');
    const validationItem = await prisma.plaidItem.findUnique({
      where: { itemId: dbTransaction.itemId },
      include: {
        accounts: {
          select: {
            id: true,
            name: true,
            openDate: true,
            lastStatementIssueDate: true,
            balanceCurrent: true,
            balanceLimit: true
          }
        }
      }
    });

    if (!validationItem || validationItem.status !== 'active') {
      console.error('❌ Database validation failed - updates did not persist');
      throw new Error('Database updates did not persist correctly');
    }

    console.log('✅ Database validation passed');
    console.log(`✅ Reconnection validation for ${validationItem.institutionName}:`, {
      status: validationItem.status,
      lastSync: validationItem.lastSyncAt,
      accounts: validationItem.accounts.length,
      accountDetails: validationItem.accounts.map(acc => ({
        name: acc.name,
        hasOpenDate: !!acc.openDate,
        openDate: acc.openDate ? new Date(acc.openDate).toDateString() : null,
        hasStatement: !!acc.lastStatementIssueDate,
        balanceLimit: acc.balanceLimit
      }))
    });

    return NextResponse.json({ 
      success: true,
      message: `Successfully reconnected ${dbTransaction.institutionName}`,
      institutionName: dbTransaction.institutionName,
      itemId: dbTransaction.itemId,
      validation: {
        status: validationItem.status,
        accountsUpdated: validationItem.accounts.length,
        lastSync: validationItem.lastSyncAt
      }
    });

  } catch (error) {
    console.error('🔄 PLAID UPDATE COMPLETE ERROR:', error);
    console.error('Error details:', {
      message: error?.message,
      stack: error?.stack,
      error_code: error?.error_code,
      error_type: error?.error_type
    });
    
    return NextResponse.json({ 
      error: 'Failed to complete connection update',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}