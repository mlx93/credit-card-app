import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address is required' },
        { status: 400 }
      );
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration to 3 minutes from now
    const expires = new Date(Date.now() + 3 * 60 * 1000).toISOString();

    // Store verification code in database
    const { error: dbError } = await supabase
      .from('verification_tokens')
      .upsert({
        identifier: email,
        token: code,
        expires: expires,
      });

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: 'Failed to generate verification code' },
        { status: 500 }
      );
    }

    // TODO: Send email with code
    // For now, log the code for testing
    console.log('=== EMAIL VERIFICATION CODE ===');
    console.log('Email:', email);
    console.log('Code:', code);
    console.log('Expires in 3 minutes');
    console.log('===============================');

    return NextResponse.json({ 
      success: true, 
      message: 'Verification code sent to your email' 
    });

  } catch (error: any) {
    console.error('Send code error:', error);
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}