import { NextRequest, NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// In-memory store for tracking recent webhook processing
// This prevents duplicate processing when multiple webhooks arrive simultaneously
const recentWebhooks = new Map<string, number>();
const WEBHOOK_DEDUP_WINDOW = 10000; // 10 seconds

async function verifyPlaidWebhook(body: string, jwtToken: string): Promise<boolean> {
  try {
    console.log('🔐 Starting webhook verification...');
    console.log('🔐 JWT Token present:', !!jwtToken);
    console.log('🔐 Body length:', body.length);
    console.log('🔐 Plaid environment:', process.env.PLAID_ENV);
    console.log('🔐 Plaid client ID present:', !!process.env.PLAID_CLIENT_ID);
    console.log('🔐 Plaid secret present:', !!process.env.PLAID_SECRET);

    // Get the verification key from Plaid
    console.log('🔐 Requesting webhook verification key from Plaid...');
    try {
      const response = await plaidClient.webhookVerificationKeyGet({});
      console.log('🔐 Webhook verification key response status:', response.status);
      console.log('🔐 Webhook verification key response data keys:', Object.keys(response.data));
      
      const { key } = response.data;
      console.log('🔐 Verification key object keys:', Object.keys(key));
      console.log('🔐 x5c array length:', key.x5c?.length);

      // Create public key from the JWK
      const publicKey = `-----BEGIN PUBLIC KEY-----\n${key.x5c[0]}\n-----END PUBLIC KEY-----`;
      console.log('🔐 Public key created, length:', publicKey.length);
      
      // Verify the JWT
      console.log('🔐 Attempting to verify JWT...');
      const decoded = jwt.verify(jwtToken, publicKey, { algorithms: ['ES256'] }) as any;
      console.log('🔐 JWT decoded successfully:', Object.keys(decoded));
      
      // Check webhook age (should not be older than 5 minutes)
      const now = Math.floor(Date.now() / 1000);
      const age = now - decoded.iat;
      console.log('🔐 Webhook age in seconds:', age);
      
      if (age > 300) {
        console.error('❌ Webhook is too old (older than 5 minutes)');
        return false;
      }
      
      // Verify body hash
      const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
      console.log('🔐 Body hash calculated:', bodyHash);
      console.log('🔐 Expected hash from JWT:', decoded.request_body_sha256);
      
      if (decoded.request_body_sha256 !== bodyHash) {
        console.error('❌ Webhook body hash mismatch');
        return false;
      }
      
      console.log('✅ Webhook verification successful');
      return true;
    } catch (apiError: any) {
      console.error('❌ Plaid webhook verification key API error:', {
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data,
        headers: apiError.response?.headers,
        config: {
          url: apiError.config?.url,
          method: apiError.config?.method,
          headers: apiError.config?.headers
        }
      });
      throw apiError;
    }
  } catch (error) {
    console.error('❌ Webhook verification failed:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🌐 Webhook POST endpoint called at:', new Date().toISOString());
    console.log('🌐 Request headers:', Object.fromEntries(request.headers.entries()));
    
    // Get raw body for JWT verification
    const rawBody = await request.text();
    const jwtToken = request.headers.get('plaid-verification') || '';
    
    console.log('🌐 Raw body received, length:', rawBody.length);
    console.log('🌐 JWT token from header:', jwtToken ? 'Present' : 'Missing');
    
    // Verify webhook JWT for security
    console.log('🌐 About to call verifyPlaidWebhook...');
    const verificationResult = await verifyPlaidWebhook(rawBody, jwtToken);
    console.log('🌐 Verification result:', verificationResult);
    
    if (!verificationResult) {
      console.error('🚫 Invalid webhook JWT - potential security threat');
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