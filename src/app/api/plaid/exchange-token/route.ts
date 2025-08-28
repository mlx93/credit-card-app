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

    const { public_token } = await request.json();
    
    if (!public_token) {
      return NextResponse.json({ error: 'Public token required' }, { status: 400 });
    }

    const accessToken = await plaidService.exchangePublicToken(public_token, session.user.id);
    
    return NextResponse.json({ success: true, access_token: accessToken });
  } catch (error) {
    console.error('Token exchange error:', error);
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 });
  }
}