import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'auth-test-email',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const apiKey = process.env.RESEND_API_KEY;
    
    const response: any = {
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL_ENV: process.env.VERCEL_ENV,
        RESEND_API_KEY: apiKey ? `${apiKey.substring(0, 10)}...` : '❌ NOT SET',
      },
      resend: {
        initialized: false,
        testEmail: null,
        error: null
      }
    };
    
    if (apiKey) {
      try {
        const resend = new Resend(apiKey);
        response.resend.initialized = true;
        
        // Try to send a test email
        const result = await resend.emails.send({
          from: 'CardCycle <noreply@cardcycle.app>',
          to: 'test@resend.dev', // Resend's test email
          subject: 'CardCycle Email Test',
          html: '<p>This is a test email from CardCycle</p>'
        });
        
        response.resend.testEmail = {
          success: true,
          id: result.data?.id,
          result: result
        };
      } catch (error: any) {
        response.resend.error = {
          message: error.message,
          type: error.name,
          response: error.response?.data
        };
      }
    }
    
    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}