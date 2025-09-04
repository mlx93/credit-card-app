import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('⚡ INSTANT CARD SETUP - Ultra-fast essential data only');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();
    
    if (!itemId) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    console.log('⚡ Instant setup for itemId:', itemId);

    // Get the plaid item
    const { data: plaidItem, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();

    if (plaidError || !plaidItem) {
      throw new Error('Plaid item not found');
    }

    const accessToken = decrypt(plaidItem.accessToken);

    // Phase 1: ONLY create credit card records (ultra fast)
    console.log('⚡ Phase 1: Creating credit card records only...');
    
    let accountSyncResult;
    try {
      accountSyncResult = await plaidService.syncAccounts(accessToken, itemId);
      console.log('✅ Credit card records created:', accountSyncResult);
    } catch (syncAccountsError) {
      console.error('❌ Failed to sync accounts:', syncAccountsError);
      
      // Check if this is an OAuth error - these are common and should be handled gracefully
      if (syncAccountsError.message?.includes('OAUTH_INVALID_TOKEN') || 
          syncAccountsError.message?.includes('ITEM_LOGIN_REQUIRED')) {
        console.warn('⚠️ OAuth error during account sync - this is common with some institutions');
        console.warn('💡 User will need to re-authenticate, but we should still return success');
        
        // Return early with OAuth error status but don't fail completely
        return NextResponse.json({
          success: false,
          message: 'Authentication required',
          phase: 'oauth_required',
          creditCardsFound: 0,
          backgroundSyncScheduled: false,
          readyForDisplay: false,
          requiresReauth: true,
          error: 'OAUTH_INVALID_TOKEN'
        });
      }
      
      throw new Error(`Account sync failed: ${syncAccountsError.message}`);
    }

    // Wait a moment for database to commit, then get the newly created credit cards
    console.log('⏳ Waiting 1 second for database commit...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const { data: creditCards, error: cardFetchError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItem.id);
      
    console.log(`📊 Credit cards found: ${creditCards?.length || 0} for plaidItemId: ${plaidItem.id}`);
    if (cardFetchError) {
      console.error('❌ Error fetching credit cards:', cardFetchError);
      throw new Error(`Failed to fetch credit cards: ${cardFetchError.message}`);
    }
    
    // Critical: If syncAccounts reported cards but we can't find them, fail
    if (!creditCards || creditCards.length === 0) {
      if (accountSyncResult.creditCardsFound > 0) {
        console.error(`❌ syncAccounts reported ${accountSyncResult.creditCardsFound} cards but database query found 0`);
        throw new Error(`Card creation failed: syncAccounts reported ${accountSyncResult.creditCardsFound} cards but none found in database`);
      }
      console.warn('⚠️ No credit cards found for this institution');
      // Return early with no cards found
      return NextResponse.json({
        success: false,
        message: 'No credit cards found',
        phase: 'no_cards',
        creditCardsFound: 0,
        backgroundSyncScheduled: false,
        readyForDisplay: false
      });
    }
    
    creditCards.forEach(card => {
      console.log(`📋 Found card: ${card.name} (${card.accountId})`);
    });

    // Phase 1.5: Get recent transactions for current cycle estimation
    console.log('⚡ Phase 1.5: Fetching recent transactions for current cycle...');
    
    try {
      // Sync recent transactions using optimized method (3 months vs 12 months)
      console.log('🔄 Starting optimized recent transaction sync (3 months only)...');
      await plaidService.syncRecentTransactions(plaidItem, accessToken);
      console.log('✅ Recent transactions synced');
      
      // Wait a moment for transaction storage to complete, then calculate cycles
      console.log('⏳ Brief pause to ensure transactions are stored...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Calculate current + most recent closed billing cycles for immediate visibility
      const { calculateCurrentBillingCycle, calculateRecentClosedCycle } = await import('@/utils/billingCycles');
      
      let cyclesCalculated = 0;
      for (const card of creditCards || []) {
        try {
          console.log(`🔄 Calculating cycles for ${card.name} (id: ${card.id})...`);
          
          // Calculate current open cycle
          const currentCycle = await calculateCurrentBillingCycle(card.id);
          if (currentCycle) {
            cyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Current billing cycle calculated (${currentCycle.startDate} to ${currentCycle.endDate})`);
          } else {
            console.warn(`⚠️ Card ${card.name}: No current billing cycle returned`);
          }
          
          // Calculate most recent closed cycle 
          const recentClosedCycle = await calculateRecentClosedCycle(card.id);
          if (recentClosedCycle) {
            cyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Recent closed billing cycle calculated (${recentClosedCycle.startDate} to ${recentClosedCycle.endDate})`);
          } else {
            console.warn(`⚠️ Card ${card.name}: No recent closed cycle returned`);
          }
        } catch (cycleError) {
          console.error(`❌ Failed to calculate cycles for ${card.name}:`, cycleError);
          // Continue - missing cycle data shouldn't block card visibility
        }
      }
      
      console.log(`⚡ Phase 1 complete: ${cyclesCalculated} essential cycles calculated (current + recent closed)`);
    } catch (transactionError) {
      console.warn('⚠️ Recent transaction sync failed, continuing without cycles:', transactionError);
      console.warn('💡 Card will still be visible, full sync will happen in background');
      // Continue without cycles - card should still be visible
    }

    // Phase 2: Schedule comprehensive background processing
    console.log('⚡ Scheduling comprehensive background sync...');
    
    // Schedule comprehensive background sync (direct call, not HTTP)
    setTimeout(async () => {
      try {
        console.log('🔄 Background: Starting comprehensive sync for full history...');
        
        // Direct comprehensive sync (no HTTP call - prevents authentication and timeout issues)
        await plaidService.syncTransactions(plaidItem, accessToken);
        console.log('✅ Background: Full transaction history synced');
        
        // Calculate complete billing cycle history
        const { calculateBillingCycles } = await import('@/utils/billingCycles');
        
        // Get credit cards for this item
        const { data: backgroundCreditCards } = await supabaseAdmin
          .from('credit_cards')
          .select('*')
          .eq('plaidItemId', plaidItem.id);

        let totalCyclesCalculated = 0;
        for (const card of backgroundCreditCards || []) {
          try {
            console.log(`🔄 Background: Calculating full billing history for ${card.name}...`);
            
            // Get existing cycles to preserve the ones created by instant-setup
            const { data: existingCycles } = await supabaseAdmin
              .from('billing_cycles')
              .select('*')
              .eq('creditCardId', card.id);
            
            console.log(`🔄 Background: Updating billing history for ${card.name} (preserving ${existingCycles?.length || 0} existing cycles)...`);
            
            // Calculate complete billing cycle history (preserves existing ones)
            const cycles = await calculateBillingCycles(card.id);
            totalCyclesCalculated += cycles.length;
            
            console.log(`✅ Background: Card ${card.name}: ${cycles.length} total billing cycles (${existingCycles?.length || 0} updated, ${cycles.length - (existingCycles?.length || 0)} new)`);
          } catch (cycleError) {
            console.error(`❌ Background: Failed to calculate cycles for ${card.name}:`, cycleError);
          }
        }
        
        console.log(`✅ Background comprehensive sync completed: ${totalCyclesCalculated} total cycles calculated`);
        
      } catch (error) {
        console.error('❌ Background sync error:', error);
      }
    }, 5000); // Increased delay to 5 seconds to ensure instant setup is fully complete

    console.log(`✅ Instant card setup completed: ${creditCards?.length || 0} credit cards found`);
    
    return NextResponse.json({
      success: true,
      message: 'Instant card setup completed',
      phase: 'cards_ready',
      creditCardsFound: creditCards?.length || 0,
      backgroundSyncScheduled: true,
      readyForDisplay: true
    });

  } catch (error: any) {
    console.error('❌ Instant card setup error:', error);
    return NextResponse.json({
      error: 'Instant card setup failed',
      details: error.message
    }, { status: 500 });
  }
}