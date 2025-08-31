import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
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
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }
    
    console.log(`Found ${(plaidItems || []).length} Plaid items for user`);
    (plaidItems || []).forEach((item, index) => {
      console.log(`Item ${index + 1}: ${item.institutionName} (${item.itemId})`);
    });

    if ((plaidItems || []).length === 0) {
      console.log('No Plaid items found - returning early');
      return NextResponse.json({ 
        message: 'No Plaid items to sync',
        results: [] 
      });
    }

    console.log('Starting sync promises...');
    const syncPromises = (plaidItems || []).map(async (item) => {
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
          await plaidService.syncTransactions(item, decryptedAccessToken);
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
        const { data: creditCards, error: cardsError } = await supabaseAdmin
          .from('credit_cards')
          .select('*')
          .eq('plaidItemId', item.id);

        if (cardsError) {
          throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
        }
        
        for (const card of (creditCards || [])) {
          console.log(`Regenerating billing cycles for ${card.name}...`);
          const cycles = await calculateBillingCycles(card.id);
          console.log(`Generated ${cycles.length} billing cycles for ${card.name}`);
        }
        console.log('Step 3: Billing cycle regeneration completed');
        
        // Update connection status to active on successful sync
        const { error: updateError } = await supabaseAdmin
          .from('plaid_items')
          .update({
            status: 'active',
            lastSyncAt: new Date().toISOString(),
            errorCode: null,
            errorMessage: null
          })
          .eq('itemId', item.itemId);

        if (updateError) {
          console.error('Failed to update plaid item status:', updateError);
        }
        
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
            const { error: reconnectUpdateError } = await supabaseAdmin
              .from('plaid_items')
              .update({
                status: 'expired',
                errorCode: errorCode,
                errorMessage: 'Connection expired - reconnection required'
              })
              .eq('itemId', item.itemId);

            if (reconnectUpdateError) {
              console.error('Failed to update plaid item for reconnection:', reconnectUpdateError);
            }
            
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
        
        const { error: statusUpdateError } = await supabaseAdmin
          .from('plaid_items')
          .update({
            status: newStatus,
            errorCode: errorCode,
            errorMessage: error.message || error?.response?.data?.error_message || 'Unknown sync error'
          })
          .eq('itemId', item.itemId);

        if (statusUpdateError) {
          console.error('Failed to update plaid item error status:', statusUpdateError);
        }
        
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
      
      // Get all plaid items for this user first
      const { data: userPlaidItems, error: userPlaidError } = await supabaseAdmin
        .from('plaid_items')
        .select('*')
        .eq('userId', session.user.id);

      if (userPlaidError) {
        throw new Error(`Failed to fetch user plaid items: ${userPlaidError.message}`);
      }

      const userPlaidItemIds = (userPlaidItems || []).map(item => item.id);
      
      // Get all credit cards for this user
      const { data: userCreditCards, error: userCardsError } = await supabaseAdmin
        .from('credit_cards')
        .select('*')
        .in('plaidItemId', userPlaidItemIds);

      if (userCardsError) {
        throw new Error(`Failed to fetch user credit cards: ${userCardsError.message}`);
      }

      // Create a map for plaid item lookup
      const plaidItemMap = new Map();
      (userPlaidItems || []).forEach(item => {
        plaidItemMap.set(item.id, item);
      });

      // Add plaidItem reference to each credit card for compatibility
      const userCreditCardsWithPlaidItem = (userCreditCards || []).map(card => ({
        ...card,
        plaidItem: plaidItemMap.get(card.plaidItemId)
      }));

      console.log(`Found ${userCreditCardsWithPlaidItem.length} credit cards for user billing cycle regeneration`);

      // Delete existing billing cycles to force regeneration
      console.log('Deleting existing billing cycles...');
      const creditCardIds = (userCreditCards || []).map(card => card.id);
      
      const { error: deleteError, count: deleteCount } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .in('creditCardId', creditCardIds);

      if (deleteError) {
        console.error('Failed to delete existing billing cycles:', deleteError);
      } else {
        console.log(`Deleted ${deleteCount || 0} existing billing cycles`);
      }

      // Regenerate billing cycles for each credit card
      const regenResults = [];
      for (const card of (userCreditCards || [])) {
        console.log(`Regenerating cycles for ${card.name}...`);
        
        // First, ensure transactions are properly linked
        const { data: unlinkedTransactions, error: unlinkedError } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('plaidItemId', card.plaidItemId)
          .is('creditCardId', null);

        if (unlinkedError) {
          console.error('Failed to fetch unlinked transactions:', unlinkedError);
        } else if ((unlinkedTransactions || []).length > 0) {
          console.log(`Found ${unlinkedTransactions.length} unlinked transactions, linking them to ${card.name}...`);
          
          for (const transaction of unlinkedTransactions) {
            const { error: linkError } = await supabaseAdmin
              .from('transactions')
              .update({ creditCardId: card.id })
              .eq('id', transaction.id);
              
            if (linkError) {
              console.error(`Failed to link transaction ${transaction.id}:`, linkError);
            }
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