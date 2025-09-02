import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-force-fix-boa-date',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔧 FORCE FIX BOA DATE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Find the Bank of America Customized Cash Rewards card specifically
    const { data: boaCards, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .ilike('name', '%Customized Cash Rewards%');

    if (cardError) {
      throw new Error(`Failed to fetch credit cards: ${cardError.message}`);
    }

    const boaCard = boaCards?.[0];

    // Get plaid item info for the card
    const plaidItem = plaidItems?.find(item => item.id === boaCard?.plaidItemId);

    // Get earliest transaction for the card
    let earliestTransaction = null;
    if (boaCard) {
      const { data: transactions, error: txnError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('accountId', boaCard.accountId)
        .order('date', { ascending: true })
        .limit(1);

      if (txnError) {
        throw new Error(`Failed to fetch transactions: ${txnError.message}`);
      }

      earliestTransaction = transactions?.[0];
    }

    if (!boaCard) {
      return NextResponse.json({ error: 'Bank of America Customized Cash Rewards card not found' }, { status: 404 });
    }

    console.log('Found BoA card:', {
      id: boaCard.id,
      name: boaCard.name,
      currentOpenDate: boaCard.openDate,
      institutionName: plaidItem?.institutionName,
      hasTransaction: !!earliestTransaction
    });

    if (!earliestTransaction) {
      return NextResponse.json({ error: 'No transactions found for this card' }, { status: 400 });
    }
    const correctedOpenDate = new Date(earliestTransaction.date);
    correctedOpenDate.setDate(correctedOpenDate.getDate() - 7);

    console.log('Attempting to update BoA card with corrected date:', {
      cardId: boaCard.id,
      earliestTransactionDate: new Date(earliestTransaction.date).toDateString(),
      correctedOpenDate: correctedOpenDate.toDateString()
    });

    // Force update the card
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({ 
        openDate: correctedOpenDate.toISOString(),
        updatedAt: new Date().toISOString()
      })
      .eq('id', boaCard.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update card: ${updateError.message}`);
    }

    // Delete all billing cycles for this card
    const { error: deleteError, count: deletedCount } = await supabaseAdmin
      .from('billing_cycles')
      .delete()
      .eq('creditCardId', boaCard.id);

    if (deleteError) {
      throw new Error(`Failed to delete billing cycles: ${deleteError.message}`);
    }

    const updateResult = { updatedCard, deletedCycles: deletedCount || 0 };

    console.log('Database update completed:', {
      updatedCardOpenDate: updateResult.updatedCard.openDate,
      deletedCycles: updateResult.deletedCycles
    });

    // Now trigger billing cycle regeneration
    console.log('Triggering billing cycle regeneration...');
    try {
      const regenResponse = await fetch(`${process.env.NEXTAUTH_URL}/api/billing-cycles/regenerate`, {
        method: 'POST'
      });
      
      if (regenResponse.ok) {
        console.log('✅ Billing cycles regenerated successfully');
      } else {
        console.warn('⚠️ Billing cycle regeneration failed');
      }
    } catch (regenError) {
      console.error('Error regenerating billing cycles:', regenError);
    }

    console.log('🔧 FORCE BOA DATE FIX COMPLETED');
    
    return NextResponse.json({ 
      message: 'BoA card open date forcefully corrected',
      cardName: boaCard.name,
      oldOpenDate: boaCard.openDate?.toDateString() || 'null',
      newOpenDate: correctedOpenDate.toDateString(),
      earliestTransactionDate: new Date(earliestTransaction.date).toDateString(),
      deletedCycles: updateResult.deletedCycles,
      billingCyclesRegenerated: true
    });

  } catch (error) {
    console.error('🔧 FORCE FIX BOA DATE ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to force fix BoA date',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}