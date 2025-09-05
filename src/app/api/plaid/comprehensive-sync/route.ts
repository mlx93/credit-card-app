import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 COMPREHENSIVE SYNC - Full historical data processing');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();
    
    if (!itemId) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    console.log('🔄 Comprehensive sync for itemId:', itemId);

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

    // Check if we've synced this item recently (within 12 hours) to avoid unnecessary API calls
    const lastSyncDate = plaidItem.lastSyncAt ? new Date(plaidItem.lastSyncAt) : null;
    const twelveHoursAgo = new Date();
    twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);
    
    if (lastSyncDate && lastSyncDate > twelveHoursAgo) {
      const hoursAgo = Math.round((Date.now() - lastSyncDate.getTime()) / (1000 * 60 * 60));
      console.log(`⏭️ Skipping comprehensive sync - item was synced ${hoursAgo}h ago (less than 12h)`);
      
      return NextResponse.json({
        success: true,
        message: 'Comprehensive sync skipped - recent sync found',
        lastSyncAt: lastSyncDate.toISOString(),
        hoursAgo
      });
    }

    // Phase 1: Sync HISTORICAL transactions (avoiding recent duplicates)
    console.log('🔄 Phase 1: Syncing historical transaction data...');
    
    // Check if recent transactions already exist to avoid duplicate syncing
    const { data: recentTransactions } = await supabaseAdmin
      .from('transactions')
      .select('date')
      .in('creditCardId', (await supabaseAdmin
        .from('credit_cards')
        .select('id')
        .eq('plaidItemId', plaidItem.id)).data?.map(c => c.id) || [])
      .order('date', { ascending: false })
      .limit(1);
      
    const hasRecentData = recentTransactions && recentTransactions.length > 0;
    const latestTransactionDate = hasRecentData ? new Date(recentTransactions[0].date) : null;
    
    if (hasRecentData) {
      console.log(`📊 Found recent transactions up to ${latestTransactionDate?.toISOString().split('T')[0]}`);
      console.log('⚡ Syncing only historical data older than recent transactions to avoid duplicates');
      
      // Sync only historical data (older than what instant-setup already fetched)
      await plaidService.syncHistoricalTransactions(plaidItem, accessToken, latestTransactionDate);
    } else {
      console.log('📊 No recent transactions found, syncing full historical data');
      await plaidService.syncTransactions(plaidItem, accessToken);
    }
    
    console.log('✅ Historical transaction sync completed');

    // Phase 2: Calculate ALL historical billing cycles
    console.log('🔄 Phase 2: Calculating complete billing cycle history...');
    const { calculateBillingCycles } = await import('@/utils/billingCycles');
    
    // Get credit cards for this item
    const { data: creditCards } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('plaidItemId', plaidItem.id);

    let totalCyclesCalculated = 0;
    for (const card of creditCards || []) {
      console.log(`🔄 Calculating full billing history for ${card.name}...`);
      
      try {
        // Get existing cycles to preserve the ones created by instant-setup
        const { data: existingCycles } = await supabaseAdmin
          .from('billing_cycles')
          .select('*')
          .eq('creditCardId', card.id);
        
        console.log(`🔄 Updating billing history for ${card.name} (preserving ${existingCycles?.length || 0} existing cycles)...`);
        
        // Calculate complete billing cycle history (calculateBillingCycles will update existing ones)
        const cycles = await calculateBillingCycles(card.id);
        totalCyclesCalculated += cycles.length;
        
        console.log(`✅ Card ${card.name}: ${cycles.length} total billing cycles (${existingCycles?.length || 0} updated, ${cycles.length - (existingCycles?.length || 0)} new)`);
      } catch (cycleError) {
        console.error(`❌ Failed to calculate cycles for ${card.name}:`, cycleError);
      }
    }

    // Update plaid item status
    await supabaseAdmin
      .from('plaid_items')
      .update({
        status: 'active',
        lastSyncAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null
      })
      .eq('itemId', itemId);

    console.log(`✅ Comprehensive sync complete: ${totalCyclesCalculated} total cycles calculated`);

    return NextResponse.json({
      success: true,
      message: 'Comprehensive sync completed',
      totalCyclesCalculated,
      creditCardsProcessed: creditCards?.length || 0
    });

  } catch (error: any) {
    console.error('❌ Comprehensive sync error:', error);
    
    // Update plaid item with error status
    try {
      await supabaseAdmin
        .from('plaid_items')
        .update({
          status: 'error',
          errorCode: 'COMPREHENSIVE_SYNC_ERROR',
          errorMessage: error.message || 'Unknown sync error'
        })
        .eq('itemId', await request.json().then(body => body.itemId))
        .catch(() => {});
    } catch (updateError) {
      console.error('Failed to update error status:', updateError);
    }
    
    return NextResponse.json({
      error: 'Comprehensive sync failed',
      details: error.message
    }, { status: 500 });
  }
}