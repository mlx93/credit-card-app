import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUserBillingCycles } from '@/utils/billingCycles';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const billingCycles = await getAllUserBillingCycles(session.user.id);

    return NextResponse.json({ billingCycles });
  } catch (error) {
    console.error('Error fetching billing cycles:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}