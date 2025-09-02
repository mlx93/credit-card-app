import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-fix-incorrect-open-dates',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔧 FIX INCORRECT OPEN DATES ENDPOINT CALLED');
    
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
    
    // Get all credit cards
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Get earliest transaction for each card
    const allCards = await Promise.all(
      (creditCards || []).map(async (card) => {
        const { data: transactions, error: txnError } = await supabaseAdmin
          .from('transactions')
          .select('*')
          .eq('creditCardId', card.id)
          .order('date', { ascending: true })
          .limit(1);

        if (txnError) {
          throw new Error(`Failed to fetch transactions for card ${card.id}: ${txnError.message}`);
        }

        const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
        
        return {
          ...card,
          plaidItem: { institutionName: plaidItem?.institutionName },
          transactions: transactions || []
        };
      })
    );

    console.log(`Found ${allCards.length} total cards to check`);

    const fixes = [];

    for (const card of allCards) {
      if (card.transactions.length > 0 && card.openDate) {
        const earliestTransaction = card.transactions[0];
        const currentOpenDate = new Date(card.openDate);
        const earliestTransactionDate = new Date(earliestTransaction.date);
        
        // If open date is more than 30 days before earliest transaction, it's likely wrong
        const daysDifference = Math.abs((earliestTransactionDate.getTime() - currentOpenDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDifference > 90) { // More than 3 months difference suggests wrong open date
          console.log(`Card ${card.name} has suspicious open date:`, {
            cardName: card.name,
            currentOpenDate: currentOpenDate.toDateString(),
            earliestTransactionDate: earliestTransactionDate.toDateString(),
            daysDifference: Math.round(daysDifference)
          });
          
          // Use earliest transaction date minus 7 days as corrected open date
          const correctedOpenDate = new Date(earliestTransactionDate);
          correctedOpenDate.setDate(correctedOpenDate.getDate() - 7);
          
          console.log(`Correcting open date for ${card.name} from ${currentOpenDate.toDateString()} to ${correctedOpenDate.toDateString()}`);

          // Update the card with the corrected open date
          const { error: updateError } = await supabaseAdmin
            .from('credit_cards')
            .update({ openDate: correctedOpenDate.toISOString() })
            .eq('id', card.id);

          if (updateError) {
            throw new Error(`Failed to update card ${card.id}: ${updateError.message}`);
          }

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            oldOpenDate: currentOpenDate.toDateString(),
            newOpenDate: correctedOpenDate.toDateString(),
            earliestTransactionDate: earliestTransactionDate.toDateString(),
            daysDifferenceFound: Math.round(daysDifference),
            transactionUsed: {
              name: earliestTransaction.name,
              amount: earliestTransaction.amount,
              date: new Date(earliestTransaction.date).toDateString()
            }
          });
        }
      }
    }

    // After fixing open dates, regenerate billing cycles
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration with corrected open dates...');
      
      // Get all credit card IDs for this user
      const creditCardIds = (creditCards || []).map(card => card.id);
      
      const { error: deleteError, count: deletedCount } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .in('creditCardId', creditCardIds);

      if (deleteError) {
        throw new Error(`Failed to delete billing cycles: ${deleteError.message}`);
      }

      const deleteResult = { count: deletedCount || 0 };
      
      console.log(`Deleted ${deleteResult.count} billing cycles`);

      // Trigger billing cycle regeneration
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
    }

    console.log('🔧 INCORRECT OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Incorrect open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesRegenerated: fixes.length > 0
    });

  } catch (error) {
    console.error('🔧 FIX INCORRECT OPEN DATES ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix incorrect open dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}