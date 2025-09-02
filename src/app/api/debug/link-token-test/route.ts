import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidClient } from '@/lib/plaid';
import { LinkTokenCreateRequest } from 'plaid';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST() {{
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-link-token-test',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 LINK TOKEN DEBUG TEST STARTING');
    console.log('Environment:', process.env.PLAID_ENV);
    console.log('APP_URL:', process.env.APP_URL);

    // Test 1: Basic configuration (what worked before)
    const basicRequest: LinkTokenCreateRequest = {
      user: {
        client_user_id: session.user.id,
      },
      client_name: "Credit Card Tracker",
      products: ['liabilities', 'transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730,
      },
    };

    console.log('🧪 Testing BASIC configuration...');
    console.log('Request payload:', JSON.stringify(basicRequest, null, 2));
    
    try {
      const basicResponse = await plaidClient.linkTokenCreate(basicRequest);
      console.log('✅ BASIC configuration SUCCESS');
      
      // Test 2: With statements product
      console.log('🧪 Testing WITH STATEMENTS...');
      const statementsRequest: LinkTokenCreateRequest = {
        ...basicRequest,
        products: ['liabilities', 'transactions', 'statements'],
      };
      
      console.log('Statements request:', JSON.stringify(statementsRequest, null, 2));
      
      try {
        const statementsResponse = await plaidClient.linkTokenCreate(statementsRequest);
        console.log('✅ STATEMENTS configuration SUCCESS');
        
        return NextResponse.json({
          success: true,
          message: 'Both configurations work',
          basicToken: basicResponse.data.link_token.substring(0, 20) + '...',
          statementsToken: statementsResponse.data.link_token.substring(0, 20) + '...'
        });
      } catch (statementsError) {
        console.log('❌ STATEMENTS configuration FAILED:', statementsError);
        
        return NextResponse.json({
          success: true,
          message: 'Basic works, statements fails',
          basicToken: basicResponse.data.link_token.substring(0, 20) + '...',
          statementsError: statementsError.message,
          issue: 'STATEMENTS_PRODUCT_ISSUE'
        });
      }
    } catch (basicError) {
      console.log('❌ BASIC configuration FAILED:', basicError);
      
      return NextResponse.json({
        success: false,
        message: 'Basic configuration failed - deeper issue',
        basicError: basicError.message,
        issue: 'FUNDAMENTAL_CONFIG_ISSUE'
      });
    }
  } catch (error) {
    console.error('🔍 LINK TOKEN DEBUG ERROR:', error);
    return NextResponse.json({ 
      error: 'Debug test failed',
      details: error.message 
    }, { status: 500 });
  }
}