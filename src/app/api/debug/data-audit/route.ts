import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

// Helper function to identify payment transactions based on transaction name
function isPaymentTransaction(transactionName: string): boolean {
  const lowerName = transactionName.toLowerCase();
  
  // Common payment indicators across different banks
  const paymentIndicators = [
    'pymt',           // Capital One payments
    'payment',        // Amex and other banks
    'autopay',        // Automatic payments
    'online payment', // Online payments
    'mobile payment', // Mobile app payments
    'phone payment',  // Phone payments
    'bank payment',   // Bank transfers
    'ach payment',    // ACH payments
    'electronic payment', // Electronic payments
    'web payment',    // Web payments
  ];
  
  return paymentIndicators.some(indicator => lowerName.includes(indicator));
}

export async function POST() {
  try {
    console.log('🔍 DATA AUDIT ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds);

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    // Get all transactions for these credit cards
    const creditCardIds = (creditCards || []).map(card => card.id);
    const { data: allTransactions, error: txnError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .in('creditCardId', creditCardIds)
      .order('date', { ascending: false });

    if (txnError) {
      throw new Error(`Failed to fetch transactions: ${txnError.message}`);
    }

    // Get all billing cycles for these credit cards
    const { data: allBillingCycles, error: cyclesError } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .in('creditCardId', creditCardIds)
      .order('endDate', { ascending: false });

    if (cyclesError) {
      throw new Error(`Failed to fetch billing cycles: ${cyclesError.message}`);
    }

    // Reconstruct credit cards with related data
    const creditCardsWithData = (creditCards || []).map(card => {
      const plaidItem = plaidItems?.find(item => item.id === card.plaidItemId);
      const transactions = (allTransactions || []).filter(t => t.creditCardId === card.id);
      const billingCycles = (allBillingCycles || []).filter(c => c.creditCardId === card.id);
      
      return {
        ...card,
        plaidItem,
        transactions,
        billingCycles
      };
    });

    console.log(`Found ${creditCards.length} credit cards for audit`);

    const auditResults = [];

    for (const card of creditCardsWithData) {
      console.log(`\n=== AUDITING ${card.name} ===`);
      
      const cardAudit = {
        cardName: card.name,
        cardId: card.id,
        basicInfo: {
          balanceCurrent: card.balanceCurrent,
          balanceLimit: card.balanceLimit,
          lastStatementBalance: card.lastStatementBalance,
          lastStatementIssueDate: card.lastStatementIssueDate,
          nextPaymentDueDate: card.nextPaymentDueDate,
          minimumPaymentAmount: card.minimumPaymentAmount
        },
        transactions: {
          total: card.transactions.length,
          dateRange: card.transactions.length > 0 ? {
            oldest: card.transactions[card.transactions.length - 1].date,
            newest: card.transactions[0].date
          } : null
        },
        billingCycles: {
          total: card.billingCycles.length,
          issues: [] as any[]
        },
        calculations: {
          currentCycleSpend: 0,
          issues: [] as any[]
        }
      };

      // Audit billing cycles
      const today = new Date();
      for (const cycle of card.billingCycles) {
        const cycleStart = new Date(cycle.startDate);
        const cycleEnd = new Date(cycle.endDate);
        const isCurrentCycle = today >= cycleStart && today <= cycleEnd;
        const isHistoricalCycle = cycleEnd < today;
        
        // Get transactions for this cycle
        const effectiveEndDate = cycleEnd > today ? today : cycleEnd;
        const cycleTransactions = card.transactions.filter(t => 
          t.date >= cycleStart && t.date <= effectiveEndDate
        );
        
        const transactionBasedSpend = cycleTransactions.reduce((sum, t) => {
          // Exclude payment transactions, include charges and refunds
          if (isPaymentTransaction(t.name)) {
            return sum; // Skip payments
          }
          return sum + t.amount; // Include charges (positive) and refunds (negative)
        }, 0);
        
        // For current cycles, calculate balance-based spend
        let calculatedSpend = transactionBasedSpend;
        if (isCurrentCycle) {
          const currentBalance = Math.abs(card.balanceCurrent || 0);
          const statementBalance = Math.abs(card.lastStatementBalance || 0);
          const balanceBasedSpend = Math.max(0, currentBalance - statementBalance);
          calculatedSpend = balanceBasedSpend;
          
          cardAudit.calculations.currentCycleSpend = balanceBasedSpend;
        }
        
        // Check for discrepancies
        const storedSpend = cycle.totalSpend || 0;
        const spendDiscrepancy = Math.abs(storedSpend - calculatedSpend);
        
        if (spendDiscrepancy > 0.01) { // More than 1 cent difference
          cardAudit.billingCycles.issues.push({
            cycleId: cycle.id,
            period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
            isCurrentCycle,
            isHistoricalCycle,
            storedTotalSpend: storedSpend,
            calculatedSpend,
            transactionBasedSpend,
            discrepancy: spendDiscrepancy,
            transactionCount: cycleTransactions.length,
            issue: 'SPEND_MISMATCH'
          });
        }
        
        // Check for missing statement balances on historical cycles
        if (isHistoricalCycle && transactionBasedSpend > 0 && !cycle.statementBalance) {
          cardAudit.billingCycles.issues.push({
            cycleId: cycle.id,
            period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
            isCurrentCycle,
            isHistoricalCycle,
            transactionBasedSpend,
            issue: 'MISSING_STATEMENT_BALANCE'
          });
        }
        
        // Check for cycles with statement balance but no transactions
        if (cycle.statementBalance && cycle.statementBalance > 0 && cycleTransactions.length === 0) {
          cardAudit.billingCycles.issues.push({
            cycleId: cycle.id,
            period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
            statementBalance: cycle.statementBalance,
            issue: 'STATEMENT_WITHOUT_TRANSACTIONS'
          });
        }
      }
      
      // Check credit card balance consistency
      if (card.balanceCurrent && card.lastStatementBalance) {
        const currentBalance = Math.abs(card.balanceCurrent);
        const statementBalance = Math.abs(card.lastStatementBalance);
        
        // Find current cycle
        const currentCycle = card.billingCycles.find(c => {
          const start = new Date(c.startDate);
          const end = new Date(c.endDate);
          return today >= start && today <= end;
        });
        
        if (currentCycle) {
          const expectedCurrentSpend = Math.max(0, currentBalance - statementBalance);
          const storedCurrentSpend = currentCycle.totalSpend || 0;
          
          if (Math.abs(expectedCurrentSpend - storedCurrentSpend) > 0.01) {
            cardAudit.calculations.issues.push({
              issue: 'CURRENT_CYCLE_SPEND_MISMATCH',
              currentBalance,
              statementBalance,
              expectedCurrentSpend,
              storedCurrentSpend,
              discrepancy: Math.abs(expectedCurrentSpend - storedCurrentSpend)
            });
          }
        }
      }
      
      console.log(`Audit results for ${card.name}:`, {
        billingCycleIssues: cardAudit.billingCycles.issues.length,
        calculationIssues: cardAudit.calculations.issues.length
      });
      
      auditResults.push(cardAudit);
    }
    
    // Summary statistics
    const summary = {
      totalCards: auditResults.length,
      cardsWithIssues: auditResults.filter(r => 
        r.billingCycles.issues.length > 0 || r.calculations.issues.length > 0
      ).length,
      totalBillingCycleIssues: auditResults.reduce((sum, r) => sum + r.billingCycles.issues.length, 0),
      totalCalculationIssues: auditResults.reduce((sum, r) => sum + r.calculations.issues.length, 0),
      issueTypes: {
        spendMismatches: auditResults.reduce((sum, r) => 
          sum + r.billingCycles.issues.filter(i => i.issue === 'SPEND_MISMATCH').length, 0),
        missingStatementBalances: auditResults.reduce((sum, r) => 
          sum + r.billingCycles.issues.filter(i => i.issue === 'MISSING_STATEMENT_BALANCE').length, 0),
        statementWithoutTransactions: auditResults.reduce((sum, r) => 
          sum + r.billingCycles.issues.filter(i => i.issue === 'STATEMENT_WITHOUT_TRANSACTIONS').length, 0),
        currentCycleSpendMismatches: auditResults.reduce((sum, r) => 
          sum + r.calculations.issues.filter(i => i.issue === 'CURRENT_CYCLE_SPEND_MISMATCH').length, 0)
      }
    };

    console.log('\n🔍 DATA AUDIT COMPLETED');
    console.log('Summary:', summary);
    
    return NextResponse.json({ 
      message: 'Data audit completed',
      summary,
      results: auditResults
    });
  } catch (error) {
    console.error('🔍 DATA AUDIT ERROR:', error);
    return NextResponse.json({ error: 'Failed to perform data audit' }, { status: 500 });
  }
}