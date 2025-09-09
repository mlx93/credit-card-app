import { NextRequest, NextResponse } from 'next/server';
import { isPaymentTransaction } from '@/utils/billingCycles';
import { requireAdminAccess } from '@/lib/adminSecurity';

export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'admin-test-payment',
    logAccess: true
  });
  if (securityError) return securityError;
  const testCases = [
    'Payment',
    'PAYMENT',
    'payment',
    'Online ACH Payment',
    'ONLINE ACH PAYMENT',
    'Michaels Arts And Craft Store',
    'Trader Joe\'s',
    'Costco'
  ];
  
  const results = testCases.map(name => ({
    name,
    isPayment: isPaymentTransaction(name)
  }));
  
  return NextResponse.json({
    results,
    summary: {
      detected: results.filter(r => r.isPayment).map(r => r.name),
      missed: results.filter(r => !r.isPayment).map(r => r.name)
    }
  });
}