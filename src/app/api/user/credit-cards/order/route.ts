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

    // Direct table read (no RPC dependency)
    const { data: row, error: tblErr } = await supabaseAdmin
      .from('user_card_orders')
      .select('order_ids')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (tblErr) {
      console.warn('get_card_order table read failed:', tblErr.message);
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

    // Ensure user exists in public.users table first
    await supabaseAdmin
      .from('users')
      .upsert({ 
        id: session.user.id, 
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    // Direct upsert (user should exist now due to trigger)
    const { error: upsertErr } = await supabaseAdmin
      .from('user_card_orders')
      .upsert({ user_id: session.user.id, order_ids: order, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (upsertErr) {
      console.error('Direct upsert failed:', upsertErr.message);
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PUT /api/user/credit-cards/order error:', error);
    return NextResponse.json({ success: false, error: (error as any)?.message || 'Unknown error' }, { status: 500 });
  }
}
