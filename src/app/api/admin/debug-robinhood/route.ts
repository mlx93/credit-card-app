import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';

export async function GET() {
  try {
    // First, let's see all cards and their institution IDs
    const { data: allCards } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask, institutionId, institutionName');
    
    console.log('All cards:', allCards?.map(c => ({ 
      name: c.name, 
      institutionId: c.institutionId,
      institutionName: c.institutionName 
    })));

    // Get Robinhood cards - they might be stored with institutionName instead
    const { data: robinhoodCards } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask, institutionId, institutionName')
      .or('institutionId.eq.ins_54,institutionName.ilike.%robinhood%');

    if (!robinhoodCards || robinhoodCards.length === 0) {
      return NextResponse.json({ 
        message: 'No Robinhood cards found',
        allCards: allCards?.map(c => ({
          name: c.name,
          institutionId: c.institutionId,
          institutionName: c.institutionName
        }))
      });
    }

    const results = [];
    
    for (const card of robinhoodCards) {
      // Get all transactions for this card
      const { data: transactions } = await supabaseAdmin
        .from('transactions')
        .select('name, amount, date, merchantName')
        .eq('creditCardId', card.id)
        .order('date', { ascending: false })
        .limit(50);

      // Analyze transactions
      const negativeTransactions = transactions?.filter(t => t.amount < 0) || [];
      const detectedPayments = transactions?.filter(t => isPaymentTransaction(t.name || '')) || [];
      const missedPayments = negativeTransactions.filter(t => !isPaymentTransaction(t.name || ''));
      
      // Calculate totals
      const totalWithPayments = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0;
      const totalWithoutPayments = transactions?.filter(t => !isPaymentTransaction(t.name || ''))
        .reduce((sum, t) => sum + t.amount, 0) || 0;

      results.push({
        card: `${card.name} (${card.mask})`,
        stats: {
          totalTransactions: transactions?.length || 0,
          negativeTransactions: negativeTransactions.length,
          detectedPayments: detectedPayments.length,
          missedPayments: missedPayments.length,
          totalWithPayments: totalWithPayments.toFixed(2),
          totalWithoutPayments: totalWithoutPayments.toFixed(2),
          difference: (totalWithPayments - totalWithoutPayments).toFixed(2)
        },
        negativeTransactions: negativeTransactions.map(t => ({
          name: t.name,
          amount: t.amount,
          date: t.date,
          isDetectedAsPayment: isPaymentTransaction(t.name || '')
        })),
        missedPayments: missedPayments.map(t => ({
          name: t.name,
          amount: t.amount,
          date: t.date
        }))
      });
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: 'Failed to debug Robinhood transactions' }, { status: 500 });
  }
}