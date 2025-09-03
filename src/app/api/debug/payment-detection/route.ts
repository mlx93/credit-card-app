import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';
import { requireAdminWithSession } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  try {
    // Security check - admin only
    const { session, error: securityError } = await requireAdminWithSession(request, {
      endpointName: 'debug/payment-detection',
      requireDebugKey: true,
      logAccess: true
    });
    if (securityError) return securityError;

    console.log('🔍 PAYMENT DETECTION DEBUG');
    
    // Get Bank of America Customized Cash card
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('userId', session.user.id)
      .ilike('name', '%customized%cash%');

    if (cardsError || !creditCards || creditCards.length === 0) {
      return NextResponse.json({ error: 'Bank of America card not found' }, { status: 404 });
    }

    const card = creditCards[0];
    console.log('📋 Card Info:', {
      name: card.name,
      currentBalance: card.balanceCurrent,
      statementBalance: card.lastStatementBalance,
      lastStatementDate: card.lastStatementIssueDate
    });

    // Get all transactions for this card
    const { data: transactions, error: txError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', card.id)
      .order('date', { ascending: false });

    if (txError) {
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    console.log(`💳 Total transactions: ${transactions.length}`);

    // Filter transactions from August 1st onwards to find the payment
    const recentTransactions = transactions.filter(t => new Date(t.date) >= new Date('2025-08-01'));
    console.log(`📅 Recent transactions (Aug 1+): ${recentTransactions.length}`);

    // Check each recent transaction
    const transactionAnalysis = recentTransactions.map(t => {
      const isPayment = isPaymentTransaction(t.name);
      const isNegative = t.amount < 0;
      const isLargeAmount = Math.abs(t.amount) > 1000;
      
      return {
        date: t.date,
        name: t.name,
        amount: t.amount,
        isDetectedAsPayment: isPayment,
        isNegativeAmount: isNegative,
        isLargeAmount: isLargeAmount,
        couldBePayment: isNegative && isLargeAmount
      };
    });

    console.log('🔍 Transaction Analysis:', transactionAnalysis);

    // Find potential payment transactions
    const potentialPayments = recentTransactions.filter(t => 
      t.amount < 0 && Math.abs(t.amount) > 1000
    );

    console.log('💰 Potential payment transactions:', potentialPayments.map(t => ({
      date: t.date,
      name: t.name,
      amount: t.amount,
      detectedAsPayment: isPaymentTransaction(t.name)
    })));

    // Specific check for Sep 1st transactions
    const sep1Transactions = recentTransactions.filter(t => 
      new Date(t.date).toDateString() === new Date('2025-09-01').toDateString()
    );

    console.log('📅 Sep 1st transactions:', sep1Transactions);

    return NextResponse.json({
      card: {
        name: card.name,
        currentBalance: card.balanceCurrent,
        statementBalance: card.lastStatementBalance,
        lastStatementDate: card.lastStatementIssueDate
      },
      totalTransactions: transactions.length,
      recentTransactions: recentTransactions.length,
      transactionAnalysis,
      potentialPayments,
      sep1Transactions,
      paymentDetectionTest: {
        'PAYMENT': isPaymentTransaction('PAYMENT'),
        'Online Payment': isPaymentTransaction('Online Payment'),
        'ACH Payment': isPaymentTransaction('ACH Payment'),
        'Bank Transfer': isPaymentTransaction('Bank Transfer'),
        'PYMT': isPaymentTransaction('PYMT')
      }
    });

  } catch (error) {
    console.error('🚨 Payment detection debug error:', error);
    return NextResponse.json({ 
      error: 'Payment detection debug failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}