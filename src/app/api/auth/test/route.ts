import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'auth-test',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const nextAuthSecret = process.env.NEXTAUTH_SECRET;
    const nextAuthUrl = process.env.NEXTAUTH_URL;

    // Test Supabase connection
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Test next_auth schema access
    const { count: userCount, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact' });
    
    // Test verification_tokens table (check if we can access next_auth schema)
    let tokenCount, tokenError;
    try {
      const result = await supabase
        .schema('next_auth')
        .from('verification_tokens')
        .select('*', { count: 'exact' });
      tokenCount = result.count;
      tokenError = result.error;
    } catch (e) {
      tokenError = { message: 'Schema access restricted - using direct SQL query instead' };
    }

    return NextResponse.json({
      environment: {
        supabaseUrl: supabaseUrl ? '✅ Set' : '❌ Missing',
        supabaseKey: supabaseKey ? '✅ Set' : '❌ Missing', 
        googleClientId: googleClientId ? '✅ Set' : '❌ Missing',
        nextAuthSecret: nextAuthSecret ? '✅ Set' : '❌ Missing',
        nextAuthUrl: nextAuthUrl || '❌ Missing',
      },
      database: {
        connection: usersError ? `❌ Error: ${usersError.message}` : '✅ Connected',
        nextAuthUsers: usersError ? 'Error fetching count' : `${userCount || 0} users`,
        verificationTokens: tokenError ? `❌ Error: ${tokenError.message}` : `✅ ${tokenCount || 0} tokens`
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}