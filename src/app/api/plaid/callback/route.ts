import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔗 Plaid OAuth callback API endpoint hit');
    
    const searchParams = request.nextUrl.searchParams;
    const oauth_state_id = searchParams.get('oauth_state_id');
    const link_session_id = searchParams.get('link_session_id');
    
    console.log('OAuth callback params:', {
      oauth_state_id,
      link_session_id,
      allParams: Object.fromEntries(searchParams.entries())
    });

    // For OAuth flow, we need to redirect to the frontend page to resume Link
    // The frontend page will handle the actual token exchange
    const callbackUrl = new URL('/plaid/callback', request.url);
    
    // Pass through all query parameters to the frontend
    for (const [key, value] of searchParams.entries()) {
      callbackUrl.searchParams.set(key, value);
    }

    console.log('Redirecting to frontend callback:', callbackUrl.toString());

    // Return 302 redirect to frontend callback page
    return NextResponse.redirect(callbackUrl);
    
  } catch (error) {
    console.error('OAuth callback API error:', error);
    
    // On error, redirect to dashboard with error parameter
    const errorUrl = new URL('/dashboard', request.url);
    errorUrl.searchParams.set('plaid_error', 'oauth_callback_failed');
    
    return NextResponse.redirect(errorUrl);
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔗 Plaid OAuth callback POST endpoint hit');
    
    const body = await request.json();
    console.log('OAuth callback POST body:', body);

    // Return 200 OK for Plaid's OAuth flow
    return NextResponse.json({ 
      success: true,
      message: 'OAuth callback received' 
    }, { status: 200 });
    
  } catch (error) {
    console.error('OAuth callback POST error:', error);
    
    return NextResponse.json({ 
      success: false, 
      error: 'OAuth callback failed' 
    }, { status: 500 });
  }
}