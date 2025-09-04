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

    // Phase 1: Sync ALL historical transactions (this can be slow)
    console.log('🔄 Phase 1: Syncing full transaction history...');
    await plaidService.syncTransactions(plaidItem, accessToken);
    console.log('✅ Full transaction history synced');

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
        // Delete existing billing cycles to force complete regeneration
        await supabaseAdmin
          .from('billing_cycles')
          .delete()
          .eq('creditCardId', card.id);
        
        // Calculate complete billing cycle history
        const cycles = await calculateBillingCycles(card.id);
        totalCyclesCalculated += cycles.length;
        console.log(`✅ Card ${card.name}: ${cycles.length} total billing cycles calculated`);
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