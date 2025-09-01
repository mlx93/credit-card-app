import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { isPaymentTransaction } from '@/utils/billingCycles';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get('month'); // Format: "2025-08"
    
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    
    const last3MonthsStart = startOfMonth(subMonths(now, 3));

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({
        totalSpendThisMonth: 0,
        monthlySpend: [],
        categories: [],
        cardSpending: [],
        monthlyComparison: [],
        transactionCount: 0,
      });
    }

    const { data: transactions, error: transactionsError } = await supabaseAdmin
      .from('transactions')
      .select(`
        *,
        credit_cards!inner(name, mask)
      `)
      .in('plaidItemId', plaidItemIds)
      .gte('date', last3MonthsStart.toISOString())
      .lte('date', currentMonthEnd.toISOString())
      .order('date', { ascending: false });

    if (transactionsError) {
      throw new Error(`Failed to fetch transactions: ${transactionsError.message}`);
    }

    // Convert date strings back to Date objects for compatibility
    const formattedTransactions = (transactions || []).map(t => ({
      ...t,
      date: new Date(t.date),
      creditCard: t.credit_cards ? {
        name: t.credit_cards.name,
        mask: t.credit_cards.mask
      } : null
    }));

    // Determine which month to analyze
    let activeMonthStart: Date;
    let activeMonthEnd: Date;
    
    if (monthParam) {
      // Use the specified month from the parameter
      const [year, month] = monthParam.split('-').map(Number);
      activeMonthStart = startOfMonth(new Date(year, month - 1));
      activeMonthEnd = endOfMonth(new Date(year, month - 1));
    } else {
      // Default to current month
      activeMonthStart = currentMonthStart;
      activeMonthEnd = currentMonthEnd;
    }
    
    let thisMonthTransactions = formattedTransactions.filter(t => 
      t.date >= activeMonthStart && t.date <= activeMonthEnd
    );
    
    // If no month parameter was provided and current month has no transactions, 
    // use the most recent month with data
    if (!monthParam && thisMonthTransactions.length === 0 && formattedTransactions.length > 0) {
      const mostRecentTransaction = formattedTransactions[0]; // Already sorted by date desc
      const mostRecentDate = mostRecentTransaction.date;
      
      activeMonthStart = startOfMonth(mostRecentDate);
      activeMonthEnd = endOfMonth(mostRecentDate);
      
      thisMonthTransactions = formattedTransactions.filter(t => 
        t.date >= activeMonthStart && t.date <= activeMonthEnd
      );
      
      console.log('📅 No current month transactions, using most recent month:', {
        currentMonth: currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        activeMonth: activeMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        transactionCount: thisMonthTransactions.length
      });
    }

    // Debug logging to understand what data we have
    console.log('🔍 ANALYTICS DEBUG:', {
      totalTransactions: formattedTransactions.length,
      thisMonthCount: thisMonthTransactions.length,
      sampleTransaction: formattedTransactions[0],
      availableFields: formattedTransactions[0] ? Object.keys(formattedTransactions[0]) : [],
      sampleTransactionWithCategory: formattedTransactions.find(t => t.category),
      transactionsWithCategory: formattedTransactions.filter(t => t.category).length,
      transactionsWithCreditCard: formattedTransactions.filter(t => t.creditCard?.name).length,
      uniqueCategories: [...new Set(formattedTransactions.map(t => t.category).filter(Boolean))],
      uniqueCreditCards: [...new Set(formattedTransactions.map(t => t.creditCard?.name).filter(Boolean))]
    });

    // Calculate total spend: exclude payment transactions, include charges and legitimate refunds
    const totalSpendThisMonth = thisMonthTransactions.reduce((sum, t) => {
      // Skip payment transactions regardless of sign
      if (isPaymentTransaction(t.name)) {
        return sum;
      }
      // Include all non-payment transactions (charges and refunds)
      return sum + t.amount;
    }, 0);

    const monthlySpend = [];
    for (let i = 3; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const monthEnd = endOfMonth(subMonths(now, i));
      
      const monthTransactions = formattedTransactions.filter(t => 
        t.date >= monthStart && t.date <= monthEnd
      );
      
      const amount = monthTransactions.reduce((sum, t) => {
        // Skip payment transactions
        if (isPaymentTransaction(t.name)) {
          return sum;
        }
        // Include charges and refunds
        return sum + t.amount;
      }, 0);
      
      monthlySpend.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        amount,
      });
    }

    const categoryMap = new Map<string, number>();
    thisMonthTransactions.forEach(t => {
      // Skip payment transactions
      if (isPaymentTransaction(t.name)) {
        return;
      }
      
      // Use Plaid category, or merchant name as fallback
      let category = t.category;
      if (!category) {
        if (t.merchantName) {
          category = t.merchantName;
        } else if (t.name) {
          // Use full transaction name if no merchant name
          category = t.name;
        } else {
          category = 'Other';
        }
      }
      categoryMap.set(category, (categoryMap.get(category) || 0) + t.amount);
    });

    const categories = Array.from(categoryMap.entries())
      .map(([name, amount]) => ({
        name,
        amount,
        percentage: totalSpendThisMonth > 0 ? (amount / totalSpendThisMonth) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const cardSpendingMap = new Map<string, number>();
    thisMonthTransactions.forEach(t => {
      // Skip payment transactions
      if (isPaymentTransaction(t.name)) {
        return;
      }
      const cardName = t.creditCard?.name || 'Unknown Card';
      cardSpendingMap.set(cardName, (cardSpendingMap.get(cardName) || 0) + t.amount);
    });

    const cardSpending = Array.from(cardSpendingMap.entries()).map(([name, amount], index) => ({
      name,
      amount,
      color: ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500'][index % 4],
    }));

    // Calculate monthly comparison data (compare with previous month)
    const lastMonthStart = startOfMonth(subMonths(activeMonthStart, 1));
    const lastMonthEnd = endOfMonth(subMonths(activeMonthStart, 1));
    
    const lastMonthTransactions = formattedTransactions.filter(t => 
      t.date >= lastMonthStart && t.date <= lastMonthEnd
    );

    const thisMonthCategoryMap = new Map<string, number>();
    const lastMonthCategoryMap = new Map<string, number>();
    
    thisMonthTransactions.forEach(t => {
      // Skip payment transactions
      if (isPaymentTransaction(t.name)) {
        return;
      }
      const category = t.category || 'Other';
      thisMonthCategoryMap.set(category, (thisMonthCategoryMap.get(category) || 0) + t.amount);
    });

    lastMonthTransactions.forEach(t => {
      // Skip payment transactions
      if (isPaymentTransaction(t.name)) {
        return;
      }
      const category = t.category || 'Other';
      lastMonthCategoryMap.set(category, (lastMonthCategoryMap.get(category) || 0) + t.amount);
    });

    const monthlyComparison = Array.from(thisMonthCategoryMap.entries())
      .map(([category, thisMonth]) => {
        const lastMonth = lastMonthCategoryMap.get(category) || 0;
        const change = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : (thisMonth > 0 ? 100 : 0);
        
        return {
          category,
          thisMonth,
          lastMonth,
          change,
        };
      })
      .sort((a, b) => b.thisMonth - a.thisMonth)
      .slice(0, 5);

    // Get list of available months with data for the dropdown
    const availableMonths = new Set<string>();
    formattedTransactions.forEach(t => {
      const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
      availableMonths.add(monthKey);
    });
    
    return NextResponse.json({
      totalSpendThisMonth,
      monthlySpend,
      categories,
      cardSpending,
      monthlyComparison,
      transactionCount: thisMonthTransactions.filter(t => !isPaymentTransaction(t.name)).length,
      selectedMonth: `${activeMonthStart.getFullYear()}-${String(activeMonthStart.getMonth() + 1).padStart(2, '0')}`,
      availableMonths: Array.from(availableMonths).sort().reverse(),
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}