import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';
import crypto from 'crypto';

// In-memory store for tracking recent webhook processing
// This prevents duplicate processing when multiple webhooks arrive simultaneously
const recentWebhooks = new Map<string, number>();
const WEBHOOK_DEDUP_WINDOW = 10000; // 10 seconds

function verifyPlaidWebhook(body: string, signature: string): boolean {
  const webhookSecret = process.env.PLAID_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('PLAID_WEBHOOK_SECRET not configured');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('plaid-verification') || '';
    
    // Verify webhook signature for security
    if (!verifyPlaidWebhook(rawBody, signature)) {
      console.error('🚫 Invalid webhook signature - potential security threat');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = JSON.parse(rawBody);
    const { webhook_type, webhook_code, item_id, error } = body;

    console.log('✅ Verified Plaid webhook received:', { webhook_type, webhook_code, item_id });

    if (error) {
      console.error('Plaid webhook error:', error);
      return NextResponse.json({ error: 'Webhook error' }, { status: 400 });
    }

    // Create a unique key for this webhook
    const webhookKey = `${webhook_type}-${webhook_code}-${item_id}`;
    const now = Date.now();
    
    // Check if we've processed this webhook recently
    const lastProcessed = recentWebhooks.get(webhookKey);
    if (lastProcessed && (now - lastProcessed) < WEBHOOK_DEDUP_WINDOW) {
      console.log(`⚠️ Duplicate webhook detected (${webhookKey}), skipping processing. Last processed ${now - lastProcessed}ms ago.`);
      return NextResponse.json({ received: true, deduplicated: true });
    }
    
    // Mark this webhook as processed
    recentWebhooks.set(webhookKey, now);
    
    // Clean up old entries
    for (const [key, timestamp] of recentWebhooks.entries()) {
      if (now - timestamp > WEBHOOK_DEDUP_WINDOW * 2) {
        recentWebhooks.delete(key);
      }
    }

    switch (webhook_type) {
      case 'TRANSACTIONS':
        await handleTransactionWebhook(webhook_code, item_id);
        break;
      case 'LIABILITIES':
        await handleLiabilitiesWebhook(webhook_code, item_id);
        break;
      case 'ITEM':
        await handleItemWebhook(webhook_code, item_id);
        break;
      default:
        console.log(`Unhandled webhook type: ${webhook_type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleTransactionWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE':
    case 'DEFAULT_UPDATE':
      console.log(`Processing transaction update for item: ${itemId}`);
      
      // Get the plaid item and access token from database
      const { data: plaidItem, error } = await supabaseAdmin
        .from('plaid_items')
        .select('*')
        .eq('itemId', itemId)
        .single();
      
      if (error || !plaidItem) {
        console.error(`No Plaid item found for itemId: ${itemId}`, error);
        return;
      }

      // Decrypt the access token before using it
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      await plaidService.syncTransactions(plaidItem, decryptedAccessToken);
      break;
    case 'TRANSACTIONS_REMOVED':
      console.log(`Transactions removed for item: ${itemId}`);
      break;
    default:
      console.log(`Unhandled transaction webhook code: ${webhookCode}`);
  }
}

async function handleLiabilitiesWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'DEFAULT_UPDATE':
      console.log(`Processing liabilities update for item: ${itemId}`);
      const { data: plaidItem, error } = await supabaseAdmin
        .from('plaid_items')
        .select('*')
        .eq('itemId', itemId)
        .single();
      
      if (error) {
        console.error('Error fetching plaid item:', error);
        return;
      }

      if (plaidItem) {
        // Decrypt the access token before using it
        const decryptedAccessToken = decrypt(plaidItem.accessToken);
        await plaidService.syncAccounts(decryptedAccessToken, itemId);
      }
      break;
    default:
      console.log(`Unhandled liabilities webhook code: ${webhookCode}`);
  }
}

async function handleItemWebhook(webhookCode: string, itemId: string) {
  switch (webhookCode) {
    case 'ERROR':
      console.log(`Item error for: ${itemId}`);
      const { error: updateError } = await supabaseAdmin
        .from('plaid_items')
        .update({ updatedAt: new Date().toISOString() })
        .eq('itemId', itemId);
      
      if (updateError) {
        console.error('Error updating plaid item:', updateError);
      }
      break;
    case 'PENDING_EXPIRATION':
      console.log(`Item pending expiration: ${itemId}`);
      break;
    case 'USER_PERMISSION_REVOKED':
      console.log(`User permission revoked for item: ${itemId}`);
      const { error: deleteError } = await supabaseAdmin
        .from('plaid_items')
        .delete()
        .eq('itemId', itemId);
      
      if (deleteError) {
        console.error('Error deleting plaid item:', deleteError);
      }
      break;
    default:
      console.log(`Unhandled item webhook code: ${webhookCode}`);
  }
}