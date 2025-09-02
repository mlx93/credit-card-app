import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  // Initialize Resend inside the function for Vercel serverless
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  
  // Debug logging
  console.log('=== EMAIL CONFIGURATION CHECK ===');
  console.log('- RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);
  console.log('- RESEND_API_KEY preview:', process.env.RESEND_API_KEY?.substring(0, 10) + '...');
  console.log('- Resend initialized:', !!resend);
  try {
    const { email } = await request.json();
    
    console.log('=== SEND CODE REQUEST ===');
    console.log('Email requested:', email);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Vercel Environment:', process.env.VERCEL_ENV);

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
    let codeStoredSuccessfully = false;
    
    // Delete any existing codes for this email first
    await supabase
      .from('verification_tokens')
      .delete()
      .eq('identifier', email);
    
    const { error: dbError } = await supabase
      .from('verification_tokens')
      .insert({
        identifier: email,
        token: code,
        expires: expires,
      });

    if (dbError) {
      console.error('Verification tokens table error:', dbError);
      console.log('❌ Failed to store verification code in database');
      // Continue anyway - we'll still try to send the email
      codeStoredSuccessfully = false;
    } else {
      codeStoredSuccessfully = true;
      console.log('✅ Code stored in verification_tokens table successfully');
    }

    // Send email with verification code
    try {
      console.log('Attempting to send email to:', email);
      
      if (!resend) {
        throw new Error('Resend not initialized - RESEND_API_KEY missing');
      }
      
      console.log('Using from address: CardCycle <noreply@cardcycle.app>');
      
      const emailResult = await resend.emails.send({
        from: 'CardCycle <noreply@cardcycle.app>',
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
      
      // Check if Resend returned an error in the response
      if (emailResult.error) {
        console.error('❌ Resend API error:', emailResult.error);
        throw new Error(`Resend error: ${emailResult.error.error || emailResult.error.message || 'Unknown error'}`);
      }
      
      console.log('✅ Email sent successfully!');
      console.log('Email ID:', emailResult.data?.id);
      console.log('Verification code email sent to:', email);
    } catch (emailError: any) {
      console.error('❌ Failed to send email:', emailError);
      console.error('Email error details:', JSON.stringify(emailError, null, 2));
      console.error('Error message:', emailError?.message);
      console.error('Error response:', emailError?.response?.data);
      
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
      
      // Check if it's a domain verification issue
      if (emailError.message?.includes('verify a domain') || emailError.message?.includes('testing emails')) {
        return NextResponse.json({ 
          success: false, 
          error: 'Email domain not verified. Please contact support.',
          debugCode: code, // Provide code as fallback
          message: `Verification code: ${code} (Email service needs domain verification)`
        }, { status: 200 }); // Still return 200 so user can use the code
      }
      
      // In development/testing, return the code if email fails
      if (process.env.NODE_ENV !== 'production') {
        return NextResponse.json({ 
          success: true, 
          message: 'Email service unavailable - code logged to console',
          debugCode: code // Only in non-production!
        });
      }
    }

    // Temporary: Add debug info to response
    return NextResponse.json({ 
      success: true, 
      message: 'Verification code sent to your email',
      debug: {
        codeStored: codeStoredSuccessfully,
        emailConfigured: !!resend,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV
      }
    });

  } catch (error: any) {
    console.error('Send code error:', error);
    return NextResponse.json(
      { error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}