import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 BILLING CYCLES REGENERATION CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all plaid items for the user first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards for this user
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Create a map for plaid item lookup
    const plaidItemMap = new Map();
    (plaidItems || []).forEach(item => {
      plaidItemMap.set(item.id, item);
    });

    // Add plaidItem reference to each credit card for compatibility
    const creditCardsWithPlaidItem = (creditCards || []).map(card => ({
      ...card,
      plaidItem: plaidItemMap.get(card.plaidItemId)
    }));

    console.log(`Found ${(creditCards || []).length} credit cards for user`);

    // Delete existing billing cycles to force regeneration
    console.log('Deleting existing billing cycles...');
    const creditCardIds = (creditCards || []).map(card => card.id);
    
    const { error: deleteError, count: deleteCount } = await supabaseAdmin
      .from('billing_cycles')
      .delete()
      .in('creditCardId', creditCardIds);

    if (deleteError) {
      console.error('Failed to delete existing billing cycles:', deleteError);
    } else {
      console.log(`Deleted ${deleteCount || 0} existing billing cycles`);
    }

    // Regenerate billing cycles for each credit card
    const results = [];
    for (const card of (creditCards || [])) {
      console.log(`Regenerating cycles for ${card.name}...`);
      
      // First, ensure transactions are properly linked
      const { data: unlinkedTransactions, error: unlinkedError } = await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('plaidItemId', card.plaidItemId)
        .is('creditCardId', null);

      if (unlinkedError) {
        console.error('Failed to fetch unlinked transactions:', unlinkedError);
      } else if ((unlinkedTransactions || []).length > 0) {
        console.log(`Found ${unlinkedTransactions.length} unlinked transactions, linking them to ${card.name}...`);
        
        // Link transactions to the credit card based on plaidItemId
        // Since we already filtered for transactions with the same plaidItemId and no creditCardId,
        // and we're processing cards one by one, these unlinked transactions likely belong to this card
        for (const transaction of unlinkedTransactions) {
          // For now, link all unlinked transactions from the same plaidItem to this card
          // This assumes one credit card per plaidItem, which is typical
          const { error: linkError } = await supabaseAdmin
            .from('transactions')
            .update({ creditCardId: card.id })
            .eq('id', transaction.id);
            
          if (linkError) {
            console.error(`Failed to link transaction ${transaction.id}:`, linkError);
          } else {
            console.log(`Linked transaction ${transaction.id} to credit card ${card.name}`);
          }
        }
      }
      
      const cycles = await calculateBillingCycles(card.id);
      console.log(`Generated ${cycles.length} cycles for ${card.name}`);
      
      // Log cycle details for debugging
      const historicalCycles = cycles.filter(c => c.statementBalance !== undefined);
      const currentCycle = cycles.find(c => !c.statementBalance && c.endDate > new Date());
      
      console.log(`Historical cycles with spend data: ${historicalCycles.length}`);
      console.log(`Current cycle found: ${currentCycle ? 'Yes' : 'No'}`);
      
      if (historicalCycles.length > 0) {
        console.log('Sample historical cycles:', historicalCycles.slice(0, 3).map(c => ({
          period: `${c.startDate.toLocaleDateString()} - ${c.endDate.toLocaleDateString()}`,
          totalSpend: c.totalSpend,
          transactionCount: c.transactionCount,
          statementBalance: c.statementBalance
        })));
      }
      
      results.push({
        cardName: card.name,
        cyclesGenerated: cycles.length,
        historicalCyclesWithData: historicalCycles.length,
        currentCycle: currentCycle ? {
          totalSpend: currentCycle.totalSpend,
          transactionCount: currentCycle.transactionCount
        } : null
      });
    }

    console.log('🔄 BILLING CYCLES REGENERATION COMPLETED');
    
    return NextResponse.json({ 
      message: 'Billing cycles regenerated successfully',
      results 
    });
  } catch (error) {
    console.error('🔄 BILLING CYCLES REGENERATION ERROR:', error);
    return NextResponse.json({ error: 'Failed to regenerate billing cycles' }, { status: 500 });
  }
}