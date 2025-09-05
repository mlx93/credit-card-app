import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function DELETE(request: NextRequest) {
  console.log('🗑️ DELETE /api/plaid/remove-connection called');
  
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      console.error('🗑️ Unauthorized - no session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();
    console.log('🗑️ Received itemId:', itemId);

    if (!itemId) {
      console.error('🗑️ No itemId provided');
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Find the Plaid item and verify ownership
    console.log('🗑️ Looking up plaid item for user:', session.user.id);
    const { data: plaidItem, error } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('🗑️ Error fetching plaid item:', error);
      return NextResponse.json({ error: 'Database error', details: error.message }, { status: 500 });
    }

    if (!plaidItem) {
      console.error('🗑️ Plaid item not found for itemId:', itemId);
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    console.log(`Removing Plaid connection for ${plaidItem.institutionName} (${itemId})`);

    try {
      // Try to remove the item from Plaid (best effort, with timeout)
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Plaid removeItem timeout')), 5000));
      await Promise.race([plaidService.removeItem(decryptedAccessToken), timeout]);
      console.log('Successfully removed item from Plaid');
    } catch (plaidError: any) {
      console.warn('Failed or timed out removing item from Plaid (continuing with local cleanup):', plaidError?.message || plaidError);
      // Continue with local cleanup even if Plaid removal fails or times out
    }

    // Get all credit cards associated with this plaid item before deletion
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id')
      .eq('plaidItemId', plaidItem.id);
    
    if (cardsError) {
      console.error('Error fetching credit cards for deletion:', cardsError);
      return NextResponse.json({ error: 'Failed to fetch cards for deletion' }, { status: 500 });
    }

    const creditCardIds = (creditCards || []).map(card => card.id);
    console.log(`Found ${creditCardIds.length} credit cards to delete:`, creditCardIds);

    // Skip RPC functions for now - use direct deletion which is more reliable
    const didUseRPC = false;
    
    if (!didUseRPC) {
      // Step 1: Delete related data explicitly to ensure complete cleanup
      if (creditCardIds.length > 0) {
        // Delete APRs
        const { error: aprsDeleteError } = await supabaseAdmin
          .from('aprs')
          .delete()
          .in('creditCardId', creditCardIds);
        
        if (aprsDeleteError) {
          console.error('Error deleting APRs:', aprsDeleteError);
          return NextResponse.json({ error: 'Failed to delete APR data' }, { status: 500 });
        }
        console.log(`Deleted APR data for ${creditCardIds.length} cards`);

        // Delete billing cycles
        const { error: billingCyclesDeleteError } = await supabaseAdmin
          .from('billing_cycles')
          .delete()
          .in('creditCardId', creditCardIds);
        
        if (billingCyclesDeleteError) {
          console.error('Error deleting billing cycles:', billingCyclesDeleteError);
          return NextResponse.json({ error: 'Failed to delete billing cycle data' }, { status: 500 });
        }
        console.log(`Deleted billing cycles for ${creditCardIds.length} cards`);

        // Delete transactions
        const { error: transactionsDeleteError } = await supabaseAdmin
          .from('transactions')
          .delete()
          .in('creditCardId', creditCardIds);
        
        if (transactionsDeleteError) {
          console.error('Error deleting transactions:', transactionsDeleteError);
          return NextResponse.json({ error: 'Failed to delete transaction data' }, { status: 500 });
        }
        console.log(`Deleted transactions for ${creditCardIds.length} cards`);
      }

      // Step 2: Delete credit cards
      const { error: creditCardsDeleteError } = await supabaseAdmin
        .from('credit_cards')
        .delete()
        .eq('plaidItemId', plaidItem.id);
      
      if (creditCardsDeleteError) {
        console.error('Error deleting credit cards:', creditCardsDeleteError);
        return NextResponse.json({ error: 'Failed to delete credit card data' }, { status: 500 });
      }
      console.log(`Deleted ${creditCardIds.length} credit cards`);

      // Step 3: Finally delete the plaid item
      const { error: deleteError } = await supabaseAdmin
        .from('plaid_items')
        .delete()
        .eq('id', plaidItem.id);
      
      if (deleteError) {
        console.error('Error deleting plaid item:', deleteError);
        return NextResponse.json({ error: 'Failed to remove connection' }, { status: 500 });
      }
      console.log(`Deleted plaid item: ${plaidItem.institutionName}`);
    }

    // Post-delete verification to avoid partial cleanup issues
    const { data: remainingCards } = await supabaseAdmin
      .from('credit_cards')
      .select('id')
      .eq('plaidItemId', plaidItem.id);
    const { data: remainingItem } = await supabaseAdmin
      .from('plaid_items')
      .select('id')
      .eq('id', plaidItem.id)
      .maybeSingle();

    if ((remainingCards && remainingCards.length > 0) || remainingItem) {
      console.error('Post-delete verification failed:', {
        remainingCardCount: remainingCards?.length || 0,
        remainingItem: !!remainingItem,
      });
      return NextResponse.json({ error: 'Partial deletion detected. Please try again.' }, { status: 500 });
    }

    console.log(`Successfully removed connection for ${plaidItem.institutionName}`);

    return NextResponse.json({ 
      success: true, 
      message: `Removed connection to ${plaidItem.institutionName}`
    });

  } catch (error) {
    console.error('Error removing Plaid connection:', error);
    return NextResponse.json({ 
      error: 'Failed to remove connection',
      details: error.message 
    }, { status: 500 });
  }
}
