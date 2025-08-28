import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidService } from '@/services/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== LINK TOKEN DEBUG ===');
    console.log('User ID:', session.user.id);
    console.log('PLAID_ENV:', process.env.PLAID_ENV);
    console.log('PLAID_CLIENT_ID exists:', !!process.env.PLAID_CLIENT_ID);
    console.log('PLAID_SECRET exists:', !!process.env.PLAID_SECRET);
    console.log('APP_URL:', process.env.APP_URL);

    try {
      console.log('Calling plaidService.createLinkToken...');
      const linkToken = await plaidService.createLinkToken(session.user.id);
      console.log('Link token created successfully, length:', linkToken.length);
      
      return NextResponse.json({ 
        success: true,
        hasLinkToken: true,
        linkTokenLength: linkToken.length,
        plaidEnv: process.env.PLAID_ENV,
        message: 'Link token created successfully'
      });
      
    } catch (plaidError) {
      console.error('=== PLAID LINK TOKEN ERROR ===');
      console.error('Error details:', plaidError);
      console.error('Error code:', plaidError.error_code);
      console.error('Error type:', plaidError.error_type);
      console.error('Error message:', plaidError.message);
      console.error('Display message:', plaidError.display_message);
      console.error('=== END PLAID ERROR ===');
      
      return NextResponse.json({
        success: false,
        error: 'Plaid link token creation failed',
        plaidError: {
          error_code: plaidError.error_code,
          error_type: plaidError.error_type,
          error_message: plaidError.message,
          display_message: plaidError.display_message
        },
        plaidEnv: process.env.PLAID_ENV
      });
    }

  } catch (error) {
    console.error('Link token debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug endpoint failed',
      details: error.message 
    }, { status: 500 });
  }
}