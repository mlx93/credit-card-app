import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// Helper function to mask sensitive data in production
function maskSensitiveData(data: any, isProduction: boolean, userEmail?: string) {
  if (!isProduction) return data;
  
  return {
    ...data,
    allUsers: data.allUsers?.map((user: any) => ({
      ...user,
      id: user.id.substring(0, 8) + '...',
      email: user.email === userEmail ? user.email : user.email.replace(/(.{2}).*@(.*)/, '$1***@$2'),
      plaidItemsDetail: user.plaidItemsDetail?.map((item: any) => ({
        ...item,
        id: item.id.substring(0, 8) + '...',
        userId: item.userId.substring(0, 8) + '...'
      }))
    })),
    debug: process.env.NODE_ENV === 'production' ? null : data.debug
  };
}

export async function GET(request: Request) {
  try {
    console.log('📊 USER STATS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // SECURITY: Only allow admin users or the app owner to access this endpoint
    const adminEmails = ['mylesethan93@gmail.com']; // Replace with your admin emails
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isAdmin = adminEmails.includes(session.user.email || '');
    
    if (!isDevelopment && !isAdmin) {
      console.log('🚫 Unauthorized access attempt to user-stats by:', session.user.email);
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Additional security: Check for specific environment variable
    const debugAccessKey = process.env.ADMIN_DEBUG_KEY;
    const { searchParams } = new URL(request.url);
    const providedKey = searchParams.get('key');
    
    if (process.env.NODE_ENV === 'production' && debugAccessKey && providedKey !== debugAccessKey) {
      console.log('🚫 Invalid debug key provided by:', session.user.email);
      return NextResponse.json({ error: 'Forbidden: Invalid access key' }, { status: 403 });
    }

    // Get comprehensive user statistics
    const [
      totalUsersResult,
      totalPlaidItemsResult,
      totalCreditCardsResult,
      totalTransactionsResult,
      totalBillingCyclesResult,
      allUsersResult,
      usersSimpleResult,
      plaidItemsDetailResult
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
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
          createdAt,
          plaid_items(id)
        `)
        .order('createdAt', { ascending: false })
        .limit(20),
      // Simple users query without relationships
      supabaseAdmin
        .from('users')
        .select('id, email, name, createdAt')
        .order('createdAt', { ascending: false })
        .limit(20),
      // Get plaid items with user info
      supabaseAdmin
        .from('plaid_items')
        .select('id, userId, institutionName, status')
        .limit(10)
    ]);
    
    // Extract counts from results
    const totalUsers = totalUsersResult.count || 0;
    const totalPlaidItems = totalPlaidItemsResult.count || 0;
    const totalCreditCards = totalCreditCardsResult.count || 0;
    const totalTransactions = totalTransactionsResult.count || 0;
    const totalBillingCycles = totalBillingCyclesResult.count || 0;
    const allUsers = allUsersResult.data || [];
    const usersSimple = usersSimpleResult.data || [];
    const plaidItemsDetail = plaidItemsDetailResult.data || [];
    
    // Calculate users with connections properly by checking plaid_items array
    const usersWithPlaidItems = usersSimple.filter(user => {
      const userPlaidItems = plaidItemsDetail.filter(item => item.userId === user.id);
      return userPlaidItems.length > 0;
    }).length;
    
    // Debug logging
    console.log('🔍 DEBUG INFO:', {
      allUsersCount: allUsers.length,
      usersSimpleCount: usersSimple.length,
      allUsersResult: allUsers,
      usersSimpleResult: usersSimple,
      plaidItemsDetail,
      allUsersError: allUsersResult.error,
      usersSimpleError: usersSimpleResult.error,
      plaidItemsError: plaidItemsDetailResult.error
    });
    
    // Handle any errors
    if (totalUsersResult.error) console.error('Error counting users:', totalUsersResult.error);
    if (totalPlaidItemsResult.error) console.error('Error counting plaid items:', totalPlaidItemsResult.error);
    if (totalCreditCardsResult.error) console.error('Error counting credit cards:', totalCreditCardsResult.error);
    if (totalTransactionsResult.error) console.error('Error counting transactions:', totalTransactionsResult.error);
    if (totalBillingCyclesResult.error) console.error('Error counting billing cycles:', totalBillingCyclesResult.error);
    if (allUsersResult.error) console.error('Error fetching users:', allUsersResult.error);

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
      allUsers: usersSimple.map(user => {
        // Find matching plaid items for this user
        const userPlaidItems = plaidItemsDetail.filter(item => item.userId === user.id);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: user.createdAt,
          plaidItems: userPlaidItems.length,
          plaidItemsDetail: userPlaidItems,
          isCurrentUser: user.id === session.user.id
        };
      }),
      debug: {
        allUsersFromRelationQuery: allUsers,
        usersSimple: usersSimple,
        plaidItemsDetail: plaidItemsDetail,
        errors: {
          allUsers: allUsersResult.error,
          usersSimple: usersSimpleResult.error,
          plaidItems: plaidItemsDetailResult.error
        }
      }
    };

    console.log('📊 USER STATS:', stats);
    
    // Apply data masking for security
    const isProduction = process.env.NODE_ENV === 'production';
    const maskedStats = maskSensitiveData(stats, isProduction, session.user.email);
    
    return NextResponse.json({ 
      message: 'User statistics retrieved',
      stats: maskedStats
    });
  } catch (error) {
    console.error('📊 USER STATS ERROR:', error);
    return NextResponse.json({ error: 'Failed to get user statistics' }, { status: 500 });
  }
}