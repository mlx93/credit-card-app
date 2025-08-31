import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    // Environment variable checks
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const nextAuthUrl = process.env.NEXTAUTH_URL;
    const nextAuthSecret = process.env.NEXTAUTH_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Test Supabase connection
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
    
    // Check NextAuth tables
    let nextAuthStatus = {};
    try {
      const { count: usersCount, error: usersError } = await supabase
        .from('users')
        .select('*', { count: 'exact' });
      
      nextAuthStatus = {
        publicUsers: usersError ? `❌ ${usersError.message}` : `✅ ${usersCount || 0} users`,
      };

      // Try to access next_auth schema tables
      try {
        const { count: accountsCount } = await supabase
          .schema('next_auth')
          .from('accounts')
          .select('*', { count: 'exact' });
        
        nextAuthStatus.nextAuthAccounts = `✅ ${accountsCount || 0} accounts`;
      } catch (e) {
        nextAuthStatus.nextAuthAccounts = `❌ Schema access failed`;
      }

      try {
        const { count: sessionsCount } = await supabase
          .schema('next_auth')
          .from('sessions')
          .select('*', { count: 'exact' });
        
        nextAuthStatus.nextAuthSessions = `✅ ${sessionsCount || 0} sessions`;
      } catch (e) {
        nextAuthStatus.nextAuthSessions = `❌ Schema access failed`;
      }

    } catch (error) {
      nextAuthStatus.error = error.message;
    }

    // Google OAuth redirect URIs validation
    const expectedRedirectUris = [
      `${nextAuthUrl}/api/auth/callback/google`,
      'https://cardcycle.app/api/auth/callback/google',
      'https://www.cardcycle.app/api/auth/callback/google'
    ];

    const debugInfo = {
      currentSession: session ? {
        user: session.user?.email,
        id: session.user?.id,
        expires: session.expires
      } : null,
      
      environment: {
        googleClientId: googleClientId ? `✅ Set (${googleClientId.substring(0, 12)}...)` : '❌ Missing',
        googleClientSecret: googleClientSecret ? '✅ Set' : '❌ Missing',
        nextAuthUrl: nextAuthUrl || '❌ Missing',
        nextAuthSecret: nextAuthSecret ? '✅ Set' : '❌ Missing',
        supabaseUrl: supabaseUrl ? '✅ Set' : '❌ Missing',
        supabaseServiceKey: supabaseServiceKey ? '✅ Set' : '❌ Missing',
      },
      
      database: nextAuthStatus,
      
      oauth: {
        expectedRedirectUris,
        currentDomain: nextAuthUrl,
        note: 'Make sure these redirect URIs are configured in your Google Console'
      },

      troubleshooting: {
        commonIssues: [
          'Redirect URI mismatch in Google Console',
          'Wrong domain configured (cardcycle.app vs www.cardcycle.app)',
          'NextAuth secret not set or changed',
          'Supabase NextAuth tables not properly configured',
          'Google OAuth consent screen not published',
          'Test users not added for OAuth app in testing mode'
        ],
        nextSteps: [
          '1. Verify Google Console redirect URIs match exactly',
          '2. Check if OAuth consent screen is published',
          '3. Ensure test users are added if app is in testing mode',
          '4. Verify all environment variables are set correctly',
          '5. Check browser console for specific error messages',
          '6. Try incognito mode to rule out cached OAuth state'
        ]
      }
    };

    return NextResponse.json(debugInfo);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}