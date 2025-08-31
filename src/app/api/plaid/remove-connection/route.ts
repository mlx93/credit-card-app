import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Find the Plaid item and verify ownership
    const { data: plaidItem, error } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching plaid item:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!plaidItem) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    console.log(`Removing Plaid connection for ${plaidItem.institution_name} (${itemId})`);

    try {
      // Try to remove the item from Plaid (best effort)
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      await plaidService.removeItem(decryptedAccessToken);
      console.log('Successfully removed item from Plaid');
    } catch (plaidError) {
      console.warn('Failed to remove item from Plaid (continuing with local cleanup):', plaidError.message);
      // Continue with local cleanup even if Plaid removal fails
    }

    // Clear manual credit limits for all cards associated with this connection
    // This ensures that when users reconnect, they start fresh without old manual overrides
    const { error: clearLimitsError } = await supabaseAdmin
      .from('credit_cards')
      .update({
        ismanuallimit: false,
        manualcreditlimit: null,
        updatedAt: new Date().toISOString()
      })
      .eq('plaidItemId', plaidItem.id);
    
    if (clearLimitsError) {
      console.warn('Failed to clear manual credit limits (continuing with deletion):', clearLimitsError.message);
    } else {
      console.log('Cleared manual credit limits for cards in this connection');
    }

    // Remove from local database (cascading deletes will handle related data)
    const { error: deleteError } = await supabaseAdmin
      .from('plaid_items')
      .delete()
      .eq('id', plaidItem.id);
    
    if (deleteError) {
      console.error('Error deleting plaid item:', deleteError);
      return NextResponse.json({ error: 'Failed to remove connection' }, { status: 500 });
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