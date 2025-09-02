import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {{
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-sync-capital-one',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE SYNC TEST ===');

    // Get Capital One Plaid item
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const capitalOnePlaidItem = (plaidItems || []).find(item => 
      item.institutionName?.toLowerCase().includes('capital one')
    );

    if (!capitalOnePlaidItem) {
      return NextResponse.json({ error: 'No Capital One Plaid item found' }, { status: 404 });
    }

    console.log('Found Capital One item:', capitalOnePlaidItem.institutionName);

    try {
      const decryptedAccessToken = decrypt(capitalOnePlaidItem.accessToken);
      
      // Run the sync specifically for this item
      console.log('Running account sync for Capital One...');
      await plaidService.syncAccounts(decryptedAccessToken, capitalOnePlaidItem.itemId);
      
      // Get updated card data
      const { data: updatedCards, error: cardsError } = await supabaseAdmin
        .from('credit_cards')
        .select('id, name, mask, balanceLimit, balanceCurrent, balanceAvailable')
        .eq('plaidItemId', capitalOnePlaidItem.id);

      if (cardsError) {
        throw new Error(`Failed to fetch updated cards: ${cardsError.message}`);
      }

      console.log('Updated Capital One cards after sync:', updatedCards);

      return NextResponse.json({
        success: true,
        message: 'Capital One sync completed',
        updatedCards
      });

    } catch (error) {
      console.error('Capital One sync error:', error);
      return NextResponse.json({
        success: false,
        error: 'Sync failed',
        details: error.message
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Capital One sync test error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Test failed',
      details: error.message 
    }, { status: 500 });
  }
}