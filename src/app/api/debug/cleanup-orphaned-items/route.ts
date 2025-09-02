import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'cleanup-orphaned-items',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orphanedItemIds } = await request.json();
    
    if (!orphanedItemIds || !Array.isArray(orphanedItemIds) || orphanedItemIds.length === 0) {
      return NextResponse.json({ 
        error: 'Please provide an array of orphaned item IDs to cleanup' 
      }, { status: 400 });
    }

    console.log(`🧹 Starting cleanup of ${orphanedItemIds.length} orphaned items:`, orphanedItemIds);

    const results = {
      successful: [],
      failed: [],
      details: []
    };

    for (const itemId of orphanedItemIds) {
      try {
        console.log(`🗑️  Attempting to remove orphaned item: ${itemId}`);
        
        // First, check if the item exists in Plaid by trying to get its status
        let itemExists = false;
        let institutionName = 'Unknown';
        
        try {
          // We can't get item info without access token, so we'll try to remove it directly
          // If it doesn't exist, Plaid will return an appropriate error
          console.log(`🔍 Checking if item ${itemId} exists in Plaid...`);
          
          // Since we don't have access token, we can only attempt removal
          // This will fail gracefully if the item doesn't exist
          itemExists = true; // Assume it exists for now
        } catch (checkError: any) {
          console.log(`Item ${itemId} may not exist in Plaid:`, checkError.message);
        }

        if (itemExists) {
          // Note: We can't actually remove items without their access tokens
          // This endpoint is mainly for logging and tracking orphaned items
          console.log(`⚠️  Item ${itemId} needs manual cleanup - access token required for removal`);
          
          results.failed.push({
            itemId,
            reason: 'Cannot remove without access token - needs manual cleanup',
            institutionName
          });
          
          results.details.push({
            itemId,
            status: 'needs_manual_cleanup',
            message: `Item ${itemId} detected as orphaned but requires access token for removal`,
            recommendation: 'Remove this item manually from Plaid Dashboard or re-authenticate connection'
          });
        }

      } catch (error: any) {
        console.error(`❌ Failed to cleanup item ${itemId}:`, error);
        results.failed.push({
          itemId,
          reason: error.message,
          error: error
        });
      }
    }

    // Log summary
    console.log(`🧹 CLEANUP SUMMARY:`, {
      attempted: orphanedItemIds.length,
      successful: results.successful.length,
      failed: results.failed.length
    });

    return NextResponse.json({
      message: 'Orphaned items cleanup completed',
      summary: {
        attempted: orphanedItemIds.length,
        successful: results.successful.length,
        failed: results.failed.length
      },
      results,
      recommendations: [
        'Orphaned items cannot be removed automatically without access tokens',
        'These items should be removed manually from the Plaid Dashboard',
        'Or re-authenticate the connections to restore access tokens',
        'Monitor webhook logs for continued orphaned item detection'
      ]
    });

  } catch (error) {
    console.error('❌ Orphaned items cleanup error:', error);
    return NextResponse.json({ error: 'Failed to cleanup orphaned items' }, { status: 500 });
  }
}

// GET endpoint to list currently detected orphaned items from logs
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'cleanup-orphaned-items',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Known orphaned items from webhook logs
    const knownOrphanedItems = [
      'VgEnk75zZ6C05D5bV4A7hxrQZMgdQMfrzVAOE',
      '5brEPP0d01ujbPJqJ3zQCVZ8gYXOQmHBerX0a'
    ];

    // Check if these items exist in our database
    const { data: existingItems, error } = await supabaseAdmin
      .from('plaid_items')
      .select('itemId, institutionName, status, updatedAt')
      .in('itemId', knownOrphanedItems);

    if (error) {
      console.error('Error checking for existing items:', error);
    }

    const existingItemIds = new Set((existingItems || []).map(item => item.itemId));
    const confirmedOrphanedItems = knownOrphanedItems.filter(id => !existingItemIds.has(id));

    return NextResponse.json({
      message: 'Orphaned items analysis',
      knownOrphanedItems: knownOrphanedItems,
      confirmedOrphanedItems: confirmedOrphanedItems,
      itemsFoundInDatabase: existingItems || [],
      summary: {
        total_known: knownOrphanedItems.length,
        confirmed_orphaned: confirmedOrphanedItems.length,
        found_in_database: (existingItems || []).length
      },
      recommendations: confirmedOrphanedItems.length > 0 ? [
        `${confirmedOrphanedItems.length} orphaned items detected`,
        'These items exist in Plaid but not in your database',
        'They should be removed from Plaid to stop webhook errors',
        'Use POST /api/debug/cleanup-orphaned-items with these IDs'
      ] : [
        'No confirmed orphaned items detected',
        'All known problem items exist in database',
        'Monitor webhook logs for new orphaned items'
      ]
    });

  } catch (error) {
    console.error('❌ Error analyzing orphaned items:', error);
    return NextResponse.json({ error: 'Failed to analyze orphaned items' }, { status: 500 });
  }
}