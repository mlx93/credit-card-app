import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-test-payment-detection',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all plaid items for this user
    const { data: plaidItems } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all transactions for this user
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .order('amount', { ascending: true }) // Negative amounts first (likely payments)
      .limit(100);

    // Test payment detection
    const results = (transactions || []).map(t => ({
      name: t.name,
      amount: t.amount,
      date: t.date,
      isDetectedAsPayment: isPaymentTransaction(t.name),
      lowercaseName: t.name.toLowerCase(),
      likelyPayment: t.amount < 0 && t.name.toLowerCase().includes('payment'),
      containsAch: t.name.toLowerCase().includes('ach'),
      containsPayment: t.name.toLowerCase().includes('payment'),
      containsRef: t.name.toLowerCase().includes('ref')
    }));

    // Find transactions that look like payments but aren't detected
    const missedPayments = results.filter(r => 
      r.amount < 0 && // Negative amount (payment reduces balance)
      !r.isDetectedAsPayment && // Not detected by our function
      (r.containsPayment || r.containsAch || r.name.toLowerCase().includes('pymt'))
    );

    // Find all negative transactions to review
    const negativeTransactions = results.filter(r => r.amount < 0);

    // Get unique transaction names that are negative but not detected as payments
    const uniqueNegativeNames = [...new Set(
      negativeTransactions
        .filter(t => !t.isDetectedAsPayment)
        .map(t => t.name)
    )];

    return NextResponse.json({
      summary: {
        totalTransactions: results.length,
        detectedPayments: results.filter(r => r.isDetectedAsPayment).length,
        negativeTransactions: negativeTransactions.length,
        missedPayments: missedPayments.length,
        uniqueNegativeNamesNotDetected: uniqueNegativeNames.length
      },
      missedPayments: missedPayments.slice(0, 20), // First 20 missed payments
      uniqueNegativeNames: uniqueNegativeNames.slice(0, 30), // First 30 unique negative transaction names not detected
      sampleResults: results.slice(0, 30), // First 30 transactions for review
      testCases: [
        { name: "Online Ach Payment Ref", detected: isPaymentTransaction("Online Ach Payment Ref") },
        { name: "ONLINE ACH PAYMENT REF", detected: isPaymentTransaction("ONLINE ACH PAYMENT REF") },
        { name: "online ach payment ref", detected: isPaymentTransaction("online ach payment ref") },
        { name: "Payment", detected: isPaymentTransaction("Payment") },
        { name: "ACH Payment", detected: isPaymentTransaction("ACH Payment") },
      ]
    });

  } catch (error: any) {
    console.error('Error testing payment detection:', error);
    return NextResponse.json({ 
      error: 'Failed to test payment detection',
      details: error.message 
    }, { status: 500 });
  }
}