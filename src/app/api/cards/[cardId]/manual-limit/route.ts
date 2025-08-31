import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function PUT(
  request: NextRequest,
  { params }: { params: { cardId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId } = params;
    const { manualCreditLimit } = await request.json();

    // Validate the manual credit limit
    if (typeof manualCreditLimit !== 'number' || manualCreditLimit <= 0) {
      return NextResponse.json({ 
        error: 'Manual credit limit must be a positive number' 
      }, { status: 400 });
    }

    // First verify the card belongs to the user and has no existing credit limit
    const { data: card, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*, plaid_items!inner(userId)')
      .eq('id', cardId)
      .eq('plaid_items.userId', session.user.id)
      .single();

    if (cardError || !card) {
      return NextResponse.json({ 
        error: 'Card not found or access denied' 
      }, { status: 404 });
    }

    // Allow manual limits on any card - user can override Plaid data if needed

    // Update the card with manual credit limit
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({
        manualCreditLimit,
        isManualLimit: true,
        updatedAt: new Date().toISOString()
      })
      .eq('id', cardId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating manual credit limit:', updateError);
      return NextResponse.json({ 
        error: 'Failed to update credit limit' 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      card: updatedCard 
    });

  } catch (error) {
    console.error('Manual credit limit update error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { cardId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId } = params;

    // First verify the card belongs to the user
    const { data: card, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*, plaid_items!inner(userId)')
      .eq('id', cardId)
      .eq('plaid_items.userId', session.user.id)
      .single();

    if (cardError || !card) {
      return NextResponse.json({ 
        error: 'Card not found or access denied' 
      }, { status: 404 });
    }

    // Remove the manual credit limit
    const { data: updatedCard, error: updateError } = await supabaseAdmin
      .from('credit_cards')
      .update({
        manualCreditLimit: null,
        isManualLimit: false,
        updatedAt: new Date().toISOString()
      })
      .eq('id', cardId)
      .select()
      .single();

    if (updateError) {
      console.error('Error removing manual credit limit:', updateError);
      return NextResponse.json({ 
        error: 'Failed to remove credit limit' 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      card: updatedCard 
    });

  } catch (error) {
    console.error('Manual credit limit removal error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}