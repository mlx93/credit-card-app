import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-boa-june-check',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 CHECKING BOA JUNE DATA DIRECTLY');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);

    // Get the BoA card
    const { data: boaCards, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .ilike('name', '%Customized%');

    if (cardError) {
      throw new Error(`Failed to fetch BoA card: ${cardError.message}`);
    }

    const boaCard = boaCards?.[0];
    if (!boaCard) {
      return NextResponse.json({ error: 'BoA card not found' }, { status: 404 });
    }

    // Get June 2025 transactions specifically
    const june2025Start = '2025-06-01';
    const june2025End = '2025-06-30';
    
    const { data: juneTransactions, error: transactionError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .gte('date', june2025Start)
      .lte('date', june2025End)
      .order('date', { ascending: true });

    if (transactionError) {
      throw new Error(`Failed to fetch June transactions: ${transactionError.message}`);
    }

    // Get the June billing cycle
    const { data: juneCycles, error: cycleError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .gte('startDate', '2025-06-01')
      .lte('startDate', '2025-06-30');

    if (cycleError) {
      throw new Error(`Failed to fetch June cycle: ${cycleError.message}`);
    }

    const juneCycle = juneCycles?.[0];

    // Get ALL billing cycles for BoA card
    const { data: allBoaCycles, error: allCyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', boaCard.id)
      .order('startDate', { ascending: false });

    if (allCyclesError) {
      throw new Error(`Failed to fetch all cycles: ${allCyclesError.message}`);
    }

    // Calculate June spending manually
    const juneSpend = (juneTransactions || []).reduce((sum, t) => {
      // Skip payments (negative amounts with payment keywords)
      const isPayment = t.name.toLowerCase().includes('pymt') || 
                       t.name.toLowerCase().includes('payment');
      if (isPayment) return sum;
      return sum + t.amount;
    }, 0);

    return NextResponse.json({
      message: 'BoA June data check completed',
      boaCard: {
        id: boaCard.id,
        name: boaCard.name,
        openDate: boaCard.openDate,
        accountId: boaCard.accountId
      },
      juneData: {
        transactionCount: (juneTransactions || []).length,
        totalSpend: juneSpend,
        dateRange: `${june2025Start} to ${june2025End}`,
        transactions: (juneTransactions || []).map(t => ({
          id: t.id,
          date: t.date,
          amount: t.amount,
          name: t.name,
          category: t.category
        }))
      },
      juneCycle: juneCycle ? {
        id: juneCycle.id,
        startDate: juneCycle.startDate,
        endDate: juneCycle.endDate,
        totalSpend: juneCycle.totalSpend,
        statementBalance: juneCycle.statementBalance,
        dueDate: juneCycle.dueDate
      } : null,
      allCycles: (allBoaCycles || []).map(cycle => ({
        id: cycle.id,
        period: `${cycle.startDate} to ${cycle.endDate}`,
        totalSpend: cycle.totalSpend,
        statementBalance: cycle.statementBalance,
        hasStatement: cycle.statementBalance !== null
      })),
      summary: {
        cardOpenedInJune: boaCard.openDate ? new Date(boaCard.openDate).getMonth() === 5 : false,
        hasJuneTransactions: (juneTransactions || []).length > 0,
        hasJuneCycle: !!juneCycle,
        totalCycles: (allBoaCycles || []).length,
        cyclesWithStatements: (allBoaCycles || []).filter(c => c.statementBalance !== null).length
      }
    });

  } catch (error) {
    console.error('🔍 BOA JUNE CHECK ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to check BoA June data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}