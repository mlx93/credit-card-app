import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-regenerate-cycles',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔄 REGENERATE CYCLES DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Fetching all credit cards for user:', session.user.id);
    
    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Add plaidItem reference to each card
    const creditCardsWithPlaidItem = (creditCards || []).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      return { ...card, plaidItem };
    });

    console.log(`Found ${(creditCards || []).length} credit cards`);

    // Delete existing billing cycles to force regeneration
    console.log('Deleting existing billing cycles...');
    const { error: deleteError } = await supabaseAdmin
      .from('billing_cycles')
      .delete()
      .in('creditCardId', (creditCards || []).map(card => card.id));

    if (deleteError) {
      console.error('Error deleting existing cycles:', deleteError);
    } else {
      console.log('Deleted existing billing cycles');
    }

    // Regenerate billing cycles for each credit card
    const results = [];
    for (const card of creditCardsWithPlaidItem) {
      console.log(`Regenerating cycles for ${card.name}...`);
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles for ${card.name}`);
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length
      });
    }

    console.log('🔄 REGENERATE CYCLES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles regenerated successfully',
      results 
    });
  } catch (error) {
    console.error('🔄 REGENERATE CYCLES ERROR:', error);
    return NextResponse.json({ error: 'Failed to regenerate cycles' }, { status: 500 });
  }
}