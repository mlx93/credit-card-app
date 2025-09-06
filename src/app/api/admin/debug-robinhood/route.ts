import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';

export async function GET() {
  try {
    // Get plaid items to find Robinhood by institutionName
    const { data: plaidItems } = await supabaseAdmin
      .from('plaid_items')
      .select('id, institutionName')
      .ilike('institutionName', '%robinhood%');
    
    const robinhoodPlaidItemIds = plaidItems?.map(item => item.id) || [];
    
    // Get cards linked to Robinhood plaid items OR known Robinhood card
    const knownRobinhoodCardId = 'a4668ff3-2e74-46b7-93f5-e6ca3d3256ad';
    
    const { data: allCards } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask, plaidItemId, institutionId, balanceCurrent, officialName');
    
    const possibleRobinhoodCards = allCards?.filter(c => 
      c.id === knownRobinhoodCardId || // Known Robinhood card
      robinhoodPlaidItemIds.includes(c.plaidItemId) || // Cards from Robinhood plaid items
      c.institutionId === 'ins_54' || 
      c.name?.toLowerCase().includes('robinhood') ||
      c.officialName?.toLowerCase().includes('robinhood')
    );

    if (!possibleRobinhoodCards || possibleRobinhoodCards.length === 0) {
      return NextResponse.json({ 
        message: 'No Robinhood cards found. Showing all cards for identification:',
        allCards: allCards?.map(c => ({
          name: c.name,
          officialName: c.officialName,
          institutionId: c.institutionId,
          institutionName: c.institutionName,
          balance: c.balanceCurrent,
          mask: c.mask
        }))
      });
    }

    const results = [];
    
    for (const card of possibleRobinhoodCards) {
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