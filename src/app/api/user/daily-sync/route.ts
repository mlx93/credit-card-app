import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    console.log('🌅 DAILY SYNC - First login of the day sync initiated');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get items that need daily sync
    const { data: plaidItems, error } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id)
      .eq('status', 'active');

    if (error || !plaidItems || plaidItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No items to sync',
        itemsSynced: 0
      });
    }

    // Filter items that haven't been synced today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const itemsNeedingSync = plaidItems.filter(item => {
      if (!item.lastSyncAt) return true;
      
      const lastSync = new Date(item.lastSyncAt);
      lastSync.setHours(0, 0, 0, 0);
      
      return lastSync < today;
    });

    console.log(`🌅 Daily sync: ${itemsNeedingSync.length}/${plaidItems.length} items need sync`);

    if (itemsNeedingSync.length === 0) {
      // Telemetry: no-op run
      try { await supabaseAdmin.from('user_sync_telemetry').insert({
        user_id: session.user.id,
        event: 'daily_sync_run',
        details: { itemsProcessed: 0 }
      }); } catch {}
      return NextResponse.json({
        success: true,
        message: 'All items already synced today',
        itemsSynced: 0,
        totalItems: plaidItems.length
      });
    }

    let successCount = 0;
    const results = [];

    // Sync each item that needs daily update
    for (const item of itemsNeedingSync) {
      try {
        console.log(`🌅 Daily syncing: ${item.institutionName} (${item.itemId})`);
        
        const accessToken = decrypt(item.accessToken);
        
        // Use comprehensive sync with 12-hour protection
        // This will skip if already synced recently (within 12 hours)
        const response = await fetch(`${process.env.NEXTAUTH_URL}/api/plaid/comprehensive-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.itemId })
        });
        
        if (response.ok) {
          const syncResult = await response.json();
          console.log(`✅ Daily sync completed for ${item.institutionName}:`, syncResult.message);
          successCount++;
          
          results.push({
            itemId: item.itemId,
            institutionName: item.institutionName,
            success: true,
            message: syncResult.message
          });
        } else {
          const errorResult = await response.json();
          console.warn(`⚠️ Daily sync failed for ${item.institutionName}:`, errorResult.error);
          
          results.push({
            itemId: item.itemId,
            institutionName: item.institutionName,
            success: false,
            error: errorResult.error
          });
        }
        
        // Add delay between items to respect rate limits
        if (itemsNeedingSync.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (syncError) {
        console.error(`❌ Daily sync error for ${item.institutionName}:`, syncError);
        
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          success: false,
          error: syncError.message
        });
      }
    }

    console.log(`🌅 Daily sync completed: ${successCount}/${itemsNeedingSync.length} items synced successfully`);

    // Telemetry: run summary
    try { await supabaseAdmin.from('user_sync_telemetry').insert({
      user_id: session.user.id,
      event: 'daily_sync_run',
      details: { totalItems: plaidItems.length, itemsProcessed: itemsNeedingSync.length, itemsSynced: successCount }
    }); } catch {}

    return NextResponse.json({
      success: true,
      message: `Daily sync completed`,
      itemsSynced: successCount,
      totalItems: plaidItems.length,
      itemsProcessed: itemsNeedingSync.length,
      results
    });

  } catch (error: any) {
    console.error('❌ Daily sync error:', error);
    return NextResponse.json({
      error: 'Daily sync failed',
      details: error.message
    }, { status: 500 });
  }
}
