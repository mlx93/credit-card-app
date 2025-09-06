import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try RPC first
    const { data, error } = await supabaseAdmin.rpc('get_card_order', { p_user_id: session.user.id });
    if (!error && Array.isArray(data)) {
      return NextResponse.json({ order: data });
    }
    // Fallback to direct table read
    const { data: row, error: tblErr } = await supabaseAdmin
      .from('user_card_orders')
      .select('order_ids')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (tblErr) {
      console.warn('get_card_order fallback failed:', tblErr.message);
      return NextResponse.json({ error: 'Failed to load order' }, { status: 500 });
    }
    return NextResponse.json({ order: Array.isArray(row?.order_ids) ? row!.order_ids : [] });
  } catch (error) {
    return NextResponse.json({ order: [] });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { order } = await request.json();
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: 'Invalid order payload' }, { status: 400 });
    }

    // Try RPC first
    const { data, error } = await supabaseAdmin.rpc('set_card_order', { p_user_id: session.user.id, p_order: order });
    if (!error && data === true) {
      return NextResponse.json({ success: true });
    }
    console.warn('set_card_order RPC failed:', error?.message);
    // Fallback to direct upsert into table
    const { error: upsertErr } = await supabaseAdmin
      .from('user_card_orders')
      .upsert({ user_id: session.user.id, order_ids: order, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (upsertErr) {
      console.error('Fallback upsert failed:', upsertErr.message);
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, method: 'fallback' });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as any)?.message || 'Unknown error' }, { status: 500 });
  }
}
