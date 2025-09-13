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

    console.log('GET card order for user:', session.user.id);

    // Direct table read (no RPC dependency)
    const { data: row, error: tblErr } = await supabaseAdmin
      .from('user_card_orders')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();
      
    if (tblErr) {
      console.warn('get_card_order table read failed:', tblErr.message);
      return NextResponse.json({ error: 'Failed to load order' }, { status: 500 });
    }
    
    console.log('Retrieved card order from database:', row);
    
    return NextResponse.json({ order: Array.isArray(row?.order_ids) ? row.order_ids : [] });
  } catch (error) {
    console.error('GET card order error:', error);
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
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .upsert({ 
        id: session.user.id, 
        email: session.user.email || '',
        updatedAt: new Date().toISOString()
      }, { onConflict: 'id' })
      .select();

    if (userError) {
      console.error('User upsert failed:', userError);
      return NextResponse.json({ success: false, error: userError.message }, { status: 500 });
    }

    console.log('User upsert result:', userData);

    // Brief pause to ensure user record is committed before foreign key reference
    await new Promise(resolve => setTimeout(resolve, 50));

    // Direct upsert (user should exist now)
    const { data: orderData, error: upsertErr } = await supabaseAdmin
      .from('user_card_orders')
      .upsert({ 
        user_id: session.user.id, 
        order_ids: order, 
        updated_at: new Date().toISOString() 
      }, { 
        onConflict: 'user_id' 
      })
      .select();
      
    if (upsertErr) {
      console.error('Direct upsert failed:', upsertErr.message);
      return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 });
    }

    console.log('Card order upsert result:', orderData);
    console.log('Card order saved for user:', session.user.id, 'with order:', order);
    
    // Verify the data was actually saved
    const { data: verifyData, error: verifyError } = await supabaseAdmin
      .from('user_card_orders')
      .select('*')
      .eq('user_id', session.user.id)
      .single();
    
    if (verifyError) {
      console.error('Verification query failed:', verifyError);
    } else {
      console.log('Verification - saved order:', verifyData);
    }
    
    return NextResponse.json({ success: true, savedOrder: verifyData?.order_ids });
  } catch (error) {
    console.error('PUT /api/user/credit-cards/order error:', error);
    return NextResponse.json({ success: false, error: (error as any)?.message || 'Unknown error' }, { status: 500 });
  }
}
