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

    const { data, error } = await supabaseAdmin.rpc('get_card_order', { p_user_id: session.user.id });
    if (error) {
      console.warn('get_card_order RPC failed:', error.message);
      return NextResponse.json({ order: [] });
    }
    return NextResponse.json({ order: Array.isArray(data) ? data : [] });
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

    const { data, error } = await supabaseAdmin.rpc('set_card_order', { p_user_id: session.user.id, p_order: order });
    if (error || data !== true) {
      console.warn('set_card_order RPC failed:', error?.message);
      return NextResponse.json({ success: false }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
