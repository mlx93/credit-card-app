import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST() {{
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-fix-cycles',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔧 FIX CYCLES DEBUG ENDPOINT CALLED');
    
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

    // Get sample transactions for each card
    const { data: allTransactions, error: transactionsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('creditCardId', (creditCards || []).map(card => card.id))
      .order('date', { ascending: false })
      .limit(100 * (creditCards || []).length);

    if (transactionsError) {
      throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
    }

    // Combine data
    const creditCardsWithData = (creditCards || []).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      const transactions = (allTransactions || [])
        .filter(t => t.creditCardId === card.id)
        .slice(0, 100); // Limit to 100 per card
      return { ...card, plaidItem, transactions };
    });

    console.log(`Found ${(creditCards || []).length} credit cards`);

    const results = [];
    
    for (const card of creditCardsWithData) {
      console.log(`\n=== Processing ${card.name} ===`);
      console.log(`Card has ${card.transactions.length} sample transactions (limited to 100)`);
      
      // Get transaction date range
      if (card.transactions.length > 0) {
        const dates = card.transactions.map(t => new Date(t.date));
        console.log('Transaction date range:', {
          newest: dates[0],
          oldest: dates[dates.length - 1]
        });
      }
      
      // Delete ALL existing billing cycles for this card to force complete regeneration
      const { error: deleteError } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .eq('creditCardId', card.id);

      if (deleteError) {
        console.error(`Failed to delete cycles for ${card.name}:`, deleteError);
      } else {
        console.log(`Deleted existing cycles for ${card.name}`);
      }
      
      // Regenerate cycles
      console.log('Regenerating cycles...');
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles`);
      
      // Analyze the results
      const historicalCycles = cycles.filter(c => c.statementBalance !== undefined && c.endDate < new Date());
      const uniqueAmounts = [...new Set(historicalCycles.map(c => c.statementBalance))];
      
      console.log('Cycle analysis:', {
        totalCycles: cycles.length,
        historicalCycles: historicalCycles.length,
        uniqueStatementAmounts: uniqueAmounts.length,
        amounts: uniqueAmounts.slice(0, 5) // Show first 5 unique amounts
      });
      
      // Check if all historical cycles have the same amount (the bug)
      const hasIssuue = uniqueAmounts.length === 1 && historicalCycles.length > 1;
      
      if (hasIssuue) {
        console.log('⚠️ ISSUE DETECTED: All historical cycles have the same amount:', uniqueAmounts[0]);
      } else {
        console.log('✅ Historical cycles have different amounts');
      }
      
      // Sample cycle details
      console.log('Sample historical cycles:');
      historicalCycles.slice(0, 3).forEach(c => {
        console.log({
          period: `${c.startDate.toLocaleDateString()} - ${c.endDate.toLocaleDateString()}`,
          statementBalance: c.statementBalance,
          totalSpend: c.totalSpend,
          transactionCount: c.transactionCount
        });
      });
      
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length,
        historicalCycles: historicalCycles.length,
        uniqueAmounts: uniqueAmounts.length,
        hasIssue: hasIssuue,
        sampleAmounts: uniqueAmounts.slice(0, 5),
        lastStatementBalance: card.lastStatementBalance
      });
    }

    console.log('\n🔧 FIX CYCLES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles fixed and regenerated',
      results 
    });
  } catch (error) {
    console.error('🔧 FIX CYCLES ERROR:', error);
    return NextResponse.json({ error: 'Failed to fix cycles' }, { status: 500 });
  }
}