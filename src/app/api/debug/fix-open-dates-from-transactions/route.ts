import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST() {{
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-fix-open-dates-from-transactions',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔧 FIX OPEN DATES FROM TRANSACTIONS ENDPOINT CALLED');
    
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
    
    // Find cards without open dates
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .is('openDate', null);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Get earliest transaction for each card without open dates
    const cardsWithoutOpenDates = await Promise.all(
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

    console.log(`Found ${cardsWithoutOpenDates.length} cards without open dates`);

    const fixes = [];

    for (const card of cardsWithoutOpenDates) {
      if (card.transactions.length > 0) {
        const earliestTransaction = card.transactions[0];
        const estimatedOpenDate = new Date(earliestTransaction.date);
        
        // Move the estimated open date back by a few days to be conservative
        // (first transaction might not be the very first day the card was opened)
        estimatedOpenDate.setDate(estimatedOpenDate.getDate() - 7);
        
        console.log(`Setting open date for ${card.name} based on earliest transaction:`, {
          cardName: card.name,
          earliestTransactionDate: new Date(earliestTransaction.date).toDateString(),
          earliestTransactionName: earliestTransaction.name,
          estimatedOpenDate: estimatedOpenDate.toDateString()
        });

        // Update the card with the estimated open date
        const { error: updateError1 } = await supabaseAdmin
          .from('credit_cards')
          .update({ openDate: estimatedOpenDate.toISOString() })
          .eq('id', card.id);

        if (updateError1) {
          throw new Error(`Failed to update card ${card.id}: ${updateError1.message}`);
        }

        fixes.push({
          cardName: card.name,
          institutionName: card.plaidItem?.institutionName,
          method: 'earliest_transaction',
          earliestTransactionDate: new Date(earliestTransaction.date).toDateString(),
          estimatedOpenDate: estimatedOpenDate.toDateString(),
          transactionUsed: {
            name: earliestTransaction.name,
            amount: earliestTransaction.amount,
            date: new Date(earliestTransaction.date).toDateString()
          }
        });
      } else {
        // No transactions available - use statement date as fallback
        if (card.lastStatementIssueDate) {
          const statementDate = new Date(card.lastStatementIssueDate);
          const estimatedOpenDate = new Date(statementDate);
          estimatedOpenDate.setMonth(estimatedOpenDate.getMonth() - 6); // 6 months before first statement

          console.log(`Setting open date for ${card.name} based on statement date:`, {
            cardName: card.name,
            lastStatementDate: new Date(card.lastStatementIssueDate).toDateString(),
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });

          const { error: updateError2 } = await supabaseAdmin
            .from('credit_cards')
            .update({ openDate: estimatedOpenDate.toISOString() })
            .eq('id', card.id);

          if (updateError2) {
            throw new Error(`Failed to update card ${card.id}: ${updateError2.message}`);
          }

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            method: 'statement_date_minus_6_months',
            lastStatementDate: new Date(card.lastStatementIssueDate).toDateString(),
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });
        } else {
          // Last resort - use current date minus 1 year
          const estimatedOpenDate = new Date();
          estimatedOpenDate.setFullYear(estimatedOpenDate.getFullYear() - 1);

          console.log(`Setting fallback open date for ${card.name}:`, {
            cardName: card.name,
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });

          const { error: updateError2 } = await supabaseAdmin
            .from('credit_cards')
            .update({ openDate: estimatedOpenDate.toISOString() })
            .eq('id', card.id);

          if (updateError2) {
            throw new Error(`Failed to update card ${card.id}: ${updateError2.message}`);
          }

          fixes.push({
            cardName: card.name,
            institutionName: card.plaidItem?.institutionName,
            method: 'fallback_1_year_ago',
            estimatedOpenDate: estimatedOpenDate.toDateString()
          });
        }
      }
    }

    // After fixing open dates, we should regenerate billing cycles
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration with correct open dates...');
      
      // Get all credit card IDs for this user to delete their billing cycles
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

    console.log('🔧 OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesRegenerated: fixes.length > 0
    });

  } catch (error) {
    console.error('🔧 FIX OPEN DATES FROM TRANSACTIONS ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix open dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}