import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔗 Plaid OAuth callback GET endpoint hit');
    
    const searchParams = request.nextUrl.searchParams;
    const oauth_state_id = searchParams.get('oauth_state_id');
    const link_session_id = searchParams.get('link_session_id');
    
    console.log('OAuth callback GET params:', {
      oauth_state_id,
      link_session_id,
      allParams: Object.fromEntries(searchParams.entries())
    });

    // Always return 200 OK (Plaid requirement)
    // Use HTML response that redirects via JavaScript if we have OAuth params
    if (oauth_state_id || link_session_id) {
      const callbackUrl = new URL('/plaid/callback', request.url);
      for (const [key, value] of searchParams.entries()) {
        callbackUrl.searchParams.set(key, value);
      }
      
      // Return HTML with JavaScript redirect
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Plaid OAuth Callback</title>
  <meta charset="utf-8">
</head>
<body>
  <script>
    console.log('Plaid OAuth callback - redirecting to: ${callbackUrl.toString()}');
    window.location.href = '${callbackUrl.toString()}';
  </script>
  <p>Redirecting...</p>
</body>
</html>`;
      
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      });
    } else {
      // Return 200 OK even without query params (as required by Plaid)
      return NextResponse.json({ 
        success: true,
        message: 'Plaid OAuth callback endpoint ready',
        timestamp: new Date().toISOString()
      }, { status: 200 });
    }
    
  } catch (error) {
    console.error('OAuth callback GET error:', error);
    
    // Always return 200, even on error (Plaid requirement)
    return NextResponse.json({ 
      success: false,
      error: 'Internal error but endpoint is available',
      timestamp: new Date().toISOString()
    }, { status: 200 });
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