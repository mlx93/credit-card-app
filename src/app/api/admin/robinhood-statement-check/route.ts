import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const robinhoodCardId = 'a4668ff3-2e74-46b7-93f5-e6ca3d3256ad';
    
    // Get transactions that might contain statement info
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', robinhoodCardId)
      .or('name.ilike.%statement%,name.ilike.%billing%,name.ilike.%cycle%,name.ilike.%payment%,name.ilike.%interest%')
      .order('date', { ascending: false })
      .limit(20);
    
    // Look for patterns in payment transactions
    const payments = transactions?.filter(t => 
      t.name?.toLowerCase().includes('payment') && t.amount < 0
    );
    
    // Check transaction metadata for any statement info
    const transactionsWithMetadata = transactions?.map(t => ({
      date: t.date,
      name: t.name,
      amount: t.amount,
      merchantName: t.merchantName,
      category: t.category,
      // Check if transaction has any additional fields that might contain statement info
      hasMetadata: !!(t.merchantName || t.category || t.personalFinanceCategory),
      dayOfMonth: new Date(t.date).getDate()
    }));
    
    // Analyze payment patterns to infer cycle dates
    const paymentDates = payments?.map(p => new Date(p.date).getDate()) || [];
    const uniquePaymentDays = [...new Set(paymentDates)];
    
    // Interest charges often appear on statement close dates
    const interestCharges = transactions?.filter(t => 
      t.name?.toLowerCase().includes('interest') && t.amount > 0
    );
    
    return NextResponse.json({
      message: 'Checking for statement date clues in Robinhood transactions',
      payments: payments?.map(p => ({
        date: p.date,
        dayOfMonth: new Date(p.date).getDate(),
        amount: p.amount
      })),
      uniquePaymentDays: uniquePaymentDays.sort((a, b) => a - b),
      interestCharges: interestCharges?.map(i => ({
        date: i.date,
        dayOfMonth: new Date(i.date).getDate(),
        name: i.name
      })),
      potentialStatementTransactions: transactionsWithMetadata?.filter(t => 
        t.name?.toLowerCase().includes('statement') || 
        t.name?.toLowerCase().includes('billing') ||
        t.name?.toLowerCase().includes('interest')
      ),
      sampleTransactions: transactionsWithMetadata?.slice(0, 10)
    });
  } catch (error) {
    console.error('Error checking Robinhood statements:', error);
    return NextResponse.json({ error: 'Failed to check statements' }, { status: 500 });
  }
}