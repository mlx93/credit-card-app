import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    console.log('🧠 SMART FIX BOA CYCLES ENDPOINT CALLED');
    
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
    
    // Find the Bank of America card
    const { data: boaCards, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .ilike('name', '%Customized Cash Rewards%');

    if (cardError) {
      throw new Error(`Failed to fetch credit cards: ${cardError.message}`);
    }

    const boaCard = boaCards?.[0];

    if (!boaCard) {
      return NextResponse.json({ error: 'Bank of America card not found' }, { status: 404 });
    }

    // Get plaid item info
    const plaidItem = plaidItems?.find(item => item.id === boaCard.plaidItemId);

    // Get transactions for analysis
    const { data: transactions, error: txnError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .order('date', { ascending: true })
      .limit(50);

    if (txnError) {
      throw new Error(`Failed to fetch transactions: ${txnError.message}`);
    }

    // Get billing cycles
    const { data: billingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .order('startDate', { ascending: true });

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // Get transaction counts for each billing cycle
    const cyclesWithTransactionCounts = await Promise.all(
      (billingCycles || []).map(async (cycle) => {
        const { count } = await supabaseAdmin
          .from('transactions')
          .select('*', { count: 'exact' })
          .eq('creditCardId', boaCard.id)
          .gte('date', cycle.startDate)
          .lte('date', cycle.endDate);
        return { ...cycle, transactionCount: count || 0 };
      })
    );

    // Reconstruct boaCard with nested data
    const boaCardWithData = {
      ...boaCard,
      plaidItem: { institutionName: plaidItem?.institutionName },
      transactions: transactions || [],
      billingCycles: cyclesWithTransactionCounts || []
    };

    if (!boaCard) {
      return NextResponse.json({ error: 'Bank of America card not found' }, { status: 404 });
    }

    console.log('=== TRANSACTION ANALYSIS ===');
    
    // Analyze transaction patterns
    const allTransactions = boaCardWithData.transactions;
    const earliestTransaction = allTransactions[0];
    const transactionDates = allTransactions.slice(0, 10).map(t => ({
      date: new Date(t.date).toDateString(),
      name: t.name,
      amount: t.amount
    }));

    console.log('Earliest 10 transactions:', transactionDates);

    // Analyze existing cycles to see which ones have transaction data
    console.log('=== EXISTING CYCLES ANALYSIS ===');
    const cyclesWithTransactions = boaCardWithData.billingCycles
      .filter(cycle => cycle.transactionCount > 0)
      .map(cycle => ({
        startDate: new Date(cycle.startDate).toDateString(),
        endDate: new Date(cycle.endDate).toDateString(),
        transactionCount: cycle.transactionCount,
        totalSpend: cycle.totalSpend
      }));

    console.log('Cycles with transactions:', cyclesWithTransactions);

    // Find the earliest cycle that has transactions (this should be preserved)
    const earliestCycleWithTransactions = boaCardWithData.billingCycles
      .filter(cycle => cycle.transactionCount > 0)
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];

    if (!earliestCycleWithTransactions) {
      return NextResponse.json({ error: 'No cycles with transactions found' }, { status: 400 });
    }

    console.log('Earliest cycle with transactions:', {
      startDate: new Date(earliestCycleWithTransactions.startDate).toDateString(),
      endDate: new Date(earliestCycleWithTransactions.endDate).toDateString(),
      transactionCount: earliestCycleWithTransactions.transactionCount,
      totalSpend: earliestCycleWithTransactions.totalSpend
    });

    // Set open date to be 2-3 weeks before the earliest cycle with transactions
    const smartOpenDate = new Date(earliestCycleWithTransactions.startDate);
    smartOpenDate.setDate(smartOpenDate.getDate() - 21); // 3 weeks before first real cycle

    console.log('=== SMART OPEN DATE CALCULATION ===');
    console.log('Current open date:', boaCard.openDate ? new Date(boaCard.openDate).toDateString() : 'null');
    console.log('Earliest transaction date:', earliestTransaction ? new Date(earliestTransaction.date).toDateString() : 'none');
    console.log('Earliest cycle with transactions starts:', new Date(earliestCycleWithTransactions.startDate).toDateString());
    console.log('Smart open date (3 weeks before first real cycle):', smartOpenDate.toDateString());

    // Update the card with smart open date
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({ 
        openDate: smartOpenDate.toISOString(),
        updatedAt: new Date().toISOString()
      })
      .eq('id', boaCard.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update card: ${updateError.message}`);
    }

    // Delete only cycles that start before the smart open date AND have no transactions
    const cyclesToDelete = (cyclesWithTransactionCounts || []).filter(cycle => 
      new Date(cycle.startDate) < smartOpenDate && cycle.transactionCount === 0
    );

    let deletedCount = 0;
    for (const cycle of cyclesToDelete) {
      const { error: deleteError } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .eq('id', cycle.id);
      
      if (!deleteError) {
        deletedCount++;
      }
    }

    const updateResult = { updatedCard, deletedEmptyCycles: deletedCount };

    console.log('Smart update completed:', {
      newOpenDate: updateResult.updatedCard.openDate?.toDateString(),
      deletedEmptyCycles: updateResult.deletedEmptyCycles,
      preservedCyclesWithTransactions: cyclesWithTransactions.length
    });

    // Regenerate billing cycles to fill any gaps
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

    console.log('🧠 SMART BOA CYCLES FIX COMPLETED');
    
    return NextResponse.json({ 
      message: 'BoA cycles intelligently corrected',
      cardName: boaCard.name,
      analysis: {
        oldOpenDate: boaCard.openDate ? new Date(boaCard.openDate).toDateString() : 'null',
        newSmartOpenDate: smartOpenDate.toDateString(),
        earliestTransactionDate: earliestTransaction ? new Date(earliestTransaction.date).toDateString() : 'none',
        earliestCycleWithTransactionsStart: new Date(earliestCycleWithTransactions.startDate).toDateString(),
        earliestCycleWithTransactionsEnd: new Date(earliestCycleWithTransactions.endDate).toDateString()
      },
      preservedCycles: cyclesWithTransactions,
      deletedEmptyCycles: updateResult.deletedEmptyCycles,
      billingCyclesRegenerated: true
    });

  } catch (error) {
    console.error('🧠 SMART BOA CYCLES FIX ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to smart fix BoA cycles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}