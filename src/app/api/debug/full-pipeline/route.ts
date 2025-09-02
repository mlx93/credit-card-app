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
    endpointName: 'debug-full-pipeline',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== FULL PIPELINE DEBUG for user:', session.user.email, '===');

    // 1. DATABASE STATE ANALYSIS
    console.log('\n=== 1. DATABASE STATE ANALYSIS ===');

    // Get user data from Supabase
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (userError) {
      throw new Error(`Failed to fetch user: ${userError.message}`);
    }

    // Get plaid items
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    // Get credit cards for these plaid items
    const plaidItemIds = (plaidItems || []).map(item => item.id);
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Get recent transactions for each credit card
    const creditCardIds = (creditCards || []).map(card => card.id);
    const { data: recentTransactions, error: txnError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('creditCardId', creditCardIds)
      .order('date', { ascending: false })
      .limit(50); // Get more to distribute among cards

    if (txnError) {
      throw new Error(`Failed to fetch transactions: ${txnError.message}`);
    }

    // Get recent billing cycles for each credit card
    const { data: recentBillingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .in('creditCardId', creditCardIds)
      .order('endDate', { ascending: false })
      .limit(50); // Get more to distribute among cards

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // Reconstruct the nested structure
    const itemsWithAccounts = (plaidItems || []).map(item => {
      const accounts = (creditCards || []).filter(card => card.plaidItemId === item.id).map(card => {
        const transactions = (recentTransactions || []).filter(t => t.creditCardId === card.id).slice(0, 5);
        const billingCycles = (recentBillingCycles || []).filter(c => c.creditCardId === card.id).slice(0, 3);
        
        return {
          ...card,
          transactions,
          billingCycles
        };
      });
      
      return {
        ...item,
        accounts
      };
    });

    const databaseState = {
      userEmail: user?.email,
      totalPlaidItems: itemsWithAccounts?.length || 0,
      totalCreditCards: itemsWithAccounts?.reduce((sum, item) => sum + item.accounts.length, 0) || 0,
      totalTransactions: itemsWithAccounts?.reduce((sum, item) => 
        sum + item.accounts.reduce((acc, card) => acc + card.transactions.length, 0), 0) || 0,
      plaidItems: itemsWithAccounts?.map(item => ({
        id: item.id,
        itemId: item.itemId,
        institutionName: item.institutionName,
        status: item.status,
        lastSyncAt: item.lastSyncAt,
        errorMessage: item.errorMessage,
        creditCardsCount: item.accounts.length,
        creditCards: item.accounts.map(card => ({
          id: card.id,
          name: card.name,
          mask: card.mask,
          balanceCurrent: card.balanceCurrent,
          balanceLimit: card.balanceLimit,
          balanceAvailable: card.balanceAvailable,
          lastStatementBalance: card.lastStatementBalance,
          minimumPaymentAmount: card.minimumPaymentAmount,
          nextPaymentDueDate: card.nextPaymentDueDate,
          transactionCount: card.transactions.length,
          recentTransactions: card.transactions.map(t => ({
            id: t.id,
            name: t.name,
            amount: t.amount,
            date: t.date
          })),
          billingCyclesCount: card.billingCycles.length,
          recentBillingCycles: card.billingCycles.map(bc => ({
            id: bc.id,
            startDate: bc.startDate,
            endDate: bc.endDate,
            statementBalance: bc.statementBalance,
            minimumPayment: bc.minimumPayment
          }))
        }))
      })) || []
    };

    // 2. FRESH PLAID API DATA
    console.log('\n=== 2. FRESH PLAID API DATA ===');
    
    const plaidApiResults = [];
    
    for (const item of itemsWithAccounts || []) {
      console.log(`\n--- Testing ${item.institutionName} (${item.itemId}) ---`);
      
      try {
        const decryptedToken = decrypt(item.accessToken);
        
        // Get fresh data from all Plaid endpoints
        const [liabilities, balances, accounts] = await Promise.all([
          plaidService.getLiabilities(decryptedToken).catch(e => ({ error: e.message })),
          plaidService.getBalances(decryptedToken).catch(e => ({ error: e.message })),
          plaidService.getAccounts(decryptedToken).catch(e => ({ error: e.message }))
        ]);

        // Test transaction fetch (last 30 days only for speed)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        
        const recentTransactions = await plaidService.getTransactions(
          decryptedToken, 
          startDate, 
          endDate
        ).catch(e => ({ error: e.message }));

        const isCapitalOne = item.institutionName?.toLowerCase().includes('capital one');

        plaidApiResults.push({
          institutionName: item.institutionName,
          itemId: item.itemId,
          isCapitalOne,
          endpoints: {
            liabilities: {
              success: !liabilities.error,
              error: liabilities.error,
              creditAccountsCount: liabilities.liabilities?.credit?.length || 0,
              creditAccounts: liabilities.liabilities?.credit?.map(acc => ({
                account_id: acc.account_id,
                limit: acc.limit,
                limit_current: acc.limit_current,
                balances: acc.balances,
                aprs: acc.aprs?.map(apr => ({
                  type: apr.apr_type,
                  percentage: apr.apr_percentage,
                  balanceSubjectToApr: apr.balance_subject_to_apr
                }))
              })) || []
            },
            balances: {
              success: !balances.error,
              error: balances.error,
              accountsCount: balances.accounts?.length || 0,
              creditCardBalances: balances.accounts?.filter(acc => acc.subtype === 'credit card').map(acc => ({
                account_id: acc.account_id,
                name: acc.name,
                balances: acc.balances
              })) || []
            },
            accounts: {
              success: !accounts.error,
              error: accounts.error,
              accountsCount: accounts.accounts?.length || 0
            },
            transactions: {
              success: Array.isArray(recentTransactions),
              error: recentTransactions.error,
              transactionCount: Array.isArray(recentTransactions) ? recentTransactions.length : 0,
              sampleTransactions: Array.isArray(recentTransactions) ? 
                recentTransactions.slice(0, 3).map(t => ({
                  transaction_id: t.transaction_id,
                  account_id: t.account_id,
                  name: t.name,
                  amount: t.amount,
                  date: t.date
                })) : []
            }
          }
        });

      } catch (error) {
        plaidApiResults.push({
          institutionName: item.institutionName,
          itemId: item.itemId,
          error: error.message
        });
      }
    }

    // 3. BILLING CYCLE ANALYSIS
    console.log('\n=== 3. BILLING CYCLE ANALYSIS ===');
    
    const billingCycleAnalysis = [];
    
    for (const item of itemsWithAccounts || []) {
      for (const card of item.accounts) {
        const { data: allCycles, error: allCyclesError } = await supabaseAdmin
          .from('billing_cycles')
          .select('*')
          .eq('creditCardId', card.id)
          .order('endDate', { ascending: false })
          .limit(6);

        if (allCyclesError) {
          throw new Error(`Failed to fetch billing cycles for card ${card.id}: ${allCyclesError.message}`);
        }

        billingCycleAnalysis.push({
          cardName: card.name,
          cardId: card.id,
          totalCyclesInDb: (allCycles || []).length,
          cyclesSummary: (allCycles || []).map(cycle => ({
            id: cycle.id,
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            statementBalance: cycle.statementBalance,
            minimumPayment: cycle.minimumPayment,
            isHistorical: cycle.endDate < new Date()
          }))
        });
      }
    }

    console.log('=== END FULL PIPELINE DEBUG ===');

    return NextResponse.json({
      success: true,
      userEmail: session.user.email,
      databaseState,
      plaidApiResults,
      billingCycleAnalysis
    });

  } catch (error) {
    console.error('Full pipeline debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}