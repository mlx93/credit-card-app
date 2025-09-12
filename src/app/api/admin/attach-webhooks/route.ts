import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/adminSecurity';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

function getWebhookUrl(): string {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error('Missing APP_URL or NEXT_PUBLIC_APP_URL');
  return `${base.replace(/\/$/, '')}/api/webhooks/plaid`;
}

export async function POST(request: NextRequest) {
  // Admin-only safeguard
  const sec = await requireAdminAccess(request, { endpointName: 'admin-attach-webhooks', requireDebugKey: true });
  if (sec) return sec;

  try {
    const webhook = getWebhookUrl();

    // Optional scope: all items or only those missing a webhook
    const url = new URL(request.url);
    const onlyMissing = url.searchParams.get('onlyMissing') === '1';

    // Fetch items; keep result list tidy to avoid reading secrets too broadly
    const { data: items, error } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, userId, accessToken, institutionName, lastSyncAt');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: any[] = [];
    for (const item of items || []) {
      try {
        // Optionally skip items that already have a webhook configured
        if (onlyMissing) {
          try {
            const token = decrypt(item.accessToken);
            const info = await plaidClient.itemGet({ access_token: token });
            if (info.data.item.webhook) {
              results.push({ itemId: item.itemId, status: 'skipped_existing', webhook: info.data.item.webhook });
              continue;
            }
          } catch (e) {
            // If we cannot read item info, proceed to set webhook anyway
          }
        }

        const token = decrypt(item.accessToken);
        await plaidClient.itemWebhookUpdate({ access_token: token, webhook });
        results.push({ itemId: item.itemId, status: 'updated', webhook });
      } catch (e: any) {
        results.push({ itemId: item.itemId, status: 'error', error: e?.response?.data || e?.message });
      }
    }

    const summary = {
      total: results.length,
      updated: results.filter(r => r.status === 'updated').length,
      skipped: results.filter(r => r.status === 'skipped_existing').length,
      errors: results.filter(r => r.status === 'error').length,
    };

    return NextResponse.json({ success: true, webhook, summary, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to attach webhooks' }, { status: 500 });
  }
}

