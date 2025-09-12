import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    // Get user session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the itemId from request body
    const { itemId, cardId } = await request.json();
    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });
    }

    console.log(`🔄 Starting sync for item ${itemId}, card ${cardId || 'specific card'}`);

    // Get the Plaid item and access token
    const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, userId, accessToken, institutionId, institutionName, credit_cards(*)')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();

    if (plaidItemError || !plaidItem) {
      console.error('Failed to fetch Plaid item:', plaidItemError);
      return NextResponse.json({ error: 'Plaid item not found' }, { status: 404 });
    }

    // Decrypt the access token before using it
    if (!plaidItem.accessToken) {
      return NextResponse.json({ error: 'No access token for item' }, { status: 400 });
    }
    const decryptedAccessToken = decrypt(plaidItem.accessToken);
    
    try {
      console.log('Step 1: Syncing account data...');
      const accountSyncResult = await plaidService.syncAccounts(decryptedAccessToken, plaidItem.itemId);
      console.log('Step 1: Account sync completed');
      
      console.log('Step 2: Syncing recent transactions...');
      await plaidService.sync30DayTransactions(plaidItem, decryptedAccessToken, cardId);
      console.log('Step 2: 30-day transaction sync completed');

      // Update connection status to active on successful sync
      const { error: updateError } = await supabaseAdmin
        .from('plaid_items')
        .update({
          status: 'active',
          lastSyncAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null
        })
        .eq('itemId', plaidItem.itemId);

      if (updateError) {
        console.error('Failed to update plaid item status:', updateError);
      }
    } catch (error: any) {
      console.error(`Sync error for ${plaidItem.institutionName} (${plaidItem.itemId}):`, error);
      
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
      if (isConnectionError && !plaidItem.errorCode) { // Only try if this isn't a repeated failure
        console.log(`🔄 Auto-reconnecting ${plaidItem.institutionName} due to connection error...`);
        
        try {
          // Create update link token and mark for manual reconnection
          await plaidService.createUpdateLinkToken(plaidItem.userId, plaidItem.itemId);
          
          console.log(`✅ Update link token created for ${plaidItem.institutionName}`);
          
          // Mark as requiring reconnection but provide the means to do it
          const { error: reconnectUpdateError } = await supabaseAdmin
            .from('plaid_items')
            .update({
              status: 'expired',
              errorCode: errorCode,
              errorMessage: 'Connection expired - reconnection required'
            })
            .eq('itemId', plaidItem.itemId);

          if (reconnectUpdateError) {
            console.error('Failed to update plaid item for reconnection:', reconnectUpdateError);
          }
          
          return NextResponse.json({ 
            itemId: plaidItem.itemId, 
            status: 'error', 
            error: 'Connection expired',
            requiresReconnection: true,
            canAutoReconnect: true
          }, { status: 502 });
          
        } catch (reconnectError) {
          console.error(`Failed to prepare reconnection for ${plaidItem.institutionName}:`, reconnectError);
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
        .eq('itemId', plaidItem.itemId);

      if (statusUpdateError) {
        console.error('Failed to update plaid item error status:', statusUpdateError);
      }
      
      return NextResponse.json({ 
        itemId: plaidItem.itemId, 
        status: 'error', 
        error: error.message,
        requiresReconnection: isConnectionError
      }, { status: 502 });
    }

    // Step 4: Delete existing billing cycles for the specific card(s) being synced
    console.log('Step 4: Deleting existing billing cycles for target card(s)...');
    
    // Get credit card IDs based on whether we're syncing a specific card or all cards
    let creditCardIds: string[] = [];
    if (cardId) {
      creditCardIds = [cardId];
    } else {
      creditCardIds = plaidItem.credit_cards.map((card: any) => card.id);
    }
    
    // Delete existing billing cycles for only the target card(s)
    const { error: deleteError, count: deletedCount } = await supabaseAdmin
      .from('billing_cycles')
      .delete()
      .in('creditCardId', creditCardIds);

    if (deleteError) {
      console.error('Failed to delete existing billing cycles for target card(s):', deleteError);
    } else {
      console.log(`🗑️ Deleted ${deletedCount || 0} existing billing cycles for target card(s)`);
    }
    
    // Step 5: Regenerate billing cycles using all available data (not just 30-day window)
    console.log('Step 5: Regenerating billing cycles with complete transaction history...');
    const { calculateBillingCycles } = await import('@/utils/billingCycles');
    
    for (const creditCardId of creditCardIds) {
      console.log(`🔄 Regenerating billing cycles for card ${creditCardId}`);
      try {
        await calculateBillingCycles(creditCardId);
        console.log(`✅ Billing cycles regenerated for card ${creditCardId}`);
      } catch (cycleError) {
        console.error(`❌ Failed to regenerate billing cycles for card ${creditCardId}:`, cycleError);
        // Continue with other cards
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully synced account data, 30-day transactions, and regenerated billing cycles`,
      cardsSynced: creditCardIds.length
    });

  } catch (error) {
    console.error('Error syncing card transactions:', error);
    return NextResponse.json({ 
      error: 'Failed to sync transactions', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
