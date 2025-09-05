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

    // User activity check: Since they're logged in and making this request, they're active
    // This API is only called when the user loads the Dashboard, so we know they're actively using the app
    console.log('🕐 User activity: Active (currently logged in and using the Dashboard)');

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

    // Check if any items need sync (haven't been synced in the past 12 hours)
    // Only sync for active users who have logged in, and only if cards need updating
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - (12 * 60 * 60 * 1000)); // 12 hours ago
    
    console.log('🕐 Sync timing check:', {
      currentTime: now.toISOString(),
      twelveHoursAgo: twelveHoursAgo.toISOString(),
      message: 'Only syncing cards that havent been updated in the past 12 hours'
    });

    const itemsNeedingSync = plaidItems.filter(item => {
      if (!item.lastSyncAt) {
        console.log(`🕐 Item ${item.institutionName}: Never synced - needs sync`);
        return true; // Never synced
      }
      
      const lastSync = new Date(item.lastSyncAt);
      const needsSync = lastSync < twelveHoursAgo; // Last sync was more than 12 hours ago
      
      if (needsSync) {
        const hoursSinceSync = Math.round((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60));
        console.log(`🕐 Item ${item.institutionName}: Last synced ${hoursSinceSync}h ago - needs sync`);
      } else {
        const hoursSinceSync = Math.round((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60));
        console.log(`🕐 Item ${item.institutionName}: Last synced ${hoursSinceSync}h ago - recent enough, skipping`);
      }
      
      return needsSync;
    });

    console.log(`🕐 Daily sync check results:`, {
      totalItems: plaidItems.length,
      itemsNeedingSync: itemsNeedingSync.length,
      itemsNeedingSyncNames: itemsNeedingSync.map(item => item.institutionName)
    });

    if (itemsNeedingSync.length === 0) {
      return NextResponse.json({
        needsSync: false,
        message: 'All items synced within the past 12 hours',
        totalItems: plaidItems.length
      });
    }

    return NextResponse.json({
      needsSync: true,
      message: `${itemsNeedingSync.length} items need sync (not updated in 12+ hours)`,
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