import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
        credit_cards(name)
      `)
      .in('plaiditemid', plaidItemIds)
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
        name: t.credit_cards.name
      } : null
    }));

    const thisMonthTransactions = formattedTransactions.filter(t => 
      t.date >= currentMonthStart && t.date <= currentMonthEnd
    );

    const totalSpendThisMonth = thisMonthTransactions.reduce((sum, t) => 
      sum + Math.abs(t.amount), 0
    );

    const monthlySpend = [];
    for (let i = 3; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const monthEnd = endOfMonth(subMonths(now, i));
      
      const monthTransactions = formattedTransactions.filter(t => 
        t.date >= monthStart && t.date <= monthEnd
      );
      
      const amount = monthTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      monthlySpend.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        amount,
      });
    }

    const categoryMap = new Map<string, number>();
    thisMonthTransactions.forEach(t => {
      const category = t.category || 'Other';
      categoryMap.set(category, (categoryMap.get(category) || 0) + Math.abs(t.amount));
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
      const cardName = t.creditCard?.name || 'Unknown Card';
      cardSpendingMap.set(cardName, (cardSpendingMap.get(cardName) || 0) + Math.abs(t.amount));
    });

    const cardSpending = Array.from(cardSpendingMap.entries()).map(([name, amount], index) => ({
      name,
      amount,
      color: ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500'][index % 4],
    }));

    // Calculate monthly comparison data
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));
    
    const lastMonthTransactions = formattedTransactions.filter(t => 
      t.date >= lastMonthStart && t.date <= lastMonthEnd
    );

    const thisMonthCategoryMap = new Map<string, number>();
    const lastMonthCategoryMap = new Map<string, number>();
    
    thisMonthTransactions.forEach(t => {
      const category = t.category || 'Other';
      thisMonthCategoryMap.set(category, (thisMonthCategoryMap.get(category) || 0) + Math.abs(t.amount));
    });

    lastMonthTransactions.forEach(t => {
      const category = t.category || 'Other';
      lastMonthCategoryMap.set(category, (lastMonthCategoryMap.get(category) || 0) + Math.abs(t.amount));
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

    return NextResponse.json({
      totalSpendThisMonth,
      monthlySpend,
      categories,
      cardSpending,
      monthlyComparison,
      transactionCount: thisMonthTransactions.length,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}