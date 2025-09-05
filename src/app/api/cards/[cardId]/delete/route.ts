import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

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

    // Fetch the card and verify ownership via join to plaid_items
    const { data: card, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, plaidItemId, plaid_items!inner(id, itemId, accessToken, institutionName, userId)')
      .eq('id', cardId)
      .eq('plaid_items.userId', session.user.id)
      .single();

    if (cardError || !card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Best-effort: if this was the only card left, attempt to remove the Plaid item too
    try {
      const { data: otherCards } = await supabaseAdmin
        .from('credit_cards')
        .select('id')
        .eq('plaidItemId', card.plaidItemId)
        .neq('id', cardId);

      if (!otherCards || otherCards.length === 0) {
        // Last card — try to remove item from Plaid backend to revoke access
        const decryptedAccessToken = decrypt((card as any).plaid_items.accessToken);
        await plaidService.removeItem(decryptedAccessToken);
      }
    } catch (plaidErr) {
      // Continue with local cleanup even if Plaid removal fails
      console.warn('Plaid item revoke during single-card delete failed (continuing):', (plaidErr as any)?.message);
    }

    // Prefer transactional RPC
    let success = false;
    try {
      const { data: rpcResult, error: rpcError } = await supabaseAdmin
        .rpc('delete_credit_card_and_data', { p_credit_card_id: cardId });
      if (!rpcError && rpcResult === true) {
        success = true;
      }
    } catch (rpcErr) {
      console.warn('delete_credit_card_and_data RPC error, falling back to manual delete:', (rpcErr as any)?.message);
    }

    if (!success) {
      // Manual fallback: delete dependent data then the card; remove item if no cards remain
      await supabaseAdmin.from('aprs').delete().eq('creditCardId', cardId);
      await supabaseAdmin.from('billing_cycles').delete().eq('creditCardId', cardId);
      await supabaseAdmin.from('transactions').delete().eq('creditCardId', cardId);
      await supabaseAdmin.from('credit_cards').delete().eq('id', cardId);

      const { data: remaining } = await supabaseAdmin
        .from('credit_cards')
        .select('id')
        .eq('plaidItemId', card.plaidItemId);
      if (!remaining || remaining.length === 0) {
        await supabaseAdmin.from('plaid_items').delete().eq('id', card.plaidItemId);
      }
      success = true;
    }

    // Verify nothing remains for this card
    const { data: verifyCard } = await supabaseAdmin
      .from('credit_cards')
      .select('id')
      .eq('id', cardId)
      .maybeSingle();
    if (verifyCard) {
      return NextResponse.json({ error: 'Partial deletion detected. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Card deleted' });

  } catch (error: any) {
    console.error('Single card delete error:', error);
    return NextResponse.json({ error: 'Failed to delete card', details: error.message }, { status: 500 });
  }
}

