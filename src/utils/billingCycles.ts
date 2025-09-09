import { supabaseAdmin } from '@/lib/supabase';
import { addMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';

// Helper function to detect Capital One cards based on institution and card names
function isCapitalOneCard(institutionName?: string, cardName?: string): boolean {
  const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
  const institutionMatch = institutionName?.toLowerCase().includes('capital one') || false;
  const cardMatch = capitalOneIndicators.some(indicator => 
    cardName?.toLowerCase().includes(indicator)
  ) || false;
  
  return institutionMatch || cardMatch;
}

// Helper function to identify payment transactions based on transaction name
export function isPaymentTransaction(transactionName: string): boolean {
  if (!transactionName) return false;
  
  const lowerName = transactionName.toLowerCase();
  
  // Common payment indicators across different banks
  const paymentIndicators = [
    'pymt',           // Capital One payments
    'payment',        // Amex and other banks (covers "Online Ach Payment Ref")
    'autopay',        // Automatic payments
    'mobile pymt',    // Mobile payments
    'web pymt',       // Web payments
    'transfer from', // Bank transfers from checking/savings
    'transfer to checking', // Transfers to checking
    'transfer to savings', // Transfers to savings
    'credit card pymt', // Credit card payments
    'cc pymt',        // Credit card payment abbreviation
    'bill pay',       // Bill payment
    'scheduled pymt', // Scheduled payments
    'recurring pymt', // Recurring payments
    'automatic debit', // Automatic debits
    'direct debit',   // Direct debits
    'e-payment',      // Electronic payments
    'epayment',       // Electronic payments (no dash)
    'online pymt',    // Online payments
    'phone pymt',     // Phone payments
    'bank pymt',      // Bank payments
    'ach credit',     // ACH credits (incoming payments to card)
    'ach debit',      // ACH debits
    'wire transfer',  // Wire transfers
    'balance transfer', // Balance transfers (these reduce balance like payments)
  ];
  
  // Check for any payment indicator
  const hasPaymentIndicator = paymentIndicators.some(indicator => lowerName.includes(indicator));
  
  // Additional checks for specific patterns that might be missed
  // Check for "payment" or "pymt" anywhere in the string (already covered above)
  // Check for "transfer" but exclude "balance transfer fee" or similar fee transactions
  const isTransferPayment = lowerName.includes('transfer') && 
                           !lowerName.includes('fee') && 
                           !lowerName.includes('charge');
  
  return hasPaymentIndicator || isTransferPayment;
}

export interface BillingCycleData {
  id: string;
  creditCardId: string;
  creditCardName: string;
  creditCardMask?: string;
  startDate: Date;
  endDate: Date;
  statementBalance?: number;
  minimumPayment?: number;
  dueDate?: Date;
  totalSpend: number;
  transactionCount: number;
}

export async function calculateBillingCycles(creditCardId: string): Promise<BillingCycleData[]> {
  // Get credit card data
  const { data: creditCard, error: cardError } = await supabaseAdmin
    .from('credit_cards')
    .select('*')
    .eq('id', creditCardId)
    .single();

  if (cardError || !creditCard) {
    throw new Error('Credit card not found');
  }

  // Get transactions for this credit card, ordered by date
  const { data: transactions, error: transactionsError } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('creditCardId', creditCardId)
    .order('date', { ascending: true });

  if (transactionsError) {
    throw new Error('Failed to fetch transactions');
  }

  // Add transactions to creditCard object to maintain compatibility
  const creditCardWithTransactions = {
    ...creditCard,
    transactions: transactions || [],
    // Convert date strings back to Date objects for compatibility
    lastStatementIssueDate: creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null,
    nextPaymentDueDate: creditCard.nextPaymentDueDate ? new Date(creditCard.nextPaymentDueDate) : null,
    openDate: creditCard.openDate ? new Date(creditCard.openDate) : null,
    annualFeeDueDate: creditCard.annualFeeDueDate ? new Date(creditCard.annualFeeDueDate) : null,
  };

  // Convert transaction dates to Date objects for compatibility
  const transactionsWithDates = (transactions || []).map(t => ({
    ...t,
    date: new Date(t.date),
    authorizedDate: t.authorizedDate ? new Date(t.authorizedDate) : null,
  }));

  // Update the credit card object with converted transactions
  creditCardWithTransactions.transactions = transactionsWithDates;

  const cycles: BillingCycleData[] = [];
  
  const lastStatementDate = creditCardWithTransactions.lastStatementIssueDate;
  const nextDueDate = creditCardWithTransactions.nextPaymentDueDate;
  
  if (!lastStatementDate) {
    return generateEstimatedCycles(creditCardWithTransactions, cycles);
  }

  const cycleLength = estimateCycleLength(creditCardWithTransactions, lastStatementDate, nextDueDate);
  
  const now = new Date();
  
  // Calculate the closed cycle that ends on the statement date (contains the statement balance)
  const closedCycleEnd = new Date(lastStatementDate);
  const closedCycleStart = new Date(closedCycleEnd);
  
  // Use the estimated cycle length from Plaid data for accurate cycle boundaries
  // This respects actual cycle lengths (28-31 days) rather than forcing calendar months
  closedCycleStart.setDate(closedCycleStart.getDate() - cycleLength + 1);
  
  // Create the closed cycle with statement balance
  await createOrUpdateCycle(creditCardWithTransactions, cycles, closedCycleStart, closedCycleEnd, nextDueDate, true, transactionsWithDates);
  
  // Calculate the current ongoing cycle that starts after the statement date
  const currentCycleStart = new Date(lastStatementDate);
  currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  const currentCycleEnd = new Date(currentCycleStart);
  // Use the same cycle length for consistency
  currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
  const currentDueDate = new Date(currentCycleEnd);
  currentDueDate.setDate(currentDueDate.getDate() + 21);
  
  // Create the current cycle (no statement balance yet)
  await createOrUpdateCycle(creditCardWithTransactions, cycles, currentCycleStart, currentCycleEnd, currentDueDate, false, transactionsWithDates);
  
  // Create historical cycles going back 12 months, but not before card open date
  let historicalCycleEnd = new Date(closedCycleStart);
  historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
  
  const oneYearAgo = new Date();
  oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
  
  // Don't create cycles before card open date
  const cardOpenDate = creditCardWithTransactions.openDate ? new Date(creditCardWithTransactions.openDate) : oneYearAgo;
  const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;
  
  while (historicalCycleEnd >= earliestCycleDate) {
    const historicalCycleStart = new Date(historicalCycleEnd);
    // Use the same cycle length for historical cycles
    historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);
    
    // Skip cycles only if they end before the card open date (no meaningful overlap)
    if (creditCardWithTransactions.openDate && historicalCycleEnd < new Date(creditCardWithTransactions.openDate)) {
      // Move to the next historical cycle instead of breaking
      historicalCycleEnd = new Date(historicalCycleStart);
      historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
      continue;
    }
    
    const historicalDueDate = new Date(historicalCycleEnd);
    historicalDueDate.setDate(historicalDueDate.getDate() + 21);
    
    // Historical cycles should NOT get Plaid's statement balance (that's only for the matching cycle)
    // Pass false for hasStatementBalance so they use totalSpend instead
    await createOrUpdateCycle(creditCardWithTransactions, cycles, historicalCycleStart, historicalCycleEnd, historicalDueDate, false, transactionsWithDates);
    
    historicalCycleEnd = new Date(historicalCycleStart);
    historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
  }

  return cycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

async function createOrUpdateCycle(
  creditCard: any,
  cycles: BillingCycleData[],
  cycleStart: Date,
  cycleEnd: Date,
  dueDate: Date | null,
  hasStatementBalance: boolean,
  transactionsWithDates: any[]
): Promise<void> {
  // For current cycles, cap the transaction search at today to get accurate spend calculation
  const today = new Date();
  const effectiveEndDate = cycleEnd > today ? today : cycleEnd;
  
  const cycleTransactions = creditCard.transactions.filter((t: any) => 
    t.date >= cycleStart && t.date <= effectiveEndDate
  );

  // Properly calculate spend: include charges and refunds, but exclude payments
  let totalSpend = cycleTransactions.reduce((sum: number, t: any) => {
    // Check if this is a payment transaction based on the name
    if (isPaymentTransaction(t.name)) {
      // Skip payment transactions regardless of sign
      return sum;
    }
    
    // Include all non-payment transactions:
    // - Positive amounts = charges/purchases
    // - Negative amounts = refunds/returns (should be included to reduce spend)
    return sum + t.amount;
  }, 0);
  
  // For current cycles, use transaction-based calculation from actual transactions in the cycle
  if (cycleEnd > today && !hasStatementBalance) {
    // Filter to only authorized transactions (exclude pending)
    const authorizedTransactions = cycleTransactions.filter((t: any) => 
      t.authorizedDate !== null
    );
    
    const authorizedSpend = authorizedTransactions.reduce((sum: number, t: any) => {
      // Exclude payment transactions, include charges and refunds
      if (isPaymentTransaction(t.name)) {
        return sum; // Skip payments
      }
      return sum + t.amount; // Include charges (positive) and refunds (negative)
    }, 0);
    
    // Use transaction-based calculation for current cycles (from actual cycle transactions)
    totalSpend = authorizedSpend;
    
    console.log(`📊 Current cycle spend for ${creditCard.name}: ${totalSpend} (${authorizedTransactions.length} authorized transactions in cycle)`);
  }
  
  // For closed cycles, only use the actual statement balance for the EXACT statement cycle
  // For all other historical cycles, use transaction-based totals
  const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
  const isExactStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
  
  if (hasStatementBalance && creditCard.lastStatementBalance && isExactStatementCycle) {
    // Even for statement cycles, we should use transaction-based totals for totalSpend
    // The statement balance includes payments, but totalSpend should be actual spending only
    const statementAmount = Math.abs(creditCard.lastStatementBalance);
    console.log(`📊 Statement cycle for ${creditCard.name} ending ${cycleEnd.toISOString().split('T')[0]}`);
    console.log(`   Statement balance: $${statementAmount.toFixed(2)}`);
    console.log(`   Actual spend (excluding payments): $${totalSpend.toFixed(2)}`);
    // Keep the transaction-based totalSpend, don't override with statement balance
    // totalSpend already calculated above excludes payments correctly
  }

  // Check if cycle already exists - match by start date to prevent overlapping cycles
  const { data: existingCycle, error: findError } = await supabaseAdmin
    .from('billing_cycles')
    .select('*')
    .eq('creditCardId', creditCard.id)
    .eq('startDate', cycleStart.toISOString())
    .single();

  if (findError && findError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    throw new Error(`Failed to check existing cycle: ${findError.message}`);
  }

  let statementBalance = null;
  let minimumPayment = null;
  
  console.log(`📊 Billing cycle processing for ${creditCard.name} ending ${cycleEnd.toDateString()}:`, {
    hasStatementBalance,
    cycleEnd: cycleEnd.toDateString(),
    totalSpend
  });
  
  if (hasStatementBalance) {
    const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
    
    // Check if this is the statement cycle (most recent closed cycle still within payment period)
    const today = new Date();
    const isClosedCycle = cycleEnd < today;
    const isWithinPaymentPeriod = dueDate && dueDate >= today;
    const isStatementCycle = (lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime()) ||
                           (isClosedCycle && isWithinPaymentPeriod && hasStatementBalance);

    console.log(`🏦 Statement cycle identification for ${creditCard.name} cycle ending ${cycleEnd.toDateString()}:`, {
      lastStatementDate: lastStatementDate?.toDateString(),
      isClosedCycle,
      isWithinPaymentPeriod,
      hasStatementBalance,
      isStatementCycle,
      dueDate: dueDate?.toDateString(),
      exactDateMatch: lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime(),
      willGetPaymentDetection: isStatementCycle
    });
    
    if (isStatementCycle) {
      console.log(`🎯 STATEMENT CYCLE CONFIRMED for ${creditCard.name} ending ${cycleEnd.toDateString()} - will check for payments`);
    } else {
      console.log(`❌ NOT statement cycle for ${creditCard.name} ending ${cycleEnd.toDateString()} - no payment detection`);
    }
    
    if (isStatementCycle) {
      // This is the exact cycle that corresponds to the last statement
      statementBalance = creditCard.lastStatementBalance;
      minimumPayment = creditCard.minimumPaymentAmount;
      
      // Payment detection: If current balance is lower than statement balance,
      // find recent payment transactions and subtract them from statement balance
      const currentBalance = Math.abs(creditCard.balanceCurrent || 0);
      const originalStatementBalance = Math.abs(creditCard.lastStatementBalance || 0);
      
      console.log(`🔍 Payment detection debug for ${creditCard.name}:`, {
        currentBalance,
        originalStatementBalance,
        conditionMet: originalStatementBalance > 0 && currentBalance < originalStatementBalance,
        statementDate: lastStatementDate?.toDateString(),
        transactionCount: transactionsWithDates.filter(t => !isPaymentTransaction(t.name || '')).length
      });

      if (originalStatementBalance > 0 && currentBalance < originalStatementBalance) {
        // Look for payment transactions since the last statement date
        const statementDate = lastStatementDate;
        
        // Debug: Show ALL recent transactions first
        const allRecentTransactions = transactionsWithDates.filter(t => 
          statementDate && t.date > statementDate
        );
        
        console.log(`📅 All transactions after ${statementDate?.toDateString()}:`, 
          allRecentTransactions.map(t => ({
            name: t.name,
            amount: t.amount,
            date: t.date.toDateString(),
            isPayment: isPaymentTransaction(t.name),
            isNegative: t.amount < 0
          }))
        );
        
        const recentPayments = transactionsWithDates.filter(t => 
          statementDate && t.date > statementDate && // After statement date
          isPaymentTransaction(t.name) // Is a payment transaction (amount sign may vary)
        );
        
        console.log(`💰 Filtered payment transactions:`, recentPayments.length);
        
        // Sum up the payment amounts (they're negative, so we need to make them positive)
        const totalPayments = recentPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        
        // Check if there's a payment that matches the statement balance (within $5 tolerance)
        const statementMatchingPayment = recentPayments.find(t => {
          const paymentAmount = Math.abs(t.amount);
          const difference = Math.abs(paymentAmount - originalStatementBalance);
          return difference <= 5; // Allow $5 tolerance for rounding/fees
        });
        
        if (statementMatchingPayment) {
          console.log(`✅ Found statement balance payment for ${creditCard.name}:`, {
            paymentAmount: Math.abs(statementMatchingPayment.amount),
            statementBalance: originalStatementBalance,
            difference: Math.abs(Math.abs(statementMatchingPayment.amount) - originalStatementBalance),
            paymentDate: statementMatchingPayment.date.toDateString(),
            paymentName: statementMatchingPayment.name
          });
        }
        
        if (totalPayments > 0) {
          console.log(`💳 Payment detected for ${creditCard.name}:`, {
            currentBalance,
            originalStatementBalance,
            totalPayments,
            recentPayments: recentPayments.map(p => ({ name: p.name, amount: p.amount, date: p.date }))
          });
          
          // Keep the original cycle balance (totalSpend) for display
          // The payment detection is for card-level statement balance, not individual cycles
          statementBalance = totalSpend > 0 ? totalSpend : Math.abs(creditCard.lastStatementBalance || 0);
          
          // Adjust minimum payment if statement was paid off
          const remainingStatementBalance = Math.max(0, originalStatementBalance - totalPayments);
          if (remainingStatementBalance === 0) {
            minimumPayment = 0;
            console.log(`✅ PAYMENT DETECTED - Setting minimumPayment = 0 for ${creditCard.name} cycle ending ${cycleEnd.toDateString()}`, {
              originalStatementBalance,
              totalPayments,
              remainingStatementBalance,
              currentBalance,
              cycleEndDate: cycleEnd.toDateString(),
              paymentTransactions: recentPayments.map(p => ({
                name: p.name,
                amount: p.amount,
                date: p.date.toDateString()
              }))
            });
          } else {
            console.log(`⚠️ NO PAYMENT DETECTED for ${creditCard.name} cycle ending ${cycleEnd.toDateString()}`, {
              originalStatementBalance,
              totalPayments,
              remainingStatementBalance,
              currentBalance,
              recentPaymentsCount: recentPayments.length
            });
          }
        }
      }
    } else {
      // This is a historical completed cycle - ALWAYS use calculated spend from transactions
      // Don't use the last statement balance for historical cycles
      statementBalance = totalSpend > 0 ? totalSpend : 0; // Use 0 instead of null for empty cycles
      minimumPayment = totalSpend > 0 ? Math.max(25, totalSpend * 0.02) : 0; // Estimate 2% minimum payment
    }
  }

  if (!existingCycle) {
    // Create new cycle
    const { data: newCycle, error: createError } = await supabaseAdmin
      .from('billing_cycles')
      .insert({
        id: crypto.randomUUID(),
        creditCardId: creditCard.id,
        creditcardname: creditCard.name,
        transactioncount: cycleTransactions?.length || 0,
        startDate: cycleStart.toISOString(),
        endDate: cycleEnd.toISOString(),
        statementBalance,
        minimumPayment,
        dueDate: dueDate?.toISOString() || null,
        totalSpend,
        updatedAt: new Date().toISOString(),
      })
      .select();

    if (createError || !newCycle || newCycle.length === 0) {
      throw new Error(`Failed to create billing cycle: ${createError?.message || 'No data returned'}`);
    }
    
    const createdCycle = Array.isArray(newCycle) ? newCycle[0] : newCycle;

    cycles.push({
      id: createdCycle.id,
      creditCardId: creditCard.id,
      creditCardName: creditCard.name,
      creditCardMask: creditCard.mask,
      startDate: cycleStart,
      endDate: cycleEnd,
      statementBalance: statementBalance !== null ? statementBalance : undefined,
      minimumPayment: minimumPayment !== null ? minimumPayment : undefined,
      dueDate: dueDate || undefined,
      totalSpend,
      transactionCount: cycleTransactions?.filter(t => !isPaymentTransaction(t.name || '')).length || 0,
    });
  } else {
    console.log(`🔄 Updating existing billing cycle for ${creditCard.name} starting ${cycleStart.toDateString()}`);
    if (existingCycle.endDate !== cycleEnd.toISOString()) {
      console.log(`📅 End date changed: ${existingCycle.endDate} → ${cycleEnd.toISOString()}`);
    }
    
    // Always update existing cycles to ensure transaction-based totals are current
    const { data: updatedCycle, error: updateError } = await supabaseAdmin
      .from('billing_cycles')
      .update({
        creditcardname: creditCard.name,
        transactioncount: cycleTransactions?.length || 0,
        endDate: cycleEnd.toISOString(), // Update end date if calculation changed
        statementBalance,
        minimumPayment,
        dueDate: dueDate?.toISOString() || null,
        totalSpend,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', existingCycle.id)
      .select();

    if (updateError || !updatedCycle || updatedCycle.length === 0) {
      console.error(`Failed to update billing cycle ${existingCycle.id}:`, updateError);
      throw new Error(`Failed to update billing cycle: ${updateError?.message || 'No rows affected'}`);
    }
    
    const modifiedCycle = Array.isArray(updatedCycle) ? updatedCycle[0] : updatedCycle;

    cycles.push({
      id: modifiedCycle.id,
      creditCardId: creditCard.id,
      creditCardName: creditCard.name,
      creditCardMask: creditCard.mask,
      startDate: cycleStart,
      endDate: cycleEnd,
      statementBalance: statementBalance !== null ? statementBalance : undefined,
      minimumPayment: minimumPayment !== null ? minimumPayment : undefined,
      dueDate: dueDate || undefined,
      totalSpend,
      transactionCount: cycleTransactions?.filter(t => !isPaymentTransaction(t.name || '')).length || 0,
    });
  }
}

// Helper function to estimate cycle length based on statement and due dates
function estimateCycleLength(creditCard: any, lastStatementDate: Date, nextDueDate: Date | null): number {
  // Default cycle length is 30 days
  let cycleLength = 30;

  if (nextDueDate) {
    // Estimate cycle length based on grace period (typically 21-25 days)
    const gracePeriod = differenceInDays(nextDueDate, lastStatementDate);
    
    if (gracePeriod >= 20 && gracePeriod <= 25) {
      cycleLength = 30; // Standard monthly cycle
    } else if (gracePeriod >= 26 && gracePeriod <= 32) {
      cycleLength = 31; // Slightly longer cycle
    }
  }

  return cycleLength;
}

// Fallback function for cards without statement dates
async function generateEstimatedCycles(creditCard: any, cycles: BillingCycleData[]): Promise<BillingCycleData[]> {
  // For cards without statement data, create estimated cycles based on transactions
  const transactions = creditCard.transactions || [];
  
  if (transactions.length === 0) {
    return cycles;
  }

  const oldestTransaction = new Date(Math.min(...transactions.map((t: any) => new Date(t.date).getTime())));
  const newestTransaction = new Date(Math.max(...transactions.map((t: any) => new Date(t.date).getTime())));
  
  // Create monthly cycles from oldest to newest transaction
  let currentCycleStart = startOfMonth(oldestTransaction);
  const today = new Date();
  
  while (currentCycleStart <= endOfMonth(newestTransaction)) {
    const currentCycleEnd = endOfMonth(currentCycleStart);
    const currentDueDate = new Date(currentCycleEnd);
    currentDueDate.setDate(currentDueDate.getDate() + 21);
    
    const isHistorical = currentCycleEnd < today;
    
    await createOrUpdateCycle(creditCard, cycles, currentCycleStart, currentCycleEnd, currentDueDate, isHistorical, creditCard.transactions);
    
    currentCycleStart = addMonths(currentCycleStart, 1);
  }

  return cycles;
}

export async function getAllUserBillingCycles(userId: string): Promise<BillingCycleData[]> {
  // Get all plaid items for the user
  const { data: plaidItems, error: plaidError } = await supabaseAdmin
    .from('plaid_items')
    .select('*')
    .eq('userId', userId);

  if (plaidError) {
    throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
  }

  // Get all credit cards for these plaid items
  const plaidItemIds = (plaidItems || []).map(item => item.id);
  if (plaidItemIds.length === 0) {
    return [];
  }

  const { data: creditCards, error: cardsError } = await supabaseAdmin
    .from('credit_cards')
    .select('*')
    .in('plaidItemId', plaidItemIds);

  if (cardsError) {
    throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
  }

  const allCycles: BillingCycleData[] = [];
  
  // Create a map of plaidItem data for easy lookup
  const plaidItemMap = new Map();
  (plaidItems || []).forEach(item => {
    plaidItemMap.set(item.id, item);
  });
  
  for (const card of creditCards || []) {
    const cycles = await calculateBillingCycles(card.id);
    
    // Get the associated plaid item
    const plaidItem = plaidItemMap.get(card.plaidItemId);
    
    // Filter cycles to only include those that end after card open date (overlaps with card opening)
    let filteredCycles = cycles;
    if (card.openDate) {
      const cardOpenDate = new Date(card.openDate);
      
      filteredCycles = cycles.filter(cycle => {
        const cycleEnd = new Date(cycle.endDate);
        // A cycle is valid if it ends after the card open date (overlaps with card opening)
        // This allows partial cycles where the start is before open date but end is after
        const isValid = cycleEnd >= cardOpenDate;
        
        return isValid;
      });
    }
    
    // Apply Capital One-specific cycle limiting
    const isCapitalOne = isCapitalOneCard(plaidItem?.institutionName, card.name);
    
    // Debug: Log cycle limiting decisions
    console.log(`🔍 Cycle limiting decision for ${card.name}:`, {
      cardName: card.name,
      institutionName: plaidItem?.institutionName,
      isCapitalOne,
      totalCyclesBeforeLimit: filteredCycles.length
    });
    
    if (isCapitalOne) {
      // For Capital One cards, limit to 4 most recent cycles (90 days = ~3-4 billing cycles)
      const limitedCycles = filteredCycles
        .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
        .slice(0, 4);
      
      allCycles.push(...limitedCycles);
    } else {
      // Standard cards: show 12 months of cycles
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      
      // Filter to only cycles from the last 12 months
      const recentCycles = filteredCycles.filter(cycle => 
        new Date(cycle.endDate) >= twelveMonthsAgo
      );
      
      allCycles.push(...recentCycles);
    }
  }

  return allCycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

/**
 * Calculate only the current/most recent billing cycle for fast loading
 * Used for instant card setup to show immediate card data
 */
export async function calculateCurrentBillingCycle(creditCardId: string): Promise<BillingCycleData | null> {
  try {
    // Get credit card data
    const { data: creditCard, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('id', creditCardId)
      .single();

    if (cardError || !creditCard) {
      console.warn('Credit card not found for current cycle calculation');
      return null;
    }

    // Get only recent transactions (last 60 days) for current cycle
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: recentTransactions, error: transactionsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', creditCardId)
      .gte('date', sixtyDaysAgo.toISOString())
      .order('date', { ascending: true });

    if (transactionsError) {
      console.warn('Failed to fetch recent transactions for current cycle:', transactionsError);
      return null;
    }

    // Convert date strings to Date objects
    const transactionsWithDates = (recentTransactions || []).map(t => ({
      ...t,
      date: new Date(t.date),
      authorizedDate: t.authorizedDate ? new Date(t.authorizedDate) : null,
    }));

    // Calculate current/most recent cycle
    let currentCycleStart: Date;
    let currentCycleEnd: Date;

    if (creditCard.lastStatementIssueDate) {
      // Use statement date as base for current cycle
      const lastStatementDate = new Date(creditCard.lastStatementIssueDate);
      currentCycleStart = lastStatementDate;
      currentCycleEnd = new Date(lastStatementDate);
      currentCycleEnd.setMonth(currentCycleEnd.getMonth() + 1);
    } else {
      // Estimate current cycle from transaction patterns
      const now = new Date();
      currentCycleEnd = now;
      currentCycleStart = new Date(now);
      currentCycleStart.setMonth(currentCycleStart.getMonth() - 1);
    }

    // Get transactions for this cycle
    const cycleTransactions = transactionsWithDates.filter(t => 
      t.date >= currentCycleStart && t.date <= currentCycleEnd
    );

    // Calculate spending for this cycle (exclude payments but include refunds)
    const nonPaymentTransactions = cycleTransactions.filter(t => !isPaymentTransaction(t.name || ''));
    const totalSpend = nonPaymentTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Create or update the current billing cycle
    const cycleId = `${creditCardId}_${currentCycleStart.toISOString().split('T')[0]}_${currentCycleEnd.toISOString().split('T')[0]}`;

    const { data: existingCycle } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', creditCardId)
      .eq('startDate', currentCycleStart.toISOString().split('T')[0])
      .eq('endDate', currentCycleEnd.toISOString().split('T')[0])
      .single();

    if (existingCycle) {
      // Update existing cycle
      const { data: updatedCycle, error: updateError } = await supabaseAdmin
        .from('billing_cycles')
        .update({
          totalSpend,
          transactionCount: nonPaymentTransactions.length,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', existingCycle.id)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update current billing cycle:', updateError);
        return null;
      }

      return {
        id: updatedCycle.id,
        creditCardId: creditCard.id,
        creditCardName: creditCard.name,
        creditCardMask: creditCard.mask,
        startDate: currentCycleStart,
        endDate: currentCycleEnd,
        statementBalance: updatedCycle.statementBalance || undefined,
        minimumPayment: updatedCycle.minimumPayment || undefined,
        dueDate: updatedCycle.dueDate ? new Date(updatedCycle.dueDate) : undefined,
        totalSpend,
        transactionCount: nonPaymentTransactions.length,
      };
    } else {
      // Create new current cycle
      const { data: newCycle, error: insertError } = await supabaseAdmin
        .from('billing_cycles')
        .insert({
          id: cycleId,
          creditCardId: creditCard.id,
          startDate: currentCycleStart.toISOString().split('T')[0],
          endDate: currentCycleEnd.toISOString().split('T')[0],
          totalSpend,
          transactionCount: nonPaymentTransactions.length,
          paymentStatus: 'current', // Current cycle is always in progress
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to create current billing cycle:', insertError);
        return null;
      }

      return {
        id: newCycle.id,
        creditCardId: creditCard.id,
        creditCardName: creditCard.name,
        creditCardMask: creditCard.mask,
        startDate: currentCycleStart,
        endDate: currentCycleEnd,
        totalSpend,
        transactionCount: nonPaymentTransactions.length,
      };
    }
  } catch (error) {
    console.error('Error calculating current billing cycle:', error);
    return null;
  }
}

/**
 * Calculate the most recent closed billing cycle for fast loading
 * Used for instant card setup to show the recently closed cycle with totalSpend
 */
export async function calculateRecentClosedCycle(creditCardId: string): Promise<BillingCycleData | null> {
  try {
    // Get credit card data
    const { data: creditCard, error: cardError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .eq('id', creditCardId)
      .single();

    if (cardError || !creditCard) {
      console.warn('Credit card not found for recent closed cycle calculation');
      return null;
    }

    // Get recent transactions (last 90 days) to capture the closed cycle
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: recentTransactions, error: transactionsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('creditCardId', creditCardId)
      .gte('date', ninetyDaysAgo.toISOString())
      .order('date', { ascending: true });

    if (transactionsError) {
      console.warn('Failed to fetch recent transactions for closed cycle:', transactionsError);
      return null;
    }

    // Convert date strings to Date objects
    const transactionsWithDates = (recentTransactions || []).map(t => ({
      ...t,
      date: new Date(t.date),
      authorizedDate: t.authorizedDate ? new Date(t.authorizedDate) : null,
    }));

    // Calculate recent closed cycle (previous month)
    let closedCycleStart: Date;
    let closedCycleEnd: Date;

    if (creditCard.lastStatementIssueDate) {
      // Use statement date as base - go back one cycle
      const lastStatementDate = new Date(creditCard.lastStatementIssueDate);
      closedCycleEnd = lastStatementDate;
      closedCycleStart = new Date(lastStatementDate);
      closedCycleStart.setMonth(closedCycleStart.getMonth() - 1);
    } else {
      // Estimate closed cycle from current date - go back one month
      const now = new Date();
      closedCycleStart = new Date(now);
      closedCycleStart.setMonth(closedCycleStart.getMonth() - 2); // 2 months back for start
      closedCycleEnd = new Date(now);
      closedCycleEnd.setMonth(closedCycleEnd.getMonth() - 1); // 1 month back for end
    }

    // Get transactions for this closed cycle
    const cycleTransactions = transactionsWithDates.filter(t => 
      t.date >= closedCycleStart && t.date <= closedCycleEnd
    );

    // Skip if no transactions found for this period
    if (cycleTransactions.length === 0) {
      console.log('No transactions found for recent closed cycle period');
      return null;
    }

    // Calculate spending for this cycle (exclude payments but include refunds)
    const nonPaymentTransactions = cycleTransactions.filter(t => !isPaymentTransaction(t.name || ''));
    const totalSpend = nonPaymentTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Check if this cycle matches Plaid's statement date
    const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
    const isExactStatementCycle = lastStatementDate && closedCycleEnd.getTime() === lastStatementDate.getTime();
    
    // Only use Plaid's statement balance for the exact matching cycle
    const cycleStatementBalance = isExactStatementCycle && creditCard.lastStatementBalance 
      ? creditCard.lastStatementBalance 
      : totalSpend;

    // Create or update the closed billing cycle
    const cycleId = `${creditCardId}_${closedCycleStart.toISOString().split('T')[0]}_${closedCycleEnd.toISOString().split('T')[0]}`;

    const { data: existingCycle } = await supabaseAdmin
      .from('billing_cycles')
      .select('*')
      .eq('creditCardId', creditCardId)
      .eq('startDate', closedCycleStart.toISOString().split('T')[0])
      .eq('endDate', closedCycleEnd.toISOString().split('T')[0])
      .single();

    if (existingCycle) {
      // Update existing closed cycle
      const { data: updatedCycle, error: updateError } = await supabaseAdmin
        .from('billing_cycles')
        .update({
          totalSpend,
          transactionCount: nonPaymentTransactions.length,
          // Use the determined statement balance (either Plaid's for matching cycle or totalSpend)
          statementBalance: cycleStatementBalance,
          paymentStatus: 'due', // Closed cycles are typically due
          updatedAt: new Date().toISOString(),
        })
        .eq('id', existingCycle.id)
        .select()
        .single();

      if (updateError) {
        console.error('Failed to update recent closed billing cycle:', updateError);
        return null;
      }

      return {
        id: updatedCycle.id,
        creditCardId: creditCard.id,
        creditCardName: creditCard.name,
        creditCardMask: creditCard.mask,
        startDate: closedCycleStart,
        endDate: closedCycleEnd,
        statementBalance: updatedCycle.statementBalance || undefined,
        minimumPayment: updatedCycle.minimumPayment || undefined,
        // nextPaymentDueDate may already be a string; normalize safely
        dueDate: creditCard.nextPaymentDueDate ? new Date(creditCard.nextPaymentDueDate as any) : undefined,
        totalSpend,
        transactionCount: nonPaymentTransactions.length,
      };
    } else {
      // Create new closed cycle
      // Normalize due date to YYYY-MM-DD string if provided (accepts Date or string)
      const dueDateVal = creditCard.nextPaymentDueDate
        ? new Date(creditCard.nextPaymentDueDate as any).toISOString().split('T')[0]
        : null;

      const { data: newCycle, error: insertError } = await supabaseAdmin
        .from('billing_cycles')
        .insert({
          id: cycleId,
          creditCardId: creditCard.id,
          startDate: closedCycleStart.toISOString().split('T')[0],
          endDate: closedCycleEnd.toISOString().split('T')[0],
          totalSpend,
          transactionCount: nonPaymentTransactions.length,
          statementBalance: cycleStatementBalance, // Use the determined statement balance
          dueDate: dueDateVal,
          paymentStatus: 'due', // Closed cycles are typically due
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to create recent closed billing cycle:', insertError);
        return null;
      }

      return {
        id: newCycle.id,
        creditCardId: creditCard.id,
        creditCardName: creditCard.name,
        creditCardMask: creditCard.mask,
        startDate: closedCycleStart,
        endDate: closedCycleEnd,
        statementBalance: newCycle.statementBalance || undefined,
        minimumPayment: newCycle.minimumPayment || undefined,
        dueDate: creditCard.nextPaymentDueDate ? new Date(creditCard.nextPaymentDueDate as any) : undefined,
        totalSpend,
        transactionCount: nonPaymentTransactions.length,
      };
    }
  } catch (error) {
    console.error('Error calculating recent closed billing cycle:', error);
    return null;
  }
}
