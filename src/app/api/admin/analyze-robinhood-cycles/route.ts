import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAccess } from '@/lib/adminSecurity';
import { supabaseAdmin } from '@/lib/supabase';
import { startOfMonth, endOfMonth, format } from 'date-fns';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'admin-analyze-robinhood-cycles',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    // Get the Robinhood card
    const robinhoodCardId = 'a4668ff3-2e74-46b7-93f5-e6ca3d3256ad';
    
    // Get the card details
    const { data: card } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('id', robinhoodCardId)
      .single();
    
    // Get all transactions for the past 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', robinhoodCardId)
      .gte('date', sixMonthsAgo.toISOString())
      .order('date', { ascending: false });
    
    // Get existing billing cycles
    const { data: existingCycles } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', robinhoodCardId)
      .order('endDate', { ascending: false });
    
    // Group transactions by month to find patterns
    const transactionsByMonth = new Map();
    transactions?.forEach(t => {
      const date = new Date(t.date);
      const monthKey = format(date, 'yyyy-MM');
      if (!transactionsByMonth.has(monthKey)) {
        transactionsByMonth.set(monthKey, []);
      }
      transactionsByMonth.get(monthKey).push({
        date: t.date,
        name: t.name,
        amount: t.amount,
        dayOfMonth: date.getDate()
      });
    });
    
    // Find payment transactions to identify statement close dates
    const payments = transactions?.filter(t => 
      t.name?.toLowerCase().includes('payment') && t.amount < 0
    ).map(t => ({
      date: t.date,
      amount: t.amount,
      dayOfMonth: new Date(t.date).getDate()
    }));
    
    // Analyze statement patterns from card data
    const statementInfo = {
      lastStatementDate: card?.lastStatementIssueDate,
      lastStatementBalance: card?.lastStatementBalance,
      nextPaymentDue: card?.nextPaymentDueDate,
      minimumPayment: card?.minimumPaymentAmount,
      currentBalance: card?.balanceCurrent
    };
    
    // Calculate what the cycles SHOULD be based on mid-month pattern
    const suggestedCycles = [];
    const today = new Date();
    
    // If we have a statement date, use it to determine the cycle day
    let cycleDay = 31; // Default to end of month
    if (card?.lastStatementIssueDate) {
      cycleDay = new Date(card.lastStatementIssueDate).getDate();
    } else if (payments?.length > 0) {
      // Try to infer from payment dates (usually due ~25 days after statement)
      const paymentDays = payments.map(p => p.dayOfMonth);
      const mostCommonPaymentDay = mode(paymentDays);
      cycleDay = mostCommonPaymentDay - 25; // Rough estimate
      if (cycleDay <= 0) cycleDay += 30;
    }
    
    // Generate suggested cycles for the past 6 months
    for (let i = 0; i < 6; i++) {
      const cycleEnd = new Date(today);
      cycleEnd.setMonth(cycleEnd.getMonth() - i);
      cycleEnd.setDate(cycleDay);
      
      const cycleStart = new Date(cycleEnd);
      cycleStart.setMonth(cycleStart.getMonth() - 1);
      cycleStart.setDate(cycleDay + 1);
      
      // Get transactions for this suggested cycle
      const cycleTransactions = transactions?.filter(t => {
        const tDate = new Date(t.date);
        return tDate >= cycleStart && tDate <= cycleEnd;
      });
      
      const totalSpend = cycleTransactions
        ?.filter(t => !t.name?.toLowerCase().includes('payment'))
        ?.reduce((sum, t) => sum + t.amount, 0) || 0;
      
      suggestedCycles.push({
        startDate: format(cycleStart, 'yyyy-MM-dd'),
        endDate: format(cycleEnd, 'yyyy-MM-dd'),
        transactionCount: cycleTransactions?.length || 0,
        totalSpend: totalSpend.toFixed(2),
        hasPayment: cycleTransactions?.some(t => t.name?.toLowerCase().includes('payment'))
      });
    }
    
    return NextResponse.json({
      cardInfo: statementInfo,
      inferredCycleDay: cycleDay,
      payments: payments?.slice(0, 5), // Show recent payments
      existingCycles: existingCycles?.map(c => ({
        startDate: c.startDate,
        endDate: c.endDate,
        totalSpend: c.totalSpend,
        transactionCount: c.transactionCount,
        statementBalance: c.statementBalance
      })),
      suggestedCycles,
      transactionsByMonth: Array.from(transactionsByMonth.entries()).map(([month, txns]) => ({
        month,
        transactionCount: txns.length,
        totalAmount: txns.reduce((sum, t) => sum + t.amount, 0).toFixed(2),
        dateRange: {
          earliest: txns.reduce((min, t) => t.date < min ? t.date : min, txns[0].date),
          latest: txns.reduce((max, t) => t.date > max ? t.date : max, txns[0].date)
        }
      }))
    });
  } catch (error) {
    console.error('Error analyzing Robinhood cycles:', error);
    return NextResponse.json({ error: 'Failed to analyze cycles' }, { status: 500 });
  }
}

// Helper function to find the mode (most common value)
function mode(arr: number[]): number {
  const frequency = new Map();
  let maxFreq = 0;
  let mode = arr[0];
  
  for (const val of arr) {
    const freq = (frequency.get(val) || 0) + 1;
    frequency.set(val, freq);
    if (freq > maxFreq) {
      maxFreq = freq;
      mode = val;
    }
  }
  
  return mode;
}