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

    const linkToken = await plaidService.createLinkToken(session.user.id);
    
    return NextResponse.json({ link_token: linkToken });
  } catch (error: any) {
    console.error('Link token creation error:', error);
    console.error('Error details:', {
      error_type: error?.error_type,
      error_code: error?.error_code,
      error_message: error?.error_message,
      display_message: error?.display_message,
      status_code: error?.status_code,
      full_error: JSON.stringify(error, null, 2)
    });
    
    // Return more detailed error information for debugging
    const errorMessage = error?.error_message || error?.display_message || 'Failed to create link token';
    const errorCode = error?.error_code || 'UNKNOWN_ERROR';
    
    return NextResponse.json({ 
      error: errorMessage,
      error_code: errorCode,
      error_type: error?.error_type
    }, { status: 500 });
  }
}