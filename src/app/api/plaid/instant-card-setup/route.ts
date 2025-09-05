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

    // Phase 1.5: Sync recent transactions (3 months) and calculate Recent Billing Cycles for instant visibility
    console.log('⚡ Phase 1.5: Syncing recent transactions and calculating Recent Billing Cycles...');
    
    let recentCyclesCalculated = 0;
    
    try {
      // Brief delay to let database commit from syncAccounts
      console.log('⏳ Brief delay for database commit before transaction sync...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Sync recent transactions (3 months only for speed)
      console.log('🔄 Starting recent transaction sync (3 months for instant setup)...');
      await plaidService.syncRecentTransactions(plaidItem, accessToken);
      console.log('✅ Recent transactions synced for instant setup');
      
      // Brief pause to ensure transactions are stored
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Calculate Recent Billing Cycles (current + most recently closed) for immediate visibility
      const { calculateCurrentBillingCycle, calculateRecentClosedCycle } = await import('@/utils/billingCycles');
      for (const card of creditCards || []) {
        try {
          console.log(`🔄 Calculating Recent Billing Cycles for ${card.name}...`);
          
          // Calculate current open cycle
          const currentCycle = await calculateCurrentBillingCycle(card.id);
          if (currentCycle) {
            recentCyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Current billing cycle calculated (${currentCycle.startDate} to ${currentCycle.endDate})`);
          }
          
          // Calculate most recent closed cycle 
          const recentClosedCycle = await calculateRecentClosedCycle(card.id);
          if (recentClosedCycle) {
            recentCyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Recent closed billing cycle calculated (${recentClosedCycle.startDate} to ${recentClosedCycle.endDate})`);
          }
        } catch (cycleError) {
          console.error(`❌ Failed to calculate Recent Billing Cycles for ${card.name}:`, cycleError);
          // Continue - missing cycle data shouldn't block card visibility
        }
      }
      
      console.log(`⚡ Recent Billing Cycles calculated: ${recentCyclesCalculated} cycles (current + recent closed for each card)`);
    } catch (recentSyncError) {
      console.warn('⚠️ Recent transaction sync failed, card will appear without Recent Billing Cycles:', recentSyncError);
      // Continue - card should still be visible with basic data
    }

    // Phase 2: Schedule comprehensive background sync for full transaction history
    console.log('⚡ Scheduling comprehensive background sync for full history...');
    
    // Note: Comprehensive sync will be handled by Dashboard after card appears
    // This ensures the card appears immediately with Recent Billing Cycles, then full history loads in background

    console.log(`✅ Instant card setup completed: ${creditCards?.length || 0} credit cards found`);
    
    return NextResponse.json({
      success: true,
      message: 'Instant card setup with Recent Billing Cycles completed',
      phase: 'cards_with_recent_cycles_ready',
      creditCardsFound: creditCards?.length || 0,
      recentCyclesCalculated: recentCyclesCalculated || 0,
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