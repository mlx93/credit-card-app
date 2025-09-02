import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-capital-one-sync',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE SYNC DEBUG ===');

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get Capital One cards from database
    const { data: allCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Filter for Capital One cards
    const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
    const capitalOneCards = (allCards || []).filter(card => {
      const cardNameLower = card.name?.toLowerCase() || '';
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      const institutionNameLower = plaidItem?.institutionName?.toLowerCase() || '';
      
      return capitalOneIndicators.some(indicator => 
        cardNameLower.includes(indicator) || institutionNameLower.includes(indicator)
      );
    });

    // Add plaidItem reference to each card
    const capitalOneCardsWithPlaidItem = capitalOneCards.map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      return { ...card, plaidItem };
    });

    if (capitalOneCards.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'No Capital One cards found',
        found: capitalOneCards.length 
      });
    }

    const results = [];

    for (const card of capitalOneCardsWithPlaidItem) {
      console.log(`\n=== SYNCING CAPITAL ONE CARD: ${card.name} ===`);
      
      try {
        const decryptedToken = decrypt(card.plaidItem.accessToken);
        
        console.log('Before sync - current database values:');
        console.log('Card ID:', card.id);
        console.log('Balance Limit:', card.balanceLimit);
        console.log('Balance Current:', card.balanceCurrent);
        console.log('Balance Available:', card.balanceAvailable);
        
        // Trigger sync for this specific item
        console.log('Triggering syncAccounts...');
        await plaidService.syncAccounts(decryptedToken, card.plaidItem.itemId);
        
        // Check updated values
        const { data: updatedCard, error: updateError } = await supabaseAdmin
          .from('credit_cards')
          .select('*')
          .eq('id', card.id)
          .single();

        if (updateError) {
          console.error('Failed to fetch updated card:', updateError);
        }
        
        console.log('After sync - updated database values:');
        console.log('Balance Limit:', updatedCard?.balanceLimit);
        console.log('Balance Current:', updatedCard?.balanceCurrent);
        console.log('Balance Available:', updatedCard?.balanceAvailable);
        
        results.push({
          cardName: card.name,
          beforeSync: {
            balanceLimit: card.balanceLimit,
            balanceCurrent: card.balanceCurrent,
            balanceAvailable: card.balanceAvailable
          },
          afterSync: {
            balanceLimit: updatedCard?.balanceLimit,
            balanceCurrent: updatedCard?.balanceCurrent,
            balanceAvailable: updatedCard?.balanceAvailable
          },
          limitDetected: !!(updatedCard?.balanceLimit && updatedCard.balanceLimit > 0)
        });

      } catch (error) {
        console.error(`Error syncing Capital One card ${card.name}:`, error);
        results.push({
          cardName: card.name,
          error: error.message,
          limitDetected: false
        });
      }
    }

    console.log('=== END CAPITAL ONE SYNC DEBUG ===');

    return NextResponse.json({
      success: true,
      totalCapitalOneCards: capitalOneCards.length,
      results,
      message: 'Capital One sync debug completed - check console logs for detailed output'
    });

  } catch (error) {
    console.error('Capital One sync debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}