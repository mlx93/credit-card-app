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
    
    const accountSyncResult = await plaidService.syncAccounts(accessToken, itemId);
    console.log('✅ Credit card records created');

    // Get the newly created credit cards
    const { data: creditCards } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItem.id);

    // Phase 1.5: Get recent transactions for current cycle estimation
    console.log('⚡ Phase 1.5: Fetching recent transactions for current cycle...');
    
    try {
      // Sync recent transactions (syncTransactions handles the date range internally)
      await plaidService.syncTransactions(plaidItem, accessToken);
      console.log('✅ Recent transactions synced');
      
      // Calculate current + most recent closed billing cycles for immediate visibility
      const { calculateCurrentBillingCycle, calculateRecentClosedCycle } = await import('@/utils/billingCycles');
      
      let cyclesCalculated = 0;
      for (const card of creditCards || []) {
        try {
          // Calculate current open cycle
          const currentCycle = await calculateCurrentBillingCycle(card.id);
          if (currentCycle) {
            cyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Current billing cycle calculated`);
          }
          
          // Calculate most recent closed cycle 
          const recentClosedCycle = await calculateRecentClosedCycle(card.id);
          if (recentClosedCycle) {
            cyclesCalculated += 1;
            console.log(`✅ Card ${card.name}: Recent closed billing cycle calculated`);
          }
        } catch (cycleError) {
          console.warn(`⚠️ Could not calculate cycles for ${card.name}:`, cycleError);
          // Continue - missing cycle data shouldn't block card visibility
        }
      }
      
      console.log(`⚡ Phase 1 complete: ${cyclesCalculated} essential cycles calculated (current + recent closed)`);
    } catch (transactionError) {
      console.warn('⚠️ Recent transaction sync failed, continuing without cycles:', transactionError);
      // Continue without cycles - card should still be visible
    }

    // Phase 2: Schedule comprehensive background processing
    console.log('⚡ Scheduling comprehensive background sync...');
    
    // Trigger full historical sync in background (non-blocking)
    setTimeout(async () => {
      try {
        console.log('🔄 Background: Starting comprehensive sync for full history...');
        
        // Call comprehensive sync endpoint for full historical processing
        const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/plaid/comprehensive-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId })
        });
        
        if (response.ok) {
          console.log('✅ Background comprehensive sync completed');
        } else {
          console.error('❌ Background sync failed:', await response.text());
        }
      } catch (error) {
        console.error('❌ Background sync error:', error);
      }
    }, 2000); // Start comprehensive sync 2 seconds after instant setup completes

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