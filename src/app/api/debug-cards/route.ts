import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-cards',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 Debugging credit card data...');
    
    // Get all credit cards with their essential data
    const { data: cards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select(`
        id, name, mask, 
        lastStatementIssueDate, nextPaymentDueDate, openDate,
        lastStatementBalance, minimumPaymentAmount,
        plaid_items (id, institutionName, status)
      `);

    if (cardsError) {
      return NextResponse.json({ error: cardsError.message }, { status: 500 });
    }

    // Analyze each card's data
    const analysis = cards?.map(card => ({
      name: card.name,
      mask: card.mask,
      hasLastStatementDate: !!card.lastStatementIssueDate,
      hasNextDueDate: !!card.nextPaymentDueDate,
      hasOpenDate: !!card.openDate,
      lastStatementIssueDate: card.lastStatementIssueDate,
      nextPaymentDueDate: card.nextPaymentDueDate,
      openDate: card.openDate,
      institution: card.plaid_items?.institutionName,
      status: card.plaid_items?.status,
      billingCycleGenerationEligible: !!card.lastStatementIssueDate || !!card.openDate
    })) || [];

    return NextResponse.json({
      success: true,
      message: 'Credit card debugging completed',
      cards: analysis,
      summary: {
        total: analysis.length,
        withStatementDate: analysis.filter(c => c.hasLastStatementDate).length,
        withOpenDate: analysis.filter(c => c.hasOpenDate).length,
        eligible: analysis.filter(c => c.billingCycleGenerationEligible).length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Card debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}