import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

interface ConnectionHealth {
  plaidItemId: string;
  itemId: string;
  institutionName: string;
  status: 'healthy' | 'requires_auth' | 'error' | 'unknown';
  lastSuccessfulSync: string | null;
  errorDetails: any;
  apiConnectivity: {
    accounts: boolean;
    balances: boolean;
    transactions: boolean;
    liabilities: boolean;
  };
  recommendedAction: string;
}

async function testPlaidConnection(accessToken: string, itemId: string): Promise<{
  status: 'healthy' | 'requires_auth' | 'error';
  errorDetails: any;
  apiConnectivity: {
    accounts: boolean;
    balances: boolean; 
    transactions: boolean;
    liabilities: boolean;
  };
}> {
  const connectivity = {
    accounts: false,
    balances: false,
    transactions: false,
    liabilities: false
  };
  
  let overallStatus: 'healthy' | 'requires_auth' | 'error' = 'healthy';
  let errorDetails: any = null;

  // Test accounts endpoint
  try {
    await plaidClient.accountsGet({ access_token: accessToken });
    connectivity.accounts = true;
  } catch (error: any) {
    if (error?.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
      overallStatus = 'requires_auth';
      errorDetails = {
        type: 'auth_required',
        message: 'Bank connection requires re-authentication',
        plaidError: error.response.data
      };
    } else {
      overallStatus = 'error';
      errorDetails = {
        type: 'api_error',
        message: 'API connection failed',
        plaidError: error.response?.data
      };
    }
  }

  // Test account balances (if accounts worked)
  if (connectivity.accounts) {
    try {
      // Set min_last_updated_datetime to satisfy Capital One requirements
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 30);
      
      await plaidClient.accountsBalanceGet({ 
        access_token: accessToken,
        options: {
          min_last_updated_datetime: minDate.toISOString()
        }
      });
      connectivity.balances = true;
    } catch (error: any) {
      console.log(`Balance check failed for ${itemId}:`, error?.response?.data);
    }
  }

  // Test transactions (lightweight test with small date range)
  if (connectivity.accounts) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Last 7 days only
      
      await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      });
      connectivity.transactions = true;
    } catch (error: any) {
      console.log(`Transactions check failed for ${itemId}:`, error?.response?.data);
    }
  }

  // Test liabilities (this is often the failing endpoint)
  if (connectivity.accounts) {
    try {
      await plaidClient.liabilitiesGet({ access_token: accessToken });
      connectivity.liabilities = true;
    } catch (error: any) {
      console.log(`Liabilities check failed for ${itemId}:`, error?.response?.data);
      // Liabilities failure might not be critical - some institutions don't support it
    }
  }

  return {
    status: overallStatus,
    errorDetails,
    apiConnectivity: connectivity
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🔍 Testing connection health for user: ${session.user.email}`);

    // Get user's Plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id)
      .order('createdAt', { ascending: false });

    if (plaidError || !plaidItems) {
      return NextResponse.json({ error: 'Failed to fetch Plaid items' }, { status: 500 });
    }

    console.log(`🔗 Testing ${plaidItems.length} Plaid connections...`);

    // Test each connection's health
    const healthChecks: ConnectionHealth[] = [];

    for (const plaidItem of plaidItems) {
      console.log(`🩺 Testing connection for ${plaidItem.institutionName}...`);
      
      try {
        const decryptedAccessToken = decrypt(plaidItem.accessToken);
        const healthTest = await testPlaidConnection(decryptedAccessToken, plaidItem.itemId);
        
        let recommendedAction = '';
        if (healthTest.status === 'requires_auth') {
          recommendedAction = 'Reconnect this bank account through Plaid Link';
        } else if (healthTest.status === 'error') {
          recommendedAction = 'Check bank connection or contact support';
        } else {
          recommendedAction = 'Connection is healthy';
        }

        healthChecks.push({
          plaidItemId: plaidItem.id,
          itemId: plaidItem.itemId,
          institutionName: plaidItem.institutionName,
          status: healthTest.status,
          lastSuccessfulSync: plaidItem.lastSyncAt,
          errorDetails: healthTest.errorDetails,
          apiConnectivity: healthTest.apiConnectivity,
          recommendedAction
        });

        console.log(`✅ Health check completed for ${plaidItem.institutionName}: ${healthTest.status}`);

      } catch (error) {
        console.error(`❌ Failed to test ${plaidItem.institutionName}:`, error);
        
        healthChecks.push({
          plaidItemId: plaidItem.id,
          itemId: plaidItem.itemId,
          institutionName: plaidItem.institutionName,
          status: 'error',
          lastSuccessfulSync: plaidItem.lastSyncAt,
          errorDetails: { type: 'test_failed', message: 'Connection test failed', error },
          apiConnectivity: {
            accounts: false,
            balances: false,
            transactions: false,
            liabilities: false
          },
          recommendedAction: 'Reconnect this bank account'
        });
      }
    }

    // Calculate overall health summary
    const summary = {
      totalConnections: healthChecks.length,
      healthyConnections: healthChecks.filter(h => h.status === 'healthy').length,
      requiresAuth: healthChecks.filter(h => h.status === 'requires_auth').length,
      errorConnections: healthChecks.filter(h => h.status === 'error').length,
      overallHealth: healthChecks.every(h => h.status === 'healthy') ? 'all_healthy' :
                    healthChecks.some(h => h.status === 'requires_auth') ? 'auth_required' : 'has_errors'
    };

    return NextResponse.json({
      message: 'Connection health check completed',
      timestamp: new Date().toISOString(),
      summary,
      connections: healthChecks,
      recommendations: summary.overallHealth === 'all_healthy' ? [
        'All bank connections are working properly',
        'Data sync should be functioning normally'
      ] : [
        `${summary.requiresAuth + summary.errorConnections} connections need attention`,
        'Reconnect any connections showing "requires_auth" status',
        'Check error details for specific issues',
        'Your data may be stale until connections are restored'
      ]
    });

  } catch (error) {
    console.error('❌ Connection health check error:', error);
    return NextResponse.json({ error: 'Failed to check connection health' }, { status: 500 });
  }
}