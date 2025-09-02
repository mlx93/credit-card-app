import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-users',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('👥 Fetching all users...');
    
    // Get all users
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('*')
      .order('updatedAt', { ascending: false });

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Get accounts (for OAuth providers like Google)
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('accounts')
      .select('userId, provider, providerAccountId, type')
      .order('userId');

    if (accountsError) {
      console.error('Error fetching accounts:', accountsError);
      // Continue without accounts data
    }

    // Map accounts to users
    const usersWithAuth = users?.map(user => {
      const userAccounts = accounts?.filter(acc => acc.userId === user.id) || [];
      const authMethods = userAccounts.map(acc => `${acc.provider} (${acc.type})`);
      
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        authMethods: authMethods.length > 0 ? authMethods : ['Email Code'],
        hasOAuth: authMethods.length > 0,
        isEmailAuth: authMethods.length === 0
      };
    }) || [];

    console.log(`👥 Found ${users?.length || 0} users`);

    return NextResponse.json({
      totalUsers: users?.length || 0,
      users: usersWithAuth,
      summary: {
        emailAuthUsers: usersWithAuth.filter(u => u.isEmailAuth).length,
        oauthUsers: usersWithAuth.filter(u => u.hasOAuth).length,
        authMethods: [...new Set(usersWithAuth.flatMap(u => u.authMethods))]
      }
    });

  } catch (error: any) {
    console.error('Debug users error:', error);
    return NextResponse.json({ 
      error: 'Failed to debug users',
      details: error.message 
    }, { status: 500 });
  }
}