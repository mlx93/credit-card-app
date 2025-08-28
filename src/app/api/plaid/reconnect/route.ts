import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Find the Plaid item and verify ownership
    const plaidItem = await prisma.plaidItem.findFirst({
      where: {
        itemId,
        userId: session.user.id
      }
    });

    if (!plaidItem) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    console.log(`Creating update link token for ${plaidItem.institutionName} (${itemId})`);

    try {
      // Create a link token for updating this specific item
      const updateLinkToken = await plaidService.createUpdateLinkToken(session.user.id, itemId);
      
      return NextResponse.json({ 
        success: true,
        link_token: updateLinkToken,
        institution_name: plaidItem.institutionName
      });

    } catch (plaidError) {
      console.error('Failed to create update link token:', plaidError);
      
      return NextResponse.json({
        success: false,
        error: 'Failed to create reconnection link',
        plaidError: {
          error_code: plaidError.error_code,
          error_type: plaidError.error_type,
          message: plaidError.message
        }
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Error creating reconnect link:', error);
    return NextResponse.json({ 
      error: 'Failed to create reconnection link',
      details: error.message 
    }, { status: 500 });
  }
}