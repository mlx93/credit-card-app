import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

function getWebhookUrl(): string {
  // Prefer explicit APP_URL for server-to-server callbacks, fall back to NEXT_PUBLIC_APP_URL
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error('Missing APP_URL or NEXT_PUBLIC_APP_URL for webhook configuration');
  // Ensure no duplicate slashes
  return `${base.replace(/\/$/, '')}/api/webhooks/plaid`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await req.json();
    if (!itemId) {
      return NextResponse.json({ error: 'Missing itemId' }, { status: 400 });
    }

    // Look up item to verify ownership
    const { data: item, error } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, userId')
      .eq('itemId', itemId)
      .single();

    if (error || !item || item.userId !== session.user.id) {
      return NextResponse.json({ error: 'Item not found or unauthorized' }, { status: 404 });
    }

    const webhook = getWebhookUrl();
    // Configure webhook on the Plaid item
    const { data: rec } = await supabaseAdmin
      .from('plaid_items')
      .select('accessToken')
      .eq('itemId', itemId)
      .single();
    if (!rec?.accessToken) throw new Error('Missing access token');
    const accessToken = decrypt(rec.accessToken);
    await plaidClient.itemWebhookUpdate({ access_token: accessToken, webhook });

    return NextResponse.json({ success: true, webhook });
  } catch (e: any) {
    console.error('Set webhook error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to set webhook' }, { status: 500 });
  }
}
