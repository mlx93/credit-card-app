import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-plaid-limits',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all Plaid items for the user
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const results = [];

    for (const item of (plaidItems || [])) {
      const decryptedAccessToken = decrypt(item.accessToken);
      
      // Test multiple Plaid endpoints for credit limits
      
      // 1. Liabilities endpoint
      try {
        const liabilitiesResponse = await plaidClient.liabilitiesGet({
          access_token: decryptedAccessToken,
        });
        
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'liabilities',
          data: liabilitiesResponse.data
        });
      } catch (error) {
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'liabilities',
          error: error.message
        });
      }

      // 2. Accounts balance endpoint
      try {
        const balanceResponse = await plaidClient.accountsBalanceGet({
          access_token: decryptedAccessToken,
        });
        
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'accounts_balance',
          data: balanceResponse.data
        });
      } catch (error) {
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'accounts_balance',
          error: error.message
        });
      }

      // 3. Accounts get endpoint
      try {
        const accountsResponse = await plaidClient.accountsGet({
          access_token: decryptedAccessToken,
        });
        
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'accounts_get',
          data: accountsResponse.data
        });
      } catch (error) {
        results.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          endpoint: 'accounts_get',
          error: error.message
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Plaid limits debug error:', error);
    return NextResponse.json({ error: 'Failed to debug Plaid limits' }, { status: 500 });
  }
}