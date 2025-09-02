import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { email, code } = await request.json();
    
    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code required' }, { status: 400 });
    }
    
    console.log('🧪 Test: Verifying code for:', email, 'Code:', code);
    
    // Get verification code from verification_tokens table
    const { data: tokenData, error: tokenError } = await supabase
      .from('verification_tokens')
      .select('token, expires, identifier')
      .eq('identifier', email)
      .order('expires', { ascending: false });
      
    console.log('🧪 Test: All tokens for email:', tokenData);
    console.log('🧪 Test: Token error:', tokenError);

    if (tokenError || !tokenData || tokenData.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'No verification code found',
        debug: { tokenError, tokenData }
      });
    }
    
    // Get the most recent token
    const latestToken = tokenData[0];
    console.log('🧪 Test: Latest token:', latestToken);
    
    const isExpired = new Date() > new Date(latestToken.expires);
    const codeMatches = latestToken.token === code;
    
    console.log('🧪 Test: Verification check:', {
      storedCode: latestToken.token,
      submittedCode: code,
      codeMatches,
      expires: latestToken.expires,
      currentTime: new Date().toISOString(),
      isExpired
    });
    
    if (!codeMatches) {
      return NextResponse.json({ 
        success: false, 
        error: 'Code does not match',
        debug: { storedCode: latestToken.token, submittedCode: code }
      });
    }
    
    if (isExpired) {
      return NextResponse.json({ 
        success: false, 
        error: 'Code has expired',
        debug: { expires: latestToken.expires, currentTime: new Date().toISOString() }
      });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Code is valid!',
      debug: { codeMatches, isExpired }
    });
    
  } catch (error: any) {
    console.error('🧪 Test error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}