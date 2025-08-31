import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    console.log('🔧 FIX FUTURE DATES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    
    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, institutionName')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards for the user
    const { data: allCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Filter cards with future dates (Supabase doesn't support complex OR with nested conditions)
    const futureYearThreshold = new Date(currentYear + 1, 0, 1);
    const cardsWithFutureDates = (allCards || []).filter(card => {
      const hasOpenDate = card.openDate && new Date(card.openDate) > now;
      const hasStatementDate = card.lastStatementIssueDate && new Date(card.lastStatementIssueDate) > now;
      const hasFutureDueDate = card.nextPaymentDueDate && new Date(card.nextPaymentDueDate) > futureYearThreshold;
      return hasOpenDate || hasStatementDate || hasFutureDueDate;
    }).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      return { ...card, plaidItem };
    });

    console.log(`Found ${cardsWithFutureDates.length} cards with future dates`);

    const fixes = [];
    
    for (const card of cardsWithFutureDates) {
      const updates: any = {};
      let fixesApplied = [];
      
      // Fix future open date
      if (card.openDate && new Date(card.openDate) > now) {
        const correctedOpenDate = new Date(card.openDate);
        // If year is 2025+, change to 2024, if still future, change to 2023
        if (correctedOpenDate.getFullYear() >= 2025) {
          correctedOpenDate.setFullYear(2024);
        }
        if (correctedOpenDate > now) {
          correctedOpenDate.setFullYear(2023);
        }
        
        updates.openDate = correctedOpenDate.toISOString();
        fixesApplied.push(`Open date: ${new Date(card.openDate).toDateString()} → ${correctedOpenDate.toDateString()}`);
      }
      
      // Fix future statement date
      if (card.lastStatementIssueDate && new Date(card.lastStatementIssueDate) > now) {
        const correctedStatementDate = new Date(card.lastStatementIssueDate);
        // If year is 2025+, change to 2024, if still future, go back further
        if (correctedStatementDate.getFullYear() >= 2025) {
          correctedStatementDate.setFullYear(2024);
        }
        if (correctedStatementDate > now) {
          // Move back a few months to ensure it's in the past
          correctedStatementDate.setMonth(correctedStatementDate.getMonth() - 3);
        }
        
        updates.lastStatementIssueDate = correctedStatementDate.toISOString();
        fixesApplied.push(`Statement date: ${new Date(card.lastStatementIssueDate).toDateString()} → ${correctedStatementDate.toDateString()}`);
      }
      
      // Fix future due date (if more than 1 year in future)
      if (card.nextPaymentDueDate && new Date(card.nextPaymentDueDate) > new Date(currentYear + 1, 0, 1)) {
        const correctedDueDate = new Date(card.nextPaymentDueDate);
        if (correctedDueDate.getFullYear() >= 2025) {
          correctedDueDate.setFullYear(2024);
        }
        // Due dates can be in the future, but not more than a few months
        const maxFuture = new Date();
        maxFuture.setMonth(maxFuture.getMonth() + 3);
        if (correctedDueDate > maxFuture) {
          correctedDueDate.setFullYear(2024);
          correctedDueDate.setMonth(correctedDueDate.getMonth() - 6);
        }
        
        updates.nextPaymentDueDate = correctedDueDate.toISOString();
        fixesApplied.push(`Due date: ${new Date(card.nextPaymentDueDate).toDateString()} → ${correctedDueDate.toDateString()}`);
      }
      
      // Add default open date if missing
      if (!card.openDate && card.lastStatementIssueDate) {
        // Estimate open date as 6 months before the corrected statement date
        const estimatedOpenDate = new Date(updates.lastStatementIssueDate || card.lastStatementIssueDate);
        estimatedOpenDate.setMonth(estimatedOpenDate.getMonth() - 6);
        
        updates.openDate = estimatedOpenDate.toISOString();
        fixesApplied.push(`Added estimated open date: ${estimatedOpenDate.toDateString()}`);
      }
      
      if (Object.keys(updates).length > 0) {
        console.log(`Fixing ${card.name}:`, fixesApplied);
        
        const { error: updateError } = await supabaseAdmin
          .from('credit_cards')
          .update(updates)
          .eq('id', card.id);

        if (updateError) {
          console.error(`Failed to update card ${card.id}:`, updateError);
          continue;
        }
        
        fixes.push({
          cardName: card.name,
          institutionName: card.plaidItem?.institutionName,
          fixesApplied
        });
      }
    }

    // After fixing dates, delete all existing billing cycles so they can be regenerated
    if (fixes.length > 0) {
      console.log('Deleting existing billing cycles to force regeneration...');
      
      // Get all credit card IDs for the user
      const cardIds = (allCards || []).map(card => card.id);
      
      const { error: deleteError } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .in('creditCardId', cardIds);

      if (deleteError) {
        console.error('Error deleting billing cycles:', deleteError);
      } else {
        console.log('Deleted existing billing cycles for regeneration');
      }
    }

    console.log('🔧 FUTURE DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Future dates fixed successfully',
      fixesApplied: fixes.length,
      fixes,
      billingCyclesDeleted: fixes.length > 0 ? 'All existing cycles deleted for regeneration' : 'No cycles deleted'
    });
  } catch (error) {
    console.error('🔧 FIX FUTURE DATES ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to fix future dates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}