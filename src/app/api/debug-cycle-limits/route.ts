import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-cycle-limits',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 Debugging cycle limits...');
    
    // Get all billing cycles
    const { data: allCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .order('endDate', { ascending: false });

    if (cyclesError) {
      return NextResponse.json({ error: cyclesError.message }, { status: 500 });
    }

    // Group by card
    const cyclesByCard: any = {};
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    allCycles?.forEach(cycle => {
      const cardName = cycle.creditcardname || 'Unknown';
      if (!cyclesByCard[cardName]) {
        cyclesByCard[cardName] = {
          total: 0,
          within12Months: 0,
          cycles: []
        };
      }
      
      cyclesByCard[cardName].total++;
      
      if (new Date(cycle.endDate) >= twelveMonthsAgo) {
        cyclesByCard[cardName].within12Months++;
      }
      
      if (cyclesByCard[cardName].cycles.length < 10) {
        cyclesByCard[cardName].cycles.push({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          totalSpend: cycle.totalSpend,
          isWithin12Months: new Date(cycle.endDate) >= twelveMonthsAgo
        });
      }
    });

    // Check what the API is actually returning
    const { data: apiCycles } = await fetch(`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/billing-cycles`).then(r => r.json()).catch(() => ({ data: null }));
    
    return NextResponse.json({
      success: true,
      message: 'Cycle limit debugging completed',
      twelveMonthsAgo: twelveMonthsAgo.toISOString(),
      cyclesByCard,
      apiReturnedCount: apiCycles?.length || 'Could not fetch',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Cycle limit debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}