import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔄 Starting billing cycle regeneration for user:', session.user.id);

    // Get all plaid items for this user
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

    console.log(`Found ${creditCards?.length || 0} credit cards to regenerate cycles for`);

    // Delete existing billing cycles for all cards
    const creditCardIds = (creditCards || []).map(card => card.id);
    
    if (creditCardIds.length > 0) {
      const { error: deleteError, count } = await supabaseAdmin
        .from('billing_cycles')
        .delete()
        .in('creditCardId', creditCardIds);

      if (deleteError) {
        console.error('Failed to delete existing billing cycles:', deleteError);
      } else {
        console.log(`Deleted ${count || 0} existing billing cycles`);
      }
    }

    // Regenerate billing cycles for each credit card
    const results = [];
    for (const card of (creditCards || [])) {
      console.log(`Regenerating cycles for ${card.name}...`);
      
      try {
        const cycles = await calculateBillingCycles(card.id);
        console.log(`✅ Generated ${cycles.length} cycles for ${card.name}`);
        
        // Log a sample of the cycles to verify correct calculation
        if (cycles.length > 0) {
          const latestCycle = cycles[cycles.length - 1];
          console.log(`   Latest cycle totalSpend: $${latestCycle.totalSpend.toFixed(2)} (${latestCycle.transactionCount} transactions)`);
        }
        
        results.push({
          cardName: card.name,
          cardId: card.id,
          cyclesGenerated: cycles.length,
          success: true
        });
      } catch (cycleError: any) {
        console.error(`Failed to generate billing cycles for ${card.name}:`, cycleError);
        results.push({
          cardName: card.name,
          cardId: card.id,
          cyclesGenerated: 0,
          success: false,
          error: cycleError.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const totalCycles = results.reduce((sum, r) => sum + r.cyclesGenerated, 0);

    console.log(`✅ Billing cycle regeneration completed: ${successCount} cards successful, ${failCount} failed`);
    console.log(`   Total cycles generated: ${totalCycles}`);

    return NextResponse.json({ 
      message: 'Billing cycles regenerated successfully',
      results,
      summary: {
        cardsProcessed: results.length,
        successfulCards: successCount,
        failedCards: failCount,
        totalCyclesGenerated: totalCycles
      }
    });

  } catch (error: any) {
    console.error('Error regenerating billing cycles:', error);
    return NextResponse.json({ 
      error: 'Failed to regenerate billing cycles',
      details: error.message 
    }, { status: 500 });
  }
}