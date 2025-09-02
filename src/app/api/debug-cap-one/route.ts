import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-cap-one',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🎯 Debugging Capital One cycle ordering...');
    
    // Get Capital One cycles sorted by different fields
    const { data: cyclesByStartDate, error: error1 } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .ilike('creditcardname', '%quicksilver%')
      .order('startDate', { ascending: false });

    const { data: cyclesByEndDate, error: error2 } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .ilike('creditcardname', '%quicksilver%')
      .order('endDate', { ascending: false });

    if (error1 || error2) {
      return NextResponse.json({ error: error1?.message || error2?.message }, { status: 500 });
    }

    const analysis = {
      totalCycles: cyclesByStartDate?.length || 0,
      sortedByStartDate: cyclesByStartDate?.map(c => ({
        id: c.id.substring(0, 8),
        startDate: c.startDate,
        endDate: c.endDate,
        totalSpend: c.totalSpend,
        statementBalance: c.statementBalance,
        startTimestamp: new Date(c.startDate).getTime(),
        endTimestamp: new Date(c.endDate).getTime()
      })) || [],
      sortedByEndDate: cyclesByEndDate?.map(c => ({
        id: c.id.substring(0, 8),
        startDate: c.startDate,
        endDate: c.endDate,
        totalSpend: c.totalSpend,
        statementBalance: c.statementBalance,
        startTimestamp: new Date(c.startDate).getTime(),
        endTimestamp: new Date(c.endDate).getTime()
      })) || [],
      problemCycles: cyclesByStartDate?.filter(c => 
        c.endDate?.includes('2025-08-27') || c.endDate?.includes('2025-06-28')
      ).map(c => ({
        id: c.id.substring(0, 8),
        startDate: c.startDate,
        endDate: c.endDate,
        startTimestamp: new Date(c.startDate).getTime(),
        shouldSortFirst: c.endDate?.includes('2025-08-27')
      })) || []
    };

    return NextResponse.json({
      success: true,
      message: 'Capital One cycle ordering debug completed',
      cardInfo: {
        lastStatementIssueDate: '2025-08-28T00:00:00',
        expectedClosedCycle: 'Jul 29 - Aug 27 (should be first in historical)',
        expectedOlderCycle: 'May 30 - Jun 28 (should be second in historical)'
      },
      analysis,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Capital One debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}