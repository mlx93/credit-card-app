import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🕐 Daily sync check for user:', session.user.id);

    // Get all user's plaid items and their last sync dates
    const { data: plaidItems, error } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, institutionName, lastSyncAt')
      .eq('userId', session.user.id)
      .eq('status', 'active');

    if (error) {
      console.error('Error fetching plaid items:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (!plaidItems || plaidItems.length === 0) {
      console.log('🕐 No plaid items found for user');
      return NextResponse.json({
        needsSync: false,
        message: 'No credit cards to sync'
      });
    }

    // Check if any items need daily sync (haven't been synced today)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    const itemsNeedingSync = plaidItems.filter(item => {
      if (!item.lastSyncAt) {
        return true; // Never synced
      }
      
      const lastSync = new Date(item.lastSyncAt);
      lastSync.setHours(0, 0, 0, 0); // Start of last sync day
      
      return lastSync < today; // Last sync was before today
    });

    console.log(`🕐 Daily sync check results:`, {
      totalItems: plaidItems.length,
      itemsNeedingSync: itemsNeedingSync.length,
      itemsNeedingSyncNames: itemsNeedingSync.map(item => item.institutionName)
    });

    if (itemsNeedingSync.length === 0) {
      return NextResponse.json({
        needsSync: false,
        message: 'All items synced today',
        totalItems: plaidItems.length
      });
    }

    return NextResponse.json({
      needsSync: true,
      message: `${itemsNeedingSync.length} items need daily sync`,
      itemsToSync: itemsNeedingSync.map(item => ({
        itemId: item.itemId,
        institutionName: item.institutionName,
        lastSyncAt: item.lastSyncAt
      })),
      totalItems: plaidItems.length,
      itemsNeedingSyncCount: itemsNeedingSync.length
    });

  } catch (error: any) {
    console.error('❌ Daily sync check error:', error);
    return NextResponse.json({
      error: 'Daily sync check failed',
      details: error.message
    }, { status: 500 });
  }
}