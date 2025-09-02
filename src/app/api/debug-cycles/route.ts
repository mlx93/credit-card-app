import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-cycles',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 Debugging billing cycle generation...');
    
    // Get all credit cards
    const { data: cards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask, lastStatementIssueDate');

    if (cardsError) {
      return NextResponse.json({ error: cardsError.message }, { status: 500 });
    }

    const results = [];
    
    for (const card of cards || []) {
      console.log(`\n📊 Attempting to generate cycles for ${card.name}...`);
      
      try {
        // Try to generate billing cycles
        const cycles = await calculateBillingCycles(card.id);
        
        results.push({
          card: card.name,
          success: true,
          cyclesGenerated: cycles.length,
          cycles: cycles.slice(0, 3).map(c => ({
            startDate: c.startDate,
            endDate: c.endDate,
            totalSpend: c.totalSpend,
            transactionCount: c.transactionCount
          }))
        });
        
        console.log(`✅ Generated ${cycles.length} cycles for ${card.name}`);
      } catch (error: any) {
        console.error(`❌ Failed for ${card.name}:`, error);
        
        results.push({
          card: card.name,
          success: false,
          error: error.message,
          stack: error.stack
        });
      }
    }

    // Check what's actually in the billing_cycles table
    const { data: existingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('creditCardName, startDate, endDate, totalSpend')
      .order('startDate', { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      message: 'Billing cycle debugging completed',
      generationAttempts: results,
      existingCyclesInDB: {
        count: existingCycles?.length || 0,
        samples: existingCycles || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Cycle debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}