import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'test-transactions',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const monthsBack = parseInt(searchParams.get('months') || '12');
    const itemId = searchParams.get('itemId'); // Optional: test specific item

    // Get user's plaid items
    let query = supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('user_id', session.user.id);
    
    if (itemId) {
      query = query.eq('item_id', itemId);
    }
    
    const { data: plaidItems, error } = await query;
    
    if (error) {
      console.error('Error fetching plaid items:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    if (plaidItems.length === 0) {
      return NextResponse.json({ error: 'No Plaid items found' }, { status: 404 });
    }

    const results = [];

    for (const item of plaidItems) {
      console.log(`\n=== TESTING ${monthsBack} MONTHS FOR ${item.institution_name} ===`);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      
      try {
        const accessToken = decrypt(item.access_token);
        
        console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
        
        // Direct API call to get transactions
        const transactions = await plaidService.getTransactions(
          accessToken, 
          startDate, 
          endDate
        );
        
        // Analyze the results
        const transactionsByMonth = {};
        transactions.forEach(t => {
          const month = t.date.substring(0, 7); // YYYY-MM format
          transactionsByMonth[month] = (transactionsByMonth[month] || 0) + 1;
        });
        
        const sortedMonths = Object.keys(transactionsByMonth).sort();
        const oldestMonth = sortedMonths[0];
        const newestMonth = sortedMonths[sortedMonths.length - 1];
        
        results.push({
          institution: item.institution_name,
          itemId: item.item_id,
          requested: {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            monthsRequested: monthsBack
          },
          results: {
            totalTransactions: transactions.length,
            dateRange: {
              oldest: oldestMonth,
              newest: newestMonth
            },
            monthsActuallyReturned: sortedMonths.length,
            transactionsByMonth
          },
          analysis: {
            gotRequestedRange: oldestMonth <= startDate.toISOString().split('T')[0].substring(0, 7),
            missingMonths: monthsBack - sortedMonths.length
          }
        });
        
        console.log(`✅ Got ${transactions.length} transactions`);
        console.log(`Date range returned: ${oldestMonth} to ${newestMonth}`);
        console.log(`Months returned: ${sortedMonths.length} (requested: ${monthsBack})`);
        
      } catch (error) {
        console.error(`Error testing ${item.institution_name}:`, error);
        results.push({
          institution: item.institution_name,
          itemId: item.item_id,
          error: error.message
        });
      }
    }

    return NextResponse.json({
      testParams: {
        monthsRequested: monthsBack,
        specificItemId: itemId || 'all'
      },
      results,
      summary: {
        totalItems: results.length,
        successful: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length
      }
    });

  } catch (error) {
    console.error('Test transactions error:', error);
    return NextResponse.json({ 
      error: 'Test failed',
      details: error.message 
    }, { status: 500 });
  }
}