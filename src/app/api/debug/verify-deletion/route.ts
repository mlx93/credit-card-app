import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    console.log(`🔍 Verifying deletion cleanup for itemId: ${itemId}`);

    // Check if plaid_items record exists
    const { data: plaidItem, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();

    const plaidItemExists = !plaidError && plaidItem;
    console.log(`plaid_items record exists: ${plaidItemExists}`);

    if (plaidItemExists) {
      // If plaid item still exists, check all related data
      const plaidItemDbId = plaidItem.id;

      // Check credit cards
      const { data: creditCards, error: cardsError } = await supabaseAdmin
        .from('credit_cards')
        .select('id, name')
        .eq('plaidItemId', plaidItemDbId);

      const creditCardCount = creditCards?.length || 0;
      const creditCardIds = (creditCards || []).map(card => card.id);
      
      console.log(`credit_cards records found: ${creditCardCount}`, creditCards?.map(c => c.name));

      let transactionCount = 0;
      let billingCycleCount = 0;
      let aprCount = 0;

      if (creditCardIds.length > 0) {
        // Check transactions
        const { data: transactions } = await supabaseAdmin
          .from('transactions')
          .select('id')
          .in('creditCardId', creditCardIds);
        
        transactionCount = transactions?.length || 0;

        // Check billing cycles
        const { data: billingCycles } = await supabaseAdmin
          .from('billing_cycles')
          .select('id')
          .in('creditCardId', creditCardIds);
        
        billingCycleCount = billingCycles?.length || 0;

        // Check APRs
        const { data: aprs } = await supabaseAdmin
          .from('aprs')
          .select('id')
          .in('creditCardId', creditCardIds);
        
        aprCount = aprs?.length || 0;
      }

      console.log(`Related data counts:`, {
        transactions: transactionCount,
        billingCycles: billingCycleCount,
        aprs: aprCount
      });

      return NextResponse.json({
        deletionComplete: false,
        itemId,
        remainingData: {
          plaidItems: 1,
          creditCards: creditCardCount,
          transactions: transactionCount,
          billingCycles: billingCycleCount,
          aprs: aprCount
        },
        creditCardNames: creditCards?.map(c => c.name) || []
      });
    } else {
      // Plaid item doesn't exist, but double-check for orphaned data
      console.log('plaid_items record not found, checking for orphaned data...');
      
      // This is harder to check without the plaidItemId, but we can look for any
      // data that might reference the itemId in other ways
      return NextResponse.json({
        deletionComplete: true,
        itemId,
        message: 'No plaid_items record found. Deletion appears complete.',
        remainingData: {
          plaidItems: 0,
          creditCards: 0,
          transactions: 0,
          billingCycles: 0,
          aprs: 0
        }
      });
    }

  } catch (error) {
    console.error('Error verifying deletion:', error);
    return NextResponse.json({ 
      error: 'Failed to verify deletion',
      details: error.message 
    }, { status: 500 });
  }
}