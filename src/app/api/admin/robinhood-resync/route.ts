import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'robinhood-resync',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Robinhood plaid item
    const { data: plaidItem } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id)
      .or('institutionId.eq.ins_54,institutionName.ilike.%robinhood%')
      .single();

    if (!plaidItem) {
      return NextResponse.json({ error: 'No Robinhood connection found' }, { status: 404 });
    }

    const accessToken = decrypt(plaidItem.accessToken);
    
    console.log('🔄 Starting Robinhood full re-sync...');
    console.log(`Institution: ${plaidItem.institutionName} (${plaidItem.institutionId})`);
    
    // Force a full transaction sync (12 months)
    const result = await plaidService.syncTransactions(
      plaidItem,
      accessToken
    );

    // Get transaction count after sync
    const { data: creditCards } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name')
      .eq('plaidItemId', plaidItem.id);

    const transactionCounts = [];
    for (const card of creditCards || []) {
      const { count } = await supabaseAdmin
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('creditCardId', card.id);

      // Get date range of transactions
      const { data: dateRange } = await supabaseAdmin
        .from('transactions')
        .select('date')
        .eq('creditCardId', card.id)
        .order('date', { ascending: true })
        .limit(1);

      const { data: latestDate } = await supabaseAdmin
        .from('transactions')
        .select('date')
        .eq('creditCardId', card.id)
        .order('date', { ascending: false })
        .limit(1);

      transactionCounts.push({
        cardName: card.name,
        transactionCount: count || 0,
        earliestTransaction: dateRange?.[0]?.date || null,
        latestTransaction: latestDate?.[0]?.date || null,
        daysCovered: dateRange?.[0]?.date && latestDate?.[0]?.date ? 
          Math.ceil((new Date(latestDate[0].date).getTime() - new Date(dateRange[0].date).getTime()) / (1000 * 60 * 60 * 24)) : 0
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Robinhood re-sync completed',
      institution: {
        name: plaidItem.institutionName,
        id: plaidItem.institutionId
      },
      syncResult: result,
      transactionData: transactionCounts,
      analysis: {
        totalTransactions: transactionCounts.reduce((sum, c) => sum + c.transactionCount, 0),
        averageDaysCovered: transactionCounts.length > 0 ? 
          Math.round(transactionCounts.reduce((sum, c) => sum + c.daysCovered, 0) / transactionCounts.length) : 0,
        recommendation: transactionCounts.some(c => c.daysCovered < 365) ?
          '⚠️ Limited transaction history available. This may be a Robinhood API limitation.' :
          '✅ Full year of transaction history available.'
      }
    });

  } catch (error) {
    console.error('Error in Robinhood re-sync:', error);
    return NextResponse.json({ 
      error: 'Failed to re-sync Robinhood',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}