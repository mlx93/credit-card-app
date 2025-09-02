import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-final',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 Final debugging - checking actual cycle counts and payment status...');
    
    // Get all billing cycles for both cards
    const { data: allCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .order('endDate', { ascending: false });

    // Get card data  
    const { data: cards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*');

    if (cyclesError || cardsError) {
      return NextResponse.json({ error: cyclesError?.message || cardsError?.message }, { status: 500 });
    }

    const amexCard = cards?.find(c => c.name.toLowerCase().includes('platinum'));
    const capOneCard = cards?.find(c => c.name.toLowerCase().includes('quicksilver'));

    const amexCycles = allCycles?.filter(c => 
      c.creditcardname?.toLowerCase().includes('platinum')
    ) || [];
    
    const capOneCycles = allCycles?.filter(c => 
      c.creditcardname?.toLowerCase().includes('quicksilver')
    ) || [];

    // Check 12-month cutoff
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // Analyze Amex cycles
    const amexAnalysis = {
      cardOpenDate: amexCard?.openDate,
      totalCycles: amexCycles.length,
      cyclesWithin12Months: amexCycles.filter(c => 
        new Date(c.endDate) >= twelveMonthsAgo
      ).length,
      twelveMonthCutoff: twelveMonthsAgo.toISOString(),
      allCycleDates: amexCycles.map(c => ({
        startDate: c.startDate,
        endDate: c.endDate,
        totalSpend: c.totalSpend,
        withinTwelveMonths: new Date(c.endDate) >= twelveMonthsAgo
      }))
    };

    // Analyze Capital One payment status
    const capOneAug28Cycle = capOneCycles.find(c => 
      c.endDate === '2025-08-28T00:00:00'
    );

    const capOneAnalysis = {
      cardBalance: capOneCard?.balanceCurrent,
      hasZeroBalance: Math.abs(capOneCard?.balanceCurrent || 0) < 0.01,
      aug28Cycle: capOneAug28Cycle ? {
        id: capOneAug28Cycle.id.substring(0, 8),
        endDate: capOneAug28Cycle.endDate,
        statementBalance: capOneAug28Cycle.statementBalance,
        shouldShowAsPaid: Math.abs(capOneCard?.balanceCurrent || 0) < 0.01,
        hasStatementData: capOneAug28Cycle.statementBalance !== null && capOneAug28Cycle.statementBalance !== undefined
      } : null
    };

    return NextResponse.json({
      success: true,
      message: 'Final debug completed',
      amexAnalysis,
      capOneAnalysis,
      summary: {
        amexIssue: amexAnalysis.cyclesWithin12Months > 4 ? 
          'API has more cycles than UI shows - frontend filtering issue' : 
          'API also has limited cycles - cycle generation issue',
        capOneIssue: capOneAnalysis.hasZeroBalance && capOneAnalysis.aug28Cycle ? 
          'Card has $0 balance but cycle may not be identified as paid in frontend' : 
          'Payment status logic should work'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Final debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}