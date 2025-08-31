import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const nextAuthSecret = process.env.NEXTAUTH_SECRET;
    const nextAuthUrl = process.env.NEXTAUTH_URL;

    // Test Supabase connection
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Test next_auth schema access
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('count(*)')
      .single();

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
        nextAuthUsers: users || 'Error fetching count'
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}