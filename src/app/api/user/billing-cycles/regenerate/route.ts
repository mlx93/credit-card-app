import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { calculateBillingCycles } from '@/utils/billingCycles';

/**
 * Regenerate billing cycles for the current user.
 * - Prefers Plaid Statements (with PDF parsing) to derive exact statement periods
 * - Falls back to heuristic generation only when statements are unavailable
 * - Optional: limit to a single card via JSON body { cardId }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { cardId } = await request.json().catch(() => ({} as any));

    // Fetch plaid items for user
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);
    if (plaidError) throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);

    const plaidItemIds = (plaidItems || []).map(i => i.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({ message: 'No plaid items for user', results: [] });
    }

    // Get credit cards for these items (optionally filter by cardId)
    let cardQuery = supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardId) {
      cardQuery = cardQuery.eq('id', cardId);
    }

    const { data: creditCards, error: cardsError } = await cardQuery;
    if (cardsError) throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);

    if (!creditCards || creditCards.length === 0) {
      return NextResponse.json({ message: 'No credit cards found for regeneration', results: [] });
    }

    // Delete existing billing cycles for the selected cards
    const creditCardIds = creditCards.map(c => c.id);
    const { error: deleteError } = await supabaseAdmin
      .from('billing_cycles')
      .delete()
      .in('creditCardId', creditCardIds);
    if (deleteError) {
      console.warn('Failed to delete existing billing cycles:', deleteError);
    }

    // Create a map for plaid item lookup
    const plaidItemMap = new Map<string, any>();
    (plaidItems || []).forEach(item => plaidItemMap.set(item.id, item));

    const results: any[] = [];

    for (const card of creditCards) {
      try {
        // Attempt to list statement periods (with PDF enrichment) for this account
        let statementPeriods: { startDate: Date | null; endDate: Date; dueDate?: Date | null }[] | undefined;
        try {
          const plaidItem = plaidItemMap.get(card.plaidItemId);
          if (plaidItem?.accessToken && card.accountId) {
            const { decrypt } = await import('@/lib/encryption');
            const { listStatementPeriods } = await import('@/services/plaidStatements');
            const accessToken = decrypt(plaidItem.accessToken);
            const periods = await listStatementPeriods(accessToken, card.accountId, 13);
            statementPeriods = periods
              .filter(p => p.endDate && (p.startDate instanceof Date))
              .map(p => ({ startDate: p.startDate!, endDate: p.endDate, dueDate: p.dueDate ?? null }));
          }
        } catch (e) {
          console.warn(`Statements listing failed for card ${card.name}:`, e);
        }

        const cycles = await calculateBillingCycles(card.id, {
          statementPeriods,
          baselineDueDate: card.nextPaymentDueDate ? new Date(card.nextPaymentDueDate) : null,
        });

        results.push({
          cardId: card.id,
          cardName: card.name,
          cyclesGenerated: cycles.length,
          statementsUsed: !!statementPeriods && statementPeriods.length > 0,
        });
      } catch (e: any) {
        results.push({
          cardId: card.id,
          cardName: card.name,
          cyclesGenerated: 0,
          error: e?.message || 'Unknown error'
        });
      }
    }

    const success = results.filter(r => !r.error).length;
    const failed = results.length - success;
    return NextResponse.json({
      message: 'Regeneration completed',
      summary: { cardsProcessed: results.length, successfulCards: success, failedCards: failed },
      results,
    });
  } catch (error: any) {
    console.error('User regeneration error:', error);
    return NextResponse.json({ error: 'Failed to regenerate cycles', details: error?.message }, { status: 500 });
  }
}

