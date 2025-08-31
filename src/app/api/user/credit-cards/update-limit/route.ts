import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId, creditLimit } = await request.json();

    // Validate inputs
    if (!cardId) {
      return NextResponse.json({ error: 'Card ID is required' }, { status: 400 });
    }

    if (creditLimit !== null && (typeof creditLimit !== 'number' || creditLimit <= 0)) {
      return NextResponse.json({ 
        error: 'Credit limit must be a positive number or null to remove' 
      }, { status: 400 });
    }

    // First get user's plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, institutionName')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Verify the card belongs to the authenticated user
    const { data: card, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*, plaid_items!inner(institutionName)')
      .eq('id', cardId)
      .in('plaidItemId', plaidItemIds)
      .single();

    if (cardError || !card) {
      return NextResponse.json({ 
        error: 'Credit card not found or unauthorized' 
      }, { status: 404 });
    }

    // Update the credit limit
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({ balanceLimit: creditLimit })
      .eq('id', cardId)
      .select()
      .single();

    if (updateError || !updatedCard) {
      throw new Error(`Failed to update credit limit: ${updateError?.message}`);
    }

    console.log(`✅ Manual credit limit updated for ${card.name}:`, {
      cardName: card.name,
      institution: card.plaid_items?.institutionName,
      oldLimit: card.balanceLimit,
      newLimit: creditLimit,
      userId: session.user.id
    });

    return NextResponse.json({
      success: true,
      message: `Credit limit ${creditLimit ? `set to $${creditLimit.toLocaleString()}` : 'removed'} for ${card.name}`,
      card: {
        id: updatedCard.id,
        name: updatedCard.name,
        balanceLimit: updatedCard.balanceLimit
      }
    });

  } catch (error) {
    console.error('Error updating credit limit:', error);
    return NextResponse.json(
      { error: 'Failed to update credit limit' },
      { status: 500 }
    );
  }
}