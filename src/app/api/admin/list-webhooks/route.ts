import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/adminSecurity';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

export async function GET(request: NextRequest) {
  // Admin-only, require debug key in production
  const sec = await requireAdminAccess(request, { endpointName: 'admin-list-webhooks', requireDebugKey: true });
  if (sec) return sec;

  try {
    const url = new URL(request.url);
    const itemIdFilter = url.searchParams.get('itemId');
    const userIdFilter = url.searchParams.get('userId');

    // Pull all plaid items (optionally filtered)
    let query = supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, userId, accessToken, institutionId, institutionName, lastSyncAt');

    if (itemIdFilter) query = query.eq('itemId', itemIdFilter);
    if (userIdFilter) query = query.eq('userId', userIdFilter);

    const { data: items, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: any[] = [];
    for (const it of items || []) {
      try {
        const token = decrypt(it.accessToken);
        const info = await plaidClient.itemGet({ access_token: token });
        const item = info.data.item;
        results.push({
          itemId: it.itemId,
          institutionId: item.institution_id,
          products: item.products,
          billedProducts: item.billed_products,
          availableProducts: item.available_products,
          consentedProducts: item.consented_products,
          webhook: item.webhook || null,
          lastSyncAt: it.lastSyncAt || null,
          institutionName: it.institutionName || null,
        });
      } catch (e: any) {
        results.push({
          itemId: it.itemId,
          institutionName: it.institutionName || null,
          error: e?.response?.data || e?.message || 'Failed to query item',
        });
      }
    }

    const summary = {
      total: results.length,
      withWebhook: results.filter(r => r.webhook).length,
      withoutWebhook: results.filter(r => !r.webhook && !r.error).length,
      errors: results.filter(r => r.error).length,
    };

    return NextResponse.json({ success: true, summary, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list webhooks' }, { status: 500 });
  }
}

