import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getToken } from 'next-auth/jwt';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();

    if (!email || !code) {
      return NextResponse.json(
        { error: 'Email and verification code are required' },
        { status: 400 }
      );
    }

    // Get verification code from database
    const { data: verification, error: verifyError } = await supabase
      .from('verification_tokens')
      .select('token, expires')
      .eq('identifier', email)
      .single();

    if (verifyError || !verification) {
      return NextResponse.json(
        { error: 'Invalid or expired verification code' },
        { status: 400 }
      );
    }

    // Check if code matches
    if (verification.token !== code) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      );
    }

    // Check if code is expired
    if (new Date() > new Date(verification.expires)) {
      // Clean up expired token
      await supabase
        .from('verification_tokens')
        .delete()
        .eq('identifier', email);

      return NextResponse.json(
        { error: 'Verification code has expired' },
        { status: 400 }
      );
    }

    // Code is valid! Create or update user
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    let userId: string;

    if (!existingUser) {
      // Create new user
      userId = crypto.randomUUID();
      const { error: createError } = await supabase
        .from('users')
        .insert({
          id: userId,
          email: email,
          updatedAt: new Date().toISOString(),
        });

      if (createError) {
        console.error('Error creating user:', createError);
        return NextResponse.json(
          { error: 'Failed to create user account' },
          { status: 500 }
        );
      }
    } else {
      userId = existingUser.id;
      // Update existing user
      await supabase
        .from('users')
        .update({ updatedAt: new Date().toISOString() })
        .eq('id', userId);
    }

    // Clean up used verification token
    await supabase
      .from('verification_tokens')
      .delete()
      .eq('identifier', email);

    // Return success with user data for frontend to handle session
    return NextResponse.json({ 
      success: true, 
      user: { 
        id: userId, 
        email: email 
      },
      message: 'Email verified successfully'
    });

  } catch (error: any) {
    console.error('Verify code error:', error);
    return NextResponse.json(
      { error: 'Failed to verify code' },
      { status: 500 }
    );
  }
}