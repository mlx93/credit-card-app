import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('⚡ FAST CARD SETUP - Starting optimized sync for new card');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();
    
    if (!itemId) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    console.log('⚡ Fast setup for itemId:', itemId);

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

    // Phase 1: Essential data only (fast)
    console.log('⚡ Phase 1: Syncing accounts and recent transactions only...');
    
    // Sync accounts first (creates the credit card records)
    await plaidService.syncAccounts(accessToken, itemId);
    console.log('✅ Accounts synced');

    // Get only recent transactions (last 3 months for billing cycles)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3); // Only 3 months for fast setup

    console.log('⚡ Fetching recent transactions for billing cycle calculation...');
    await plaidService.syncTransactions(plaidItem, accessToken);
    console.log('✅ Recent transactions synced');

    // Calculate billing cycles with recent transaction data
    console.log('⚡ Calculating billing cycles with recent data...');
    const { calculateBillingCycles } = await import('@/utils/billingCycles');
    
    // Get credit cards for this item
    const { data: creditCards } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItem.id);

    let cyclesCalculated = 0;
    for (const card of creditCards || []) {
      // Calculate billing cycles with available transaction data
      const cycles = await calculateBillingCycles(card.id);
      cyclesCalculated += cycles.length;
      console.log(`✅ Card ${card.name}: ${cycles.length} billing cycles calculated`);
    }

    console.log(`⚡ Phase 1 complete: ${cyclesCalculated} essential billing cycles calculated`);

    // Phase 2: Schedule background sync for full historical data
    console.log('⚡ Scheduling background sync for full transaction history...');
    
    // Trigger full sync in background after delay (non-blocking)
    setTimeout(async () => {
      try {
        console.log('🔄 Background: Starting full sync for historical data...');
        
        // Call the regular sync endpoint for full historical processing
        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId })
        });
        
        console.log('✅ Background full sync completed');
      } catch (error) {
        console.error('❌ Background sync error:', error);
      }
    }, 10000); // Start full sync 10 seconds after fast setup completes

    return NextResponse.json({
      success: true,
      message: 'Fast card setup completed',
      phase: 'essential_data_ready',
      backgroundSyncScheduled: true,
      creditCardsFound: creditCards?.length || 0
    });

  } catch (error: any) {
    console.error('❌ Fast card setup error:', error);
    return NextResponse.json({
      error: 'Fast card setup failed',
      details: error.message
    }, { status: 500 });
  }
}