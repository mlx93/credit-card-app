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
  } catch (error) {
    console.error('Link token creation error:', error);
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 500 });
  }
}