import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminAccess } from '@/lib/adminSecurity';

// Payment detection function (copied from billingCycles.ts)
function isPaymentTransaction(transactionName: string): boolean {
  const lowerName = transactionName.toLowerCase();
  const paymentIndicators = [
    'pymt', 'payment', 'autopay', 'online payment', 'mobile payment',
    'phone payment', 'bank payment', 'ach payment', 'electronic payment', 'web payment'
  ];
  return paymentIndicators.some(indicator => lowerName.includes(indicator));
}

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-transactions',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 Debugging transaction data and billing cycle calculations...');
    
    // Get all transactions with their credit card info
    const { data: transactions, error: transError } = await supabaseAdmin
      .from('transactions')
      .select(`
        id, name, amount, date, accountid, plaidtransactionid,
        creditCardId, 
        credit_cards (id, name, mask, accountId)
      `)
      .order('date', { ascending: false })
      .limit(20);

    if (transError) {
      return NextResponse.json({ error: transError.message }, { status: 500 });
    }

    // Analyze transactions
    const analysis = {
      total: transactions?.length || 0,
      byType: { payments: 0, purchases: 0 },
      byCard: {} as any,
      dateRange: { earliest: null as string | null, latest: null as string | null },
      samples: {
        payments: [] as any[],
        purchases: [] as any[]
      }
    };

    if (transactions) {
      // Get date range
      const dates = transactions.map(t => t.date).sort();
      analysis.dateRange.earliest = dates[0];
      analysis.dateRange.latest = dates[dates.length - 1];

      // Analyze each transaction
      transactions.forEach(trans => {
        const isPayment = isPaymentTransaction(trans.name);
        
        if (isPayment) {
          analysis.byType.payments++;
          if (analysis.samples.payments.length < 3) {
            analysis.samples.payments.push({
              name: trans.name,
              amount: trans.amount,
              date: trans.date,
              cardName: trans.credit_cards?.name
            });
          }
        } else {
          analysis.byType.purchases++;
          if (analysis.samples.purchases.length < 3) {
            analysis.samples.purchases.push({
              name: trans.name,
              amount: trans.amount,
              date: trans.date,
              cardName: trans.credit_cards?.name
            });
          }
        }

        // Count by card
        const cardName = trans.credit_cards?.name || 'Unknown Card';
        if (!analysis.byCard[cardName]) {
          analysis.byCard[cardName] = { payments: 0, purchases: 0, total: 0 };
        }
        analysis.byCard[cardName].total++;
        if (isPayment) {
          analysis.byCard[cardName].payments++;
        } else {
          analysis.byCard[cardName].purchases++;
        }
      });
    }

    // Check billing cycles
    const { data: cycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('creditCardName, totalSpend, transactionCount, startDate, endDate')
      .order('startDate', { ascending: false })
      .limit(10);

    const cycleAnalysis = {
      total: cycles?.length || 0,
      withZeroSpend: cycles?.filter(c => c.totalSpend === 0).length || 0,
      withSpend: cycles?.filter(c => c.totalSpend > 0).length || 0,
      samples: cycles?.slice(0, 5) || []
    };

    return NextResponse.json({
      success: true,
      message: 'Transaction debugging completed',
      transactionAnalysis: analysis,
      billingCycleAnalysis: cycleAnalysis,
      diagnosis: {
        likelyIssue: analysis.byType.purchases === 0 ? 
          'NO_PURCHASES' : 
          analysis.total === 0 ? 
          'NO_TRANSACTIONS' : 
          'DATE_RANGE_MISMATCH',
        explanation: analysis.byType.purchases === 0 ? 
          'Only payment transactions found - no purchases to calculate spending from' :
          analysis.total === 0 ?
          'No transactions found in database' :
          'Transactions exist but may not match billing cycle date ranges'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Transaction debug failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}