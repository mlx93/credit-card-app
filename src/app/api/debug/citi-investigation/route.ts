import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find Citi cards and their Plaid items
    const { data: citiCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*, plaidItem:plaid_items(*)')
      .eq('userId', session.user.id)
      .or('name.ilike.%citi%,plaidItem.institutionName.ilike.%citi%');

    if (cardsError) {
      return NextResponse.json({ error: cardsError.message }, { status: 500 });
    }

    const results = [];

    for (const card of citiCards || []) {
      if (!card.plaidItem) continue;
      
      const itemId = card.plaidItem.itemId;
      const accessToken = decrypt(card.plaidItem.accessToken);
      
      const cardInfo = {
        cardName: card.name,
        cardId: card.id,
        itemId: itemId,
        institutionName: card.plaidItem.institutionName,
        lastSyncAt: card.plaidItem.lastSyncAt,
        createdAt: card.plaidItem.createdAt,
        checks: {}
      };

      try {
        // 1. Check item status
        const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
        cardInfo.checks.itemStatus = {
          status: itemResponse.data.status,
          webhook: itemResponse.data.item.webhook,
          availableProducts: itemResponse.data.item.available_products,
          billedProducts: itemResponse.data.item.billed_products,
          consentExpirationTime: itemResponse.data.item.consent_expiration_time,
          error: itemResponse.data.item.error
        };

        // 2. Try to get accounts
        try {
          const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
          cardInfo.checks.accounts = {
            count: accountsResponse.data.accounts.length,
            accounts: accountsResponse.data.accounts.map(acc => ({
              id: acc.account_id,
              name: acc.name,
              type: acc.type,
              subtype: acc.subtype,
              mask: acc.mask
            }))
          };
        } catch (accError: any) {
          cardInfo.checks.accounts = {
            error: accError?.response?.data || accError.message
          };
        }

        // 3. Try to get recent transactions (last 7 days)
        try {
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);

          const transactionsResponse = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0]
          });

          cardInfo.checks.recentTransactions = {
            count: transactionsResponse.data.transactions.length,
            totalTransactions: transactionsResponse.data.total_transactions,
            oldestTransaction: transactionsResponse.data.transactions[transactionsResponse.data.transactions.length - 1]?.date,
            newestTransaction: transactionsResponse.data.transactions[0]?.date
          };
        } catch (txnError: any) {
          cardInfo.checks.recentTransactions = {
            error: txnError?.response?.data || txnError.message,
            errorType: txnError?.response?.data?.error_type,
            errorCode: txnError?.response?.data?.error_code,
            errorMessage: txnError?.response?.data?.error_message
          };
        }

        // 4. Try transactions sync endpoint (newer API)
        try {
          const syncResponse = await plaidClient.transactionsSync({
            access_token: accessToken,
            count: 10
          });

          cardInfo.checks.transactionsSync = {
            hasMore: syncResponse.data.has_more,
            added: syncResponse.data.added.length,
            modified: syncResponse.data.modified.length,
            removed: syncResponse.data.removed.length,
            nextCursor: syncResponse.data.next_cursor ? 'Has cursor' : 'No cursor'
          };
        } catch (syncError: any) {
          cardInfo.checks.transactionsSync = {
            error: syncError?.response?.data || syncError.message
          };
        }

        // 5. Check for webhooks received
        const { data: webhooks } = await supabaseAdmin
          .from('plaid_webhooks')
          .select('*')
          .eq('item_id', itemId)
          .order('created_at', { ascending: false })
          .limit(10);

        cardInfo.checks.recentWebhooks = webhooks?.map(w => ({
          type: w.webhook_type,
          code: w.webhook_code,
          receivedAt: w.created_at,
          error: w.error
        })) || [];

        // 6. Attempt to manually trigger webhook if needed
        if (cardInfo.checks.recentTransactions?.error?.error_code === 'PRODUCT_NOT_READY') {
          try {
            // Fire a sandbox webhook to test (only works in sandbox)
            if (process.env.PLAID_ENV === 'sandbox') {
              await plaidClient.sandboxItemFireWebhook({
                access_token: accessToken,
                webhook_code: 'INITIAL_UPDATE'
              });
              cardInfo.checks.webhookFired = 'Sandbox webhook fired for INITIAL_UPDATE';
            } else {
              cardInfo.checks.webhookFired = 'Cannot fire webhook in production - waiting for Plaid';
            }
          } catch (whError: any) {
            cardInfo.checks.webhookFired = {
              error: whError?.response?.data || whError.message
            };
          }
        }

      } catch (error: any) {
        cardInfo.checks.generalError = error?.response?.data || error.message;
      }

      results.push(cardInfo);
    }

    // Summary and recommendations
    const summary = {
      citiCardsFound: results.length,
      results,
      recommendations: []
    };

    for (const result of results) {
      if (result.checks.recentTransactions?.error?.error_code === 'PRODUCT_NOT_READY') {
        summary.recommendations.push({
          card: result.cardName,
          issue: 'Transactions not ready',
          action: 'Wait for Plaid webhook or try reconnecting the account'
        });
      }
      
      if (!result.checks.itemStatus?.webhook) {
        summary.recommendations.push({
          card: result.cardName,
          issue: 'No webhook configured',
          action: 'Set webhook URL for this item'
        });
      }

      const hoursSinceCreation = (Date.now() - new Date(result.createdAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceCreation > 24 && result.checks.recentWebhooks?.length === 0) {
        summary.recommendations.push({
          card: result.cardName,
          issue: 'No webhooks received in 24+ hours',
          action: 'Check webhook configuration and Plaid dashboard'
        });
      }
    }

    return NextResponse.json(summary, { status: 200 });

  } catch (error: any) {
    console.error('Citi investigation error:', error);
    return NextResponse.json({ 
      error: error?.message || 'Investigation failed',
      details: error?.response?.data
    }, { status: 500 });
  }
}