import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUserBillingCycles } from '@/utils/billingCycles';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-api-response',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const billingCycles = await getAllUserBillingCycles(session.user.id);

    // Group by card for analysis
    const cyclesByCard: any = {};
    billingCycles.forEach(cycle => {
      const cardName = cycle.creditCardName || 'Unknown';
      if (!cyclesByCard[cardName]) {
        cyclesByCard[cardName] = [];
      }
      cyclesByCard[cardName].push({
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        totalSpend: cycle.totalSpend
      });
    });

    return NextResponse.json({
      success: true,
      message: 'API response debug',
      totalCycles: billingCycles.length,
      cyclesByCard,
      amexCount: cyclesByCard['Platinum Card®']?.length || 0,
      capOneCount: cyclesByCard['Quicksilver']?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Error in API response debug:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}