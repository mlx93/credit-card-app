import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    // Get user session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the itemId from request body
    const { itemId, cardId } = await request.json();
    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });
    }

    console.log(`🔄 Starting 30-day transaction sync for item ${itemId}, card ${cardId || 'all'}`);

    // Get the Plaid item and access token
    const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
      .from('plaid_items')
      .select('*, credit_cards(*)')
      .eq('itemId', itemId)
      .eq('userId', session.user.id)
      .single();

    if (plaidItemError || !plaidItem) {
      console.error('Failed to fetch Plaid item:', plaidItemError);
      return NextResponse.json({ error: 'Plaid item not found' }, { status: 404 });
    }

    // Decrypt the access token before using it
    const decryptedAccessToken = decrypt(plaidItem.accessToken);
    
    // Calculate date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    
    console.log(`📅 Fetching transactions from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // Fetch fresh transactions from Plaid for the last 30 days
    const freshTransactions = await plaidService.getTransactions(
      decryptedAccessToken,
      startDate,
      endDate,
      false,
      false
    );

    console.log(`✅ Fetched ${freshTransactions.length} transactions from Plaid`);

    if (freshTransactions.length > 0) {
      // Get credit card IDs for this Plaid item
      let creditCardIds: string[] = [];
      if (cardId) {
        // Sync specific card only
        creditCardIds = [cardId];
      } else {
        // Sync all cards for this Plaid item
        creditCardIds = plaidItem.credit_cards.map((card: any) => card.id);
      }

      // Delete existing transactions in the 30-day window for these cards
      const { error: deleteError, count: deletedCount } = await supabaseAdmin
        .from('transactions')
        .delete()
        .in('creditCardId', creditCardIds)
        .gte('date', startDate.toISOString().split('T')[0])
        .lte('date', endDate.toISOString().split('T')[0]);

      if (deleteError) {
        console.error('Error deleting old transactions:', deleteError);
        throw deleteError;
      }

      console.log(`🗑️ Deleted ${deletedCount || 0} existing transactions in the 30-day window`);

      // Create a map of account IDs to credit card IDs
      const accountToCardMap = new Map();
      for (const card of plaidItem.credit_cards) {
        accountToCardMap.set(card.accountId, card.id);
      }

      // Prepare fresh transactions for insertion
      const transactionsToInsert = [];
      for (const transaction of freshTransactions) {
        const creditCardId = accountToCardMap.get(transaction.account_id);
        
        // Only insert if we have a matching credit card
        if (creditCardId && (!cardId || creditCardId === cardId)) {
          transactionsToInsert.push({
            transactionId: transaction.transaction_id,
            creditCardId: creditCardId,
            accountId: transaction.account_id,
            amount: transaction.amount,
            date: transaction.date,
            authorizedDate: transaction.authorized_date,
            name: transaction.name,
            merchantName: transaction.merchant_name,
            paymentChannel: transaction.payment_channel,
            primary: transaction.personal_finance_category?.primary,
            detailed: transaction.personal_finance_category?.detailed,
            confidenceLevel: transaction.personal_finance_category?.confidence_level,
            pending: transaction.pending,
            pendingTransactionId: transaction.pending_transaction_id,
            accountOwner: transaction.account_owner,
            category: transaction.category?.join(', '),
            locationAddress: transaction.location?.address,
            locationCity: transaction.location?.city,
            locationRegion: transaction.location?.region,
            locationPostalCode: transaction.location?.postal_code,
            locationCountry: transaction.location?.country,
            locationLat: transaction.location?.lat,
            locationLon: transaction.location?.lon,
            locationStoreNumber: transaction.location?.store_number,
            isoCurrencyCode: transaction.iso_currency_code,
            unofficialCurrencyCode: transaction.unofficial_currency_code,
            logoUrl: transaction.logo_url,
            website: transaction.website
          });
        }
      }

      // Insert fresh transactions
      if (transactionsToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin
          .from('transactions')
          .insert(transactionsToInsert);

        if (insertError) {
          console.error('Error inserting fresh transactions:', insertError);
          throw insertError;
        }

        console.log(`✅ Inserted ${transactionsToInsert.length} fresh transactions`);
      }

      // Update the last sync timestamp for the Plaid item
      const { error: updateError } = await supabaseAdmin
        .from('plaid_items')
        .update({ lastSyncAt: new Date().toISOString() })
        .eq('id', plaidItem.id);

      if (updateError) {
        console.error('Error updating last sync time:', updateError);
      }

      // Now regenerate billing cycles with the fresh data
      const { calculateBillingCycles } = await import('@/utils/billingCycles');
      
      for (const creditCardId of creditCardIds) {
        console.log(`🔄 Regenerating billing cycles for card ${creditCardId}`);
        await calculateBillingCycles(creditCardId);
      }

      return NextResponse.json({ 
        success: true, 
        message: `Synced ${transactionsToInsert.length} transactions and regenerated billing cycles`,
        transactionCount: transactionsToInsert.length,
        deletedCount: deletedCount || 0
      });
    } else {
      console.log('⚠️ No transactions found in the last 30 days');
      return NextResponse.json({ 
        success: true, 
        message: 'No transactions found in the last 30 days',
        transactionCount: 0,
        deletedCount: 0
      });
    }

  } catch (error) {
    console.error('Error syncing card transactions:', error);
    return NextResponse.json({ 
      error: 'Failed to sync transactions', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}