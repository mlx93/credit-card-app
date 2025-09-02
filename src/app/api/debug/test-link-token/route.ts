import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { plaidClient } from '@/lib/plaid';
import { LinkTokenCreateRequest } from 'plaid';

import { requireAdminAccess } from '@/lib/adminSecurity';
interface TestConfiguration {
  name: string;
  description: string;
  request: LinkTokenCreateRequest;
}

interface TestResult {
  config: string;
  success: boolean;
  linkToken?: string;
  error?: string;
  errorType?: string;
  errorCode?: string;
  displayMessage?: string;
  duration: number;
}

export async function POST(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-test-link-token',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 COMPREHENSIVE LINK TOKEN TEST STARTING');
    console.log('Environment:', process.env.PLAID_ENV);
    console.log('APP_URL:', process.env.APP_URL);
    console.log('User ID:', session.user.id);

    const baseRequest = {
      user: {
        client_user_id: session.user.id,
      },
      client_name: "Credit Card Tracker",
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.APP_URL + '/api/webhooks/plaid',
      transactions: {
        days_requested: 730,
      },
    };

    // Define test configurations
    const configurations: TestConfiguration[] = [
      {
        name: 'Basic Configuration',
        description: 'Only liabilities and transactions products',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions'],
        },
      },
      {
        name: 'With Optional Statements',
        description: 'Liabilities and transactions as products, statements as optional',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions'],
          optional_products: ['statements'],
        },
      },
      {
        name: 'Statements as Product',
        description: 'All three products including statements as required',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions', 'statements'],
        },
      },
      {
        name: 'Minimal Configuration',
        description: 'Only transactions product',
        request: {
          ...baseRequest,
          products: ['transactions'],
        },
      },
      {
        name: 'Only Liabilities',
        description: 'Only liabilities product',
        request: {
          ...baseRequest,
          products: ['liabilities'],
        },
      },
      {
        name: 'Assets Product',
        description: 'Test with assets product (should fail for credit cards)',
        request: {
          ...baseRequest,
          products: ['assets'],
        },
      },
      {
        name: 'All Optional Products',
        description: 'Basic products with all possible optional products',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions'],
          optional_products: ['statements', 'identity', 'assets'],
        },
      },
      {
        name: 'Extended Transaction History',
        description: 'Basic config with maximum transaction history',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions'],
          transactions: {
            days_requested: 2555, // ~7 years (maximum allowed)
          },
        },
      },
      {
        name: 'With Account Filters',
        description: 'Test with account type filters for credit cards',
        request: {
          ...baseRequest,
          products: ['liabilities', 'transactions'],
          optional_products: ['statements'],
          account_filters: {
            depository: {
              account_subtypes: [],
            },
            credit: {
              account_subtypes: ['credit card'],
            },
            loan: {
              account_subtypes: [],
            },
            investment: {
              account_subtypes: [],
            },
          },
        },
      },
    ];

    const results: TestResult[] = [];

    // Test each configuration
    for (const config of configurations) {
      const startTime = Date.now();
      console.log(`\n🧪 Testing: ${config.name}`);
      console.log(`Description: ${config.description}`);
      console.log('Request payload:', JSON.stringify(config.request, null, 2));
      
      try {
        const response = await plaidClient.linkTokenCreate(config.request);
        const duration = Date.now() - startTime;
        
        console.log(`✅ ${config.name} SUCCESS (${duration}ms)`);
        
        results.push({
          config: config.name,
          success: true,
          linkToken: response.data.link_token.substring(0, 20) + '...',
          duration,
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        
        console.log(`❌ ${config.name} FAILED (${duration}ms):`, error.message);
        console.log('Error details:', {
          error_type: error?.response?.data?.error_type,
          error_code: error?.response?.data?.error_code,
          error_message: error?.response?.data?.error_message,
          display_message: error?.response?.data?.display_message,
          status: error?.response?.status,
        });
        
        results.push({
          config: config.name,
          success: false,
          error: error.message,
          errorType: error?.response?.data?.error_type,
          errorCode: error?.response?.data?.error_code,
          displayMessage: error?.response?.data?.display_message,
          duration,
        });
      }
    }

    // Generate summary
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('\n📊 TEST SUMMARY:');
    console.log(`✅ Successful configurations: ${successCount}`);
    console.log(`❌ Failed configurations: ${failureCount}`);
    console.log(`📈 Success rate: ${(successCount / results.length * 100).toFixed(1)}%`);

    // Analyze patterns
    const workingConfigs = results.filter(r => r.success);
    const failingConfigs = results.filter(r => !r.success);
    
    const analysis = {
      workingProducts: [] as string[],
      failingProducts: [] as string[],
      commonErrors: {} as Record<string, number>,
      recommendations: [] as string[],
    };

    // Extract working product combinations
    workingConfigs.forEach(config => {
      const configData = configurations.find(c => c.name === config.config);
      if (configData) {
        const products = configData.request.products?.join(', ') || '';
        const optionalProducts = configData.request.optional_products?.join(', ') || '';
        const fullConfig = products + (optionalProducts ? ` (optional: ${optionalProducts})` : '');
        analysis.workingProducts.push(`${config.config}: ${fullConfig}`);
      }
    });

    // Extract failing configurations and common errors
    failingConfigs.forEach(config => {
      const configData = configurations.find(c => c.name === config.config);
      if (configData) {
        const products = configData.request.products?.join(', ') || '';
        const optionalProducts = configData.request.optional_products?.join(', ') || '';
        const fullConfig = products + (optionalProducts ? ` (optional: ${optionalProducts})` : '');
        analysis.failingProducts.push(`${config.config}: ${fullConfig} - ${config.error}`);
      }
      
      if (config.errorCode) {
        analysis.commonErrors[config.errorCode] = (analysis.commonErrors[config.errorCode] || 0) + 1;
      }
    });

    // Generate recommendations
    if (successCount > 0) {
      analysis.recommendations.push('✅ Basic liabilities + transactions configuration appears to work');
    }
    
    if (workingConfigs.find(c => c.config.includes('Optional'))) {
      analysis.recommendations.push('✅ Optional products can be safely added without breaking the integration');
    }
    
    if (failingConfigs.find(c => c.config.includes('Statements as Product'))) {
      analysis.recommendations.push('⚠️ Consider using statements as optional_products rather than required products');
    }
    
    if (Object.keys(analysis.commonErrors).length > 0) {
      const mostCommonError = Object.entries(analysis.commonErrors)
        .sort(([,a], [,b]) => b - a)[0];
      analysis.recommendations.push(`🔧 Most common error: ${mostCommonError[0]} (${mostCommonError[1]} occurrences)`);
    }
    
    if (failureCount === 0) {
      analysis.recommendations.push('🎉 All configurations work! Your Plaid integration is very flexible.');
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalConfigurations: results.length,
        successfulConfigurations: successCount,
        failedConfigurations: failureCount,
        successRate: `${(successCount / results.length * 100).toFixed(1)}%`,
      },
      results,
      analysis,
      environment: {
        plaidEnv: process.env.PLAID_ENV,
        hasWebhookUrl: !!process.env.APP_URL,
        webhookUrl: process.env.APP_URL + '/api/webhooks/plaid',
      },
    });

  } catch (error: any) {
    console.error('🔍 LINK TOKEN TEST ERROR:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Test failed to run',
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

export async function GET() {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-test-link-token',
    logAccess: true
  });
  if (securityError) return securityError;

  return NextResponse.json({
    message: 'POST to this endpoint to run comprehensive link token tests',
    description: 'Tests various Plaid link token configurations to determine which product combinations work',
    usage: 'POST /api/debug/test-link-token',
    authentication: 'Requires valid session'
  });
}