import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-plaid-transactions',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== PLAID TRANSACTIONS TEST ===');

    // Get first Plaid item to test with
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id)
      .limit(1);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItem = plaidItems?.[0];

    if (!plaidItem) {
      return NextResponse.json({ error: 'No Plaid items found' }, { status: 404 });
    }

    console.log(`Testing with ${plaidItem.institutionName} (${plaidItem.itemId})`);

    try {
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      console.log('Access token decrypted successfully');

      // Test direct API call with recent date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // Last 30 days only for testing

      console.log(`Calling getTransactions for date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      const transactions = await plaidService.getTransactions(
        decryptedAccessToken,
        startDate,
        endDate
      );

      console.log(`Plaid API returned ${transactions.length} transactions`);

      // Sample first few transactions
      const sampleTransactions = transactions.slice(0, 5).map(t => ({
        transaction_id: t.transaction_id,
        account_id: t.account_id,
        amount: t.amount,
        date: t.date,
        name: t.name,
        merchant_name: t.merchant_name,
        category: t.category
      }));

      return NextResponse.json({
        success: true,
        plaidItem: {
          institutionName: plaidItem.institutionName,
          itemId: plaidItem.itemId
        },
        dateRange: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        },
        transactionCount: transactions.length,
        sampleTransactions,
        message: transactions.length > 0 
          ? 'Plaid API is working - transactions returned successfully' 
          : 'Plaid API called successfully but returned 0 transactions'
      });

    } catch (plaidError) {
      console.error('Plaid API Error:', plaidError);
      
      return NextResponse.json({
        success: false,
        error: 'Plaid API call failed',
        plaidError: {
          message: plaidError.message,
          error_code: plaidError.error_code,
          error_type: plaidError.error_type,
          display_message: plaidError.display_message
        }
      });
    }

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug endpoint failed',
      details: error.message 
    }, { status: 500 });
  }
}