import { NextRequest, NextResponse } from 'next/server';
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

    // Debug logging to compare with debug endpoint
    const amexCycles = billingCycles.filter(c => 
      c.creditCardName?.toLowerCase().includes('platinum')
    );
    
    console.log('🔍 USER BILLING CYCLES API:', {
      userId: session.user.id,
      totalCycles: billingCycles.length,
      amexCycles: amexCycles.length,
      amexCycleIds: amexCycles.slice(0, 5).map(c => ({
        id: c.id?.substring(0, 8),
        startDate: c.startDate,
        endDate: c.endDate
      }))
    });

    return NextResponse.json({ billingCycles });
  } catch (error) {
    console.error('Error fetching billing cycles:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}