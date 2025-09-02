import { NextRequest, NextResponse } from 'next/server';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-google-oauth-check',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const nextAuthUrl = process.env.NEXTAUTH_URL;
    const appUrl = process.env.APP_URL;

    // Check for domain consistency
    const domains = {
      nextAuthUrl,
      appUrl,
      mismatch: nextAuthUrl !== appUrl
    };

    // Expected redirect URIs based on current config
    const redirectUris = [
      `${nextAuthUrl}/api/auth/callback/google`,
      `${appUrl}/api/auth/callback/google`
    ];

    // Remove duplicates
    const uniqueRedirectUris = [...new Set(redirectUris)];

    const diagnosis = {
      domains,
      oauth: {
        clientId: googleClientId ? `${googleClientId.substring(0, 20)}...` : 'Not set',
        redirectUris: uniqueRedirectUris,
        recommendation: domains.mismatch 
          ? '⚠️  Domain mismatch detected! NEXTAUTH_URL and APP_URL should match.'
          : '✅ Domain configuration looks consistent'
      },
      googleConsoleSteps: {
        step1: 'Go to Google Cloud Console > APIs & Services > Credentials',
        step2: `Find OAuth 2.0 Client ID: ${googleClientId?.substring(0, 20)}...`,
        step3: 'Click Edit and check Authorized redirect URIs',
        step4: 'Ensure these URIs are listed:',
        requiredUris: uniqueRedirectUris,
        step5: 'Save changes and wait 5-10 minutes for propagation'
      },
      potentialIssues: [
        domains.mismatch ? 'Domain mismatch between NEXTAUTH_URL and APP_URL' : null,
        'OAuth consent screen not published',
        'Redirect URIs not matching exactly (including http vs https)',
        'App is in testing mode but user email not added to test users',
        'Google OAuth quotas exceeded',
        'Invalid or expired Google OAuth credentials'
      ].filter(Boolean)
    };

    return NextResponse.json(diagnosis);
  } catch (error: any) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 });
  }
}