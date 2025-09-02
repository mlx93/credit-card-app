import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'sync-status-investigation',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Starting sync status investigation for mylesethan93@gmail.com');

    // Get user info
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', 'mylesethan93@gmail.com')
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log('👤 User found:', user.id);

    // Get user's Plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', user.id)
      .order('createdAt', { ascending: false });

    if (plaidError) {
      console.error('Error fetching Plaid items:', plaidError);
      return NextResponse.json({ error: 'Failed to fetch Plaid items' }, { status: 500 });
    }

    console.log(`🔗 Found ${(plaidItems || []).length} Plaid items`);

    // Get credit cards for each Plaid item
    const plaidItemIds = (plaidItems || []).map(item => item.id);
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .order('createdAt', { ascending: false });

    if (cardsError) {
      console.error('Error fetching credit cards:', cardsError);
      return NextResponse.json({ error: 'Failed to fetch credit cards' }, { status: 500 });
    }

    console.log(`💳 Found ${(creditCards || []).length} credit cards`);

    // Get recent transactions (last 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const creditCardIds = (creditCards || []).map(card => card.id);
    
    const { data: recentTransactions, error: transError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('creditCardId', creditCardIds)
      .gte('updatedAt', thirtyMinutesAgo)
      .order('updatedAt', { ascending: false });

    if (transError) {
      console.error('Error fetching recent transactions:', transError);
    }

    // Get recent billing cycles (last 30 minutes)
    const { data: recentBillingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .in('creditCardId', creditCardIds)
      .gte('updatedAt', thirtyMinutesAgo)
      .order('updatedAt', { ascending: false });

    if (cyclesError) {
      console.error('Error fetching recent billing cycles:', cyclesError);
    }

    // Analyze sync status for each card
    const cardAnalysis = (creditCards || []).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      const cardTransactions = (recentTransactions || []).filter(t => t.creditCardId === card.id);
      const cardCycles = (recentBillingCycles || []).filter(c => c.creditCardId === card.id);

      return {
        card: {
          id: card.id,
          name: card.name,
          mask: card.mask,
          balanceCurrent: card.balanceCurrent,
          balanceLimit: card.balanceLimit,
          lastSyncAt: card.updatedAt,
          createdAt: card.createdAt
        },
        plaidItem: plaidItem ? {
          id: plaidItem.id,
          itemId: plaidItem.itemId,
          institutionName: plaidItem.institutionName,
          status: plaidItem.status,
          lastSyncAt: plaidItem.lastSyncAt,
          errorMessage: plaidItem.errorMessage
        } : null,
        recentActivity: {
          transactionsUpdated: cardTransactions.length,
          billingCyclesUpdated: cardCycles.length,
          lastTransactionUpdate: cardTransactions[0]?.updatedAt || null,
          lastBillingCycleUpdate: cardCycles[0]?.updatedAt || null
        },
        syncStatus: {
          hasRecentActivity: cardTransactions.length > 0 || cardCycles.length > 0,
          plaidItemActive: plaidItem?.status === 'active',
          lastSyncAge: plaidItem?.lastSyncAt ? 
            Math.round((Date.now() - new Date(plaidItem.lastSyncAt).getTime()) / (1000 * 60)) : null
        }
      };
    });

    // Overall summary
    const summary = {
      totalCards: creditCards?.length || 0,
      cardsWithRecentActivity: cardAnalysis.filter(c => c.syncStatus.hasRecentActivity).length,
      activePlaidItems: cardAnalysis.filter(c => c.syncStatus.plaidItemActive).length,
      cardsNeedingAttention: cardAnalysis.filter(c => 
        !c.syncStatus.hasRecentActivity || 
        !c.syncStatus.plaidItemActive ||
        (c.syncStatus.lastSyncAge && c.syncStatus.lastSyncAge > 60)
      ).length
    };

    return NextResponse.json({
      message: 'Sync status investigation completed',
      user: {
        id: user.id,
        email: user.email
      },
      investigationPeriod: {
        startTime: thirtyMinutesAgo,
        endTime: new Date().toISOString(),
        durationMinutes: 30
      },
      summary,
      plaidItems: plaidItems || [],
      cardAnalysis,
      recentTransactions: (recentTransactions || []).length,
      recentBillingCycles: (recentBillingCycles || []).length,
      recommendations: summary.cardsNeedingAttention > 0 ? [
        `${summary.cardsNeedingAttention} cards may need attention`,
        'Check Plaid item status for inactive connections',
        'Consider running a manual sync for cards without recent activity',
        'Verify webhook processing is working correctly'
      ] : [
        'All cards appear to be syncing properly',
        'Recent activity detected across connected cards',
        'Continue monitoring for any sync issues'
      ]
    });

  } catch (error) {
    console.error('❌ Sync status investigation error:', error);
    return NextResponse.json({ error: 'Failed to investigate sync status' }, { status: 500 });
  }
}