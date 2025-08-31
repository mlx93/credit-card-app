import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST() {
  try {
    console.log('🔧 FIX OPEN DATES ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    
    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Find cards with future open dates
    const { data: cardsWithFutureDates, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .gt('openDate', now.toISOString());

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Add plaidItem reference to each card
    const cardsWithPlaidItems = (cardsWithFutureDates || []).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      return { ...card, plaidItem };
    });

    console.log(`Found ${(cardsWithFutureDates || []).length} cards with future open dates`);

    const fixes = [];
    
    for (const card of cardsWithPlaidItems) {
      const currentOpenDate = card.openDate ? new Date(card.openDate) : null;
      
      if (currentOpenDate) {
        // Fix common year mistakes: 2025 -> 2024, 2026 -> 2024, etc.
        const correctedDate = new Date(currentOpenDate);
        
        // If the year is 2025 or later, change it to 2024
        if (correctedDate.getFullYear() >= 2025) {
          correctedDate.setFullYear(2024);
          
          // If the corrected date is still in the future (later this year), 
          // move it to the same date last year
          if (correctedDate > now) {
            correctedDate.setFullYear(2023);
          }
          
          console.log(`Fixing ${card.name}: ${currentOpenDate.toDateString()} -> ${correctedDate.toDateString()}`);
          
          // Update the card with the corrected date
          const { error: updateError } = await supabaseAdmin
            .from('credit_cards')
            .update({ openDate: correctedDate.toISOString() })
            .eq('id', card.id);

          if (updateError) {
            console.error(`Failed to update card ${card.id}:`, updateError);
            continue;
          }
          
          fixes.push({
            cardName: card.name,
            originalDate: currentOpenDate.toDateString(),
            correctedDate: correctedDate.toDateString(),
            originalYear: currentOpenDate.getFullYear(),
            correctedYear: correctedDate.getFullYear()
          });
        }
      }
    }

    console.log('🔧 OPEN DATE FIXES COMPLETED');
    
    return NextResponse.json({ 
      message: 'Open dates fixed successfully',
      fixesApplied: fixes.length,
      fixes
    });
  } catch (error) {
    console.error('🔧 FIX OPEN DATES ERROR:', error);
    return NextResponse.json({ error: 'Failed to fix open dates' }, { status: 500 });
  }
}