import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'admin-users',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('👥 Fetching all users...');
    
    // Get all users
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, createdAt, updatedAt')
      .order('createdAt', { ascending: true });

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Get OAuth accounts for context
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('accounts')
      .select('userId, provider, type')
      .order('userId');

    // Get Plaid items count per user
    const { data: plaidItems, error: plaidItemsError } = await supabaseAdmin
      .from('plaid_items')
      .select('userId, institutionName, status')
      .order('userId');

    // Get credit cards count per user
    const { data: creditCards, error: creditCardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('userId, name, plaidItemId')
      .order('userId');

    console.log('👥 Accounts data:', accounts);
    console.log('👥 Plaid items:', plaidItems?.length || 0);
    console.log('👥 Credit cards:', creditCards?.length || 0);

    const usersWithDetails = users?.map(user => {
      const userAccounts = accounts?.filter(acc => acc.userId === user.id) || [];
      const userPlaidItems = plaidItems?.filter(item => item.userId === user.id) || [];
      const userCreditCards = creditCards?.filter(card => card.userId === user.id) || [];
      
      // Fix auth type logic - check provider type, not just existence
      const hasGoogleOAuth = userAccounts.some(acc => acc.provider === 'google' && acc.type === 'oauth');
      const hasEmailCode = userAccounts.some(acc => acc.provider === 'email-code' && acc.type === 'credentials');
      
      let authType = 'Unknown';
      if (hasGoogleOAuth) {
        authType = 'Google OAuth';
      } else if (hasEmailCode) {
        authType = 'Email Code';
      }
      
      console.log(`👥 User ${user.email}:`, {
        authType,
        plaidConnections: userPlaidItems.length,
        creditCards: userCreditCards.length,
        accounts: userAccounts
      });
      
      return {
        id: user.id,
        email: user.email,
        name: user.name || 'No name',
        createdAt: user.createdAt,
        authType,
        plaidConnections: userPlaidItems.length,
        plaidConnectionDetails: userPlaidItems.map(item => ({
          institutionName: item.institutionName,
          status: item.status
        })),
        creditCards: userCreditCards.length,
        creditCardNames: userCreditCards.map(card => card.name),
        accountsFound: userAccounts
      };
    }) || [];

    console.log(`👥 Found ${users?.length || 0} total users`);

    return NextResponse.json({
      totalUsers: users?.length || 0,
      users: usersWithDetails,
      summary: {
        emailAuthUsers: usersWithDetails.filter(u => u.authType === 'Email Code').length,
        oauthUsers: usersWithDetails.filter(u => u.authType === 'Google OAuth').length,
        totalPlaidConnections: usersWithDetails.reduce((sum, u) => sum + u.plaidConnections, 0),
        totalCreditCards: usersWithDetails.reduce((sum, u) => sum + u.creditCards, 0)
      }
    });

  } catch (error: any) {
    console.error('Admin users error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch users',
      details: error.message 
    }, { status: 500 });
  }
}