import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { encrypt, decrypt } from '@/lib/encryption';
import { plaidService } from '@/services/plaid';

export async function POST(request: NextRequest) {
  let transactionResult: any = null;
  
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

    // Process database operations (Supabase handles consistency)
    try {
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
      const { data: existingItem, error: fetchError } = await supabaseAdmin
        .from('plaid_items')
        .select('*')
        .eq('itemId', itemId)
        .eq('userId', session.user.id)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error fetching plaid item:', fetchError);
        throw new Error('Database error fetching item');
      }

      if (!existingItem) {
        console.error(`❌ Item not found or unauthorized: ${itemId} for user ${session.user.id}`);
        throw new Error('Item not found or unauthorized');
      }

      console.log(`🔄 Updating ${existingItem.institution_name} connection...`);
      
      // Update the access token in the database
      const encryptedAccessToken = encrypt(newAccessToken);
      
      console.log('🔄 Updating database with new access token...', {
        existingItemId: existingItem.id,
        newItemId: newItemId,
        institutionName: existingItem.institutionName || existingItem.institution_name
      });
      
      const { data: updatedItem, error: updateError } = await supabaseAdmin
        .from('plaid_items')
        .update({
          accessToken: encryptedAccessToken, // Use camelCase column name
          itemId: newItemId, // Item ID might change during update
          status: 'active',
          lastSyncAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date().toISOString()
        })
        .eq('id', existingItem.id)
        .select()
        .single();
      
      if (updateError) {
        console.error('Error updating plaid item:', updateError);
        throw new Error('Failed to update plaid item');
      }

      console.log(`✅ Database updated for ${existingItem.institution_name}`);

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
          const { data: creditCards, error: cardsError } = await supabaseAdmin
            .from('credit_cards')
            .select('*')
            .eq('plaid_item_id', updatedItem.id);
          
          if (cardsError) {
            console.error('Error fetching credit cards:', cardsError);
            throw new Error('Failed to fetch credit cards');
          }
          
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
          const { error: warningUpdateError } = await supabaseAdmin
            .from('plaid_items')
            .update({
              status: 'active', // Connection is fixed, but sync had issues
              errorCode: 'SYNC_WARNING',
              errorMessage: `Connection restored but sync incomplete: ${JSON.stringify(syncResult.details)}`,
              updatedAt: new Date().toISOString()
            })
            .eq('id', existingItem.id);
          
          if (warningUpdateError) {
            console.error('Error updating plaid item with warning:', warningUpdateError);
          }
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
        const { error: errorUpdateError } = await supabaseAdmin
          .from('plaid_items')
          .update({
            status: 'active', // Connection is fixed, but sync had issues
            errorCode: 'SYNC_ERROR',
            errorMessage: `Connection restored but comprehensive sync failed: ${syncError?.message}`,
            updatedAt: new Date().toISOString()
          })
          .eq('id', existingItem.id);
        
        if (errorUpdateError) {
          console.error('Error updating plaid item with error:', errorUpdateError);
        }
        
        // Don't throw - connection update succeeded even if sync had issues
        console.warn('⚠️ Connection restored but comprehensive sync failed');
      }

      transactionResult = {
        success: true,
        institutionName: existingItem.institution_name,
        itemId: newItemId,
        userId: session.user.id
      };
    } catch (transactionError) {
      console.error('Transaction error:', transactionError);
      throw transactionError;
    }

    console.log('✅ Database transaction completed successfully');

    // Validate the updates persisted correctly
    console.log('🔍 Validating database updates persisted...');
    const { data: validationItem, error: validationError } = await supabaseAdmin
      .from('plaid_items')
      .select(`
        *,
        credit_cards (
          id,
          name,
          open_date,
          last_statement_issue_date,
          balance_current,
          balance_limit
        )
      `)
      .eq('itemId', transactionResult.itemId)
      .single();
    
    if (validationError) {
      console.error('Validation query error:', validationError);
      throw new Error('Failed to validate database updates');
    }

    if (!validationItem || validationItem.status !== 'active') {
      console.error('❌ Database validation failed - updates did not persist');
      throw new Error('Database updates did not persist correctly');
    }

    console.log('✅ Database validation passed');
    console.log(`✅ Reconnection validation for ${validationItem.institution_name}:`, {
      status: validationItem.status,
      lastSync: validationItem.last_sync_at,
      accounts: validationItem.credit_cards?.length || 0,
      accountDetails: validationItem.credit_cards?.map(acc => ({
        name: acc.name,
        hasOpenDate: !!acc.open_date,
        openDate: acc.open_date ? new Date(acc.open_date).toDateString() : null,
        hasStatement: !!acc.last_statement_issue_date,
        balanceLimit: acc.balance_limit
      })) || []
    });

    return NextResponse.json({ 
      success: true,
      message: `Successfully reconnected ${transactionResult.institutionName}`,
      institutionName: transactionResult.institutionName,
      itemId: transactionResult.itemId,
      validation: {
        status: validationItem.status,
        accountsUpdated: validationItem.credit_cards?.length || 0,
        lastSync: validationItem.last_sync_at
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