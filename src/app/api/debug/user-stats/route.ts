import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    console.log('📊 USER STATS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get comprehensive user statistics
    const [
      totalUsersResult,
      usersWithPlaidItemsResult,
      totalPlaidItemsResult,
      totalCreditCardsResult,
      totalTransactionsResult,
      totalBillingCyclesResult,
      recentUsersResult
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('users').select('*, plaid_items!inner(id)', { count: 'exact', head: true }),
      supabaseAdmin.from('plaid_items').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('credit_cards').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('transactions').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('billing_cycles').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          name,
          created_at,
          plaid_items(id)
        `)
        .order('created_at', { ascending: false })
        .limit(10)
    ]);
    
    // Extract counts from results
    const totalUsers = totalUsersResult.count || 0;
    const usersWithPlaidItems = usersWithPlaidItemsResult.count || 0;
    const totalPlaidItems = totalPlaidItemsResult.count || 0;
    const totalCreditCards = totalCreditCardsResult.count || 0;
    const totalTransactions = totalTransactionsResult.count || 0;
    const totalBillingCycles = totalBillingCyclesResult.count || 0;
    const recentUsers = recentUsersResult.data || [];
    
    // Handle any errors
    if (totalUsersResult.error) console.error('Error counting users:', totalUsersResult.error);
    if (usersWithPlaidItemsResult.error) console.error('Error counting users with plaid items:', usersWithPlaidItemsResult.error);
    if (totalPlaidItemsResult.error) console.error('Error counting plaid items:', totalPlaidItemsResult.error);
    if (totalCreditCardsResult.error) console.error('Error counting credit cards:', totalCreditCardsResult.error);
    if (totalTransactionsResult.error) console.error('Error counting transactions:', totalTransactionsResult.error);
    if (totalBillingCyclesResult.error) console.error('Error counting billing cycles:', totalBillingCyclesResult.error);
    if (recentUsersResult.error) console.error('Error fetching recent users:', recentUsersResult.error);

    // Get active vs inactive items
    const [activeItemsResult, errorItemsResult] = await Promise.all([
      supabaseAdmin.from('plaid_items').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('plaid_items').select('*', { count: 'exact', head: true }).neq('status', 'active')
    ]);
    
    const activeItems = activeItemsResult.count || 0;
    const errorItems = errorItemsResult.count || 0;

    const stats = {
      users: {
        total: totalUsers,
        withConnections: usersWithPlaidItems,
        withoutConnections: totalUsers - usersWithPlaidItems
      },
      connections: {
        totalPlaidItems,
        active: activeItems,
        withErrors: errorItems
      },
      data: {
        creditCards: totalCreditCards,
        transactions: totalTransactions,
        billingCycles: totalBillingCycles,
        avgTransactionsPerCard: totalCreditCards > 0 ? Math.round(totalTransactions / totalCreditCards) : 0,
        avgCyclesPerCard: totalCreditCards > 0 ? Math.round(totalBillingCycles / totalCreditCards) : 0
      },
      recent: recentUsers.map(user => ({
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        plaidItems: user.plaid_items?.length || 0,
        isCurrentUser: user.id === session.user.id
      }))
    };

    console.log('📊 USER STATS:', stats);
    
    return NextResponse.json({ 
      message: 'User statistics retrieved',
      stats
    });
  } catch (error) {
    console.error('📊 USER STATS ERROR:', error);
    return NextResponse.json({ error: 'Failed to get user statistics' }, { status: 500 });
  }
}