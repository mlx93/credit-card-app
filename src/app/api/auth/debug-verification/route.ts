import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }
    
    console.log('🔍 Debug: Checking verification for email:', email);
    
    // Check verification_tokens table
    const { data: tokenData, error: tokenError } = await supabase
      .from('verification_tokens')
      .select('*')
      .eq('identifier', email);
      
    console.log('🔍 verification_tokens result:', { tokenData, tokenError });
    
    // Check users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('email, verificationCode, verificationExpires, updatedAt')
      .eq('email', email);
      
    console.log('🔍 users table result:', { userData, userError });
    
    return NextResponse.json({
      email,
      verification_tokens: {
        data: tokenData,
        error: tokenError
      },
      users: {
        data: userData,
        error: userError
      }
    });
    
  } catch (error: any) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}