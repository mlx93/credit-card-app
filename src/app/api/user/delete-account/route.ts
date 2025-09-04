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

    const userId = session.user.id;
    console.log(`🗑️ Starting complete account deletion for user: ${userId}`);

    // Step 1: Get all user's Plaid items to remove from Plaid API
    const { data: plaidItems, error: plaidItemsError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', userId);
    
    if (plaidItemsError) {
      console.error('Error fetching user Plaid items:', plaidItemsError);
      return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 });
    }

    console.log(`📊 Found ${plaidItems?.length || 0} Plaid connections to remove`);

    // Step 2: Remove all Plaid items from Plaid API (best effort)
    if (plaidItems && plaidItems.length > 0) {
      for (const plaidItem of plaidItems) {
        try {
          console.log(`🔌 Removing Plaid connection: ${plaidItem.institutionName}`);
          const decryptedAccessToken = decrypt(plaidItem.accessToken);
          await plaidService.removeItem(decryptedAccessToken);
          console.log(`✅ Successfully removed ${plaidItem.institutionName} from Plaid`);
        } catch (plaidError) {
          console.warn(`⚠️ Failed to remove ${plaidItem.institutionName} from Plaid API (continuing):`, plaidError.message);
          // Continue with local cleanup even if Plaid removal fails
        }
      }
    }

    // Step 3: Get all user's credit cards for comprehensive cleanup
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id')
      .in('plaidItemId', (plaidItems || []).map(item => item.id));
    
    if (cardsError) {
      console.error('Error fetching user credit cards:', cardsError);
      return NextResponse.json({ error: 'Failed to fetch card data' }, { status: 500 });
    }

    const creditCardIds = (creditCards || []).map(card => card.id);
    console.log(`💳 Found ${creditCardIds.length} credit cards to delete`);

    // Step 4: Delete all related data in proper order (child to parent)
    let deletionSummary = {
      aprs: 0,
      billingCycles: 0,
      transactions: 0,
      creditCards: 0,
      plaidItems: 0,
      userPreferences: 0
    };

    if (creditCardIds.length > 0) {
      // Delete APRs
      const { error: aprsError, count: aprsCount } = await supabaseAdmin
        .from('aprs')
        .delete({ count: 'exact' })
        .in('creditCardId', creditCardIds);
      
      if (aprsError) {
        console.error('Error deleting APRs:', aprsError);
        return NextResponse.json({ error: 'Failed to delete APR data' }, { status: 500 });
      }
      deletionSummary.aprs = aprsCount || 0;

      // Delete billing cycles
      const { error: cyclesError, count: cyclesCount } = await supabaseAdmin
        .from('billing_cycles')
        .delete({ count: 'exact' })
        .in('creditCardId', creditCardIds);
      
      if (cyclesError) {
        console.error('Error deleting billing cycles:', cyclesError);
        return NextResponse.json({ error: 'Failed to delete billing cycle data' }, { status: 500 });
      }
      deletionSummary.billingCycles = cyclesCount || 0;

      // Delete transactions (including all accumulated historical data)
      const { error: transactionsError, count: transactionsCount } = await supabaseAdmin
        .from('transactions')
        .delete({ count: 'exact' })
        .in('creditCardId', creditCardIds);
      
      if (transactionsError) {
        console.error('Error deleting transactions:', transactionsError);
        return NextResponse.json({ error: 'Failed to delete transaction data' }, { status: 500 });
      }
      deletionSummary.transactions = transactionsCount || 0;

      // Also delete any transactions that might be linked to plaidItemId directly
      const { error: directTransactionsError, count: directTransactionsCount } = await supabaseAdmin
        .from('transactions')
        .delete({ count: 'exact' })
        .in('plaidItemId', (plaidItems || []).map(item => item.id));
      
      if (directTransactionsError) {
        console.warn('Warning deleting direct plaid transactions:', directTransactionsError);
      } else {
        deletionSummary.transactions += (directTransactionsCount || 0);
      }
    }

    // Delete credit cards
    const { error: cardsDeleteError, count: cardsCount } = await supabaseAdmin
      .from('credit_cards')
      .delete({ count: 'exact' })
      .in('plaidItemId', (plaidItems || []).map(item => item.id));
    
    if (cardsDeleteError) {
      console.error('Error deleting credit cards:', cardsDeleteError);
      return NextResponse.json({ error: 'Failed to delete credit card data' }, { status: 500 });
    }
    deletionSummary.creditCards = cardsCount || 0;

    // Delete Plaid items
    const { error: plaidDeleteError, count: plaidCount } = await supabaseAdmin
      .from('plaid_items')
      .delete({ count: 'exact' })
      .eq('userId', userId);
    
    if (plaidDeleteError) {
      console.error('Error deleting Plaid items:', plaidDeleteError);
      return NextResponse.json({ error: 'Failed to delete connection data' }, { status: 500 });
    }
    deletionSummary.plaidItems = plaidCount || 0;

    // Step 5: Delete any user preferences or settings (if table exists)
    try {
      const { error: prefsError, count: prefsCount } = await supabaseAdmin
        .from('user_preferences')
        .delete({ count: 'exact' })
        .eq('userId', userId);
      
      if (!prefsError) {
        deletionSummary.userPreferences = prefsCount || 0;
      }
    } catch (error) {
      console.log('No user_preferences table found (this is fine)');
    }

    // Step 6: Log comprehensive deletion summary
    console.log(`🎯 ACCOUNT DELETION COMPLETED for user ${userId}:`);
    console.log(`   • APR records: ${deletionSummary.aprs}`);
    console.log(`   • Billing cycles: ${deletionSummary.billingCycles}`);  
    console.log(`   • Transactions: ${deletionSummary.transactions} (including historical)`);
    console.log(`   • Credit cards: ${deletionSummary.creditCards}`);
    console.log(`   • Plaid connections: ${deletionSummary.plaidItems}`);
    console.log(`   • User preferences: ${deletionSummary.userPreferences}`);
    console.log(`🗑️ Total data points deleted: ${Object.values(deletionSummary).reduce((a, b) => a + b, 0)}`);

    return NextResponse.json({ 
      success: true, 
      message: 'Account and all associated data successfully deleted',
      deletionSummary
    });

  } catch (error) {
    console.error('❌ Error during account deletion:', error);
    return NextResponse.json({ 
      error: 'Failed to delete account',
      details: error.message 
    }, { status: 500 });
  }
}