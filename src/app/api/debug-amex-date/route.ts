import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Debugging Amex open date and Capital One cycle classification...');
    
    // Check current Amex open date
    const { data: amexCard, error: amexError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .ilike('name', '%platinum%')
      .single();

    // Check Capital One cycles and their classification
    const { data: capOneCycles, error: capOneError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .ilike('creditcardname', '%quicksilver%')
      .order('endDate', { ascending: false });

    if (amexError || capOneError) {
      return NextResponse.json({ 
        error: amexError?.message || capOneError?.message 
      }, { status: 500 });
    }

    // Calculate what should be current vs historical for Capital One
    const today = new Date();
    const capOneAnalysis = capOneCycles?.map(cycle => {
      const endDate = new Date(cycle.endDate);
      const startDate = new Date(cycle.startDate);
      const hasStatement = cycle.statementBalance && cycle.statementBalance > 0;
      const isCompleted = endDate < today;
      
      return {
        id: cycle.id.substring(0, 8),
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        statementBalance: cycle.statementBalance,
        hasStatement,
        isCompleted,
        shouldBeClassifiedAs: 
          !isCompleted ? 'current' :
          hasStatement ? 'recent-closed' : 
          'historical'
      };
    }) || [];

    // Check 12-month cutoff for Amex
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const amexCycleCount = await supabaseAdmin
      .from('billing_cycles')
      .select('*', { count: 'exact' })
      .ilike('creditcardname', '%platinum%')
      .gte('endDate', twelveMonthsAgo.toISOString());

    return NextResponse.json({
      success: true,
      message: 'Debug analysis completed',
      amexAnalysis: {
        currentOpenDate: amexCard?.openDate,
        shouldBeOpenDate: '~2024-06-01 (14 months before Aug 2025 statement)',
        lastStatementDate: amexCard?.lastStatementIssueDate,
        twelveMonthsCutoff: twelveMonthsAgo.toISOString(),
        cyclesWithin12Months: amexCycleCount.count,
        openDateWasUpdated: amexCard?.openDate !== '2025-02-19T00:00:00'
      },
      capitalOneAnalysis: {
        totalCycles: capOneAnalysis.length,
        lastStatementDate: '2025-08-28T00:00:00',
        cycleClassification: capOneAnalysis,
        expectedMostRecentClosed: 'Jul 30 - Aug 28 (ends on statement date)',
        issue: 'Aug 28 cycle should be "recent-closed", not "historical"'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}