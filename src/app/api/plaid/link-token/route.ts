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

    // Parse request body for oauth_state_id, institutionId, and institutionType if provided
    let oauth_state_id: string | undefined;
    let institutionId: string | undefined;
    let institutionType: string | undefined;
    try {
      const body = await request.json();
      oauth_state_id = body?.oauth_state_id;
      institutionId = body?.institutionId;
      institutionType = body?.institutionType;
      
      if (oauth_state_id) {
        console.log('📋 Link token request with oauth_state_id:', oauth_state_id);
      }
      
      if (institutionId) {
        console.log(`📍 Creating link token for specific institution: ${institutionId}`);
        if (institutionId === 'ins_54') {
          console.log('🎯 Robinhood institution detected - will use investment platform logic');
        }
      }
      
      if (institutionType) {
        console.log(`🏢 Creating link token for institution type: ${institutionType}`);
        if (institutionType === 'investment') {
          // For investment type, we'll pass the first investment institution ID
          // This will trigger the investment platform filtering
          institutionId = 'ins_54'; // Default to Robinhood for investment platform flow
          console.log('🎯 Investment platform type selected - using Robinhood as default institution for filtering');
        }
      }
    } catch {
      // No body or invalid JSON - that's fine, continue without parameters
    }

    const linkToken = await plaidService.createLinkToken(session.user.id, oauth_state_id, institutionId);
    
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