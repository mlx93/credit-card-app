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

    console.log('👥 Accounts data:', accounts);
    console.log('👥 Accounts error:', accountsError);

    const usersWithAuthType = users?.map(user => {
      const userAccounts = accounts?.filter(acc => acc.userId === user.id) || [];
      const hasOAuth = userAccounts.length > 0;
      
      console.log(`👥 User ${user.email}:`, {
        hasOAuth,
        accounts: userAccounts
      });
      
      return {
        id: user.id,
        email: user.email,
        name: user.name || 'No name',
        createdAt: user.createdAt,
        authType: hasOAuth ? 'Google OAuth' : 'Email Code',
        accountsFound: userAccounts
      };
    }) || [];

    console.log(`👥 Found ${users?.length || 0} total users`);

    return NextResponse.json({
      totalUsers: users?.length || 0,
      users: usersWithAuthType,
      summary: {
        emailAuthUsers: usersWithAuthType.filter(u => u.authType === 'Email Code').length,
        oauthUsers: usersWithAuthType.filter(u => u.authType === 'Google OAuth').length
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