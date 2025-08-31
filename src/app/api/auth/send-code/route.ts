import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize Resend with API key
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Debug logging
console.log('=== EMAIL CONFIGURATION CHECK ===');
console.log('- RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);
console.log('- RESEND_API_KEY preview:', process.env.RESEND_API_KEY?.substring(0, 10) + '...');
console.log('- Resend initialized:', !!resend);

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
    // First try the verification_tokens table, if it fails, use users table as fallback
    const { error: dbError } = await supabase
      .from('verification_tokens')
      .upsert({
        identifier: email,
        token: code,
        expires: expires,
      });

    if (dbError) {
      console.error('Verification tokens table error:', dbError);
      console.log('Attempting fallback to users table...');
      
      // Fallback: Store in users table temporarily
      const { error: userError } = await supabase
        .from('users')
        .upsert({
          email: email,
          verificationCode: code,
          verificationExpires: expires,
          updatedAt: new Date().toISOString(),
        }, {
          onConflict: 'email'
        });
        
      if (userError) {
        console.error('Users table error:', userError);
        // Continue anyway - we'll still try to send the email
        console.log('WARNING: Could not store verification code in database');
      }
    }

    // Send email with verification code
    try {
      console.log('Attempting to send email to:', email);
      
      if (!resend) {
        throw new Error('Resend not initialized - RESEND_API_KEY missing');
      }
      
      console.log('Using from address: CardCycle <onboarding@resend.dev>');
      
      const emailResult = await resend.emails.send({
        from: 'CardCycle <onboarding@resend.dev>',  // Use Resend's test domain for now
        to: email,
        subject: 'Your CardCycle Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #4f46e5; margin-bottom: 10px;">CardCycle</h1>
              <p style="color: #666; font-size: 16px;">Your verification code is ready</p>
            </div>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 30px; text-align: center; margin-bottom: 20px;">
              <h2 style="color: #1f2937; margin-bottom: 15px;">Verification Code</h2>
              <div style="font-size: 32px; font-weight: bold; color: #4f46e5; letter-spacing: 8px; margin-bottom: 15px;">${code}</div>
              <p style="color: #666; font-size: 14px;">This code expires in 3 minutes</p>
            </div>
            
            <div style="text-align: center; color: #666; font-size: 12px;">
              <p>If you didn't request this code, you can safely ignore this email.</p>
              <p>This code was requested for: ${email}</p>
            </div>
          </div>
        `,
        text: `Your CardCycle verification code is: ${code}\n\nThis code expires in 3 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`
      });
      
      console.log('✅ Email sent successfully!');
      console.log('Email ID:', emailResult.data?.id);
      console.log('Verification code email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError);
      console.error('Email error details:', JSON.stringify(emailError, null, 2));
      
      // Check if it's an API key issue
      if (!process.env.RESEND_API_KEY) {
        console.error('🚨 RESEND_API_KEY environment variable is not set!');
      }
      
      // Fall back to console logging if email fails
      console.log('=== EMAIL VERIFICATION CODE (EMAIL FAILED) ===');
      console.log('Email:', email);
      console.log('Code:', code);
      console.log('Expires in 3 minutes');
      console.log('============================================');
      
      // In development/testing, return the code if email fails
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({ 
          success: true, 
          message: 'Email service unavailable - code logged to console',
          debugCode: code // Only in non-production!
        });
      }
    }

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