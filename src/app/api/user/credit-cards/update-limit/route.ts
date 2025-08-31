import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function PUT(request: NextRequest) {
  // DEPRECATED: This endpoint is deprecated. Use /api/cards/[cardId]/manual-limit instead.
  console.warn('⚠️  DEPRECATED API ENDPOINT: /api/user/credit-cards/update-limit is deprecated. Use /api/cards/[cardId]/manual-limit instead.');
  
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId } = await request.json();
    
    // Redirect to new API endpoint with proper manual limit handling
    return NextResponse.json({ 
      error: 'This endpoint is deprecated. Please use /api/cards/[cardId]/manual-limit for setting manual credit limits.',
      deprecated: true,
      newEndpoint: `/api/cards/${cardId}/manual-limit`,
      migration: 'Change method to PUT with body: { "manualCreditLimit": value }'
    }, { status: 410 }); // 410 Gone - indicates deprecated resource

  } catch (error) {
    console.error('Error in deprecated endpoint:', error);
    return NextResponse.json(
      { 
        error: 'This endpoint is deprecated. Please use /api/cards/[cardId]/manual-limit instead.',
        deprecated: true
      },
      { status: 410 }
    );
  }
}