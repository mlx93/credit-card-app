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
  closedCycleStart.setDate(closedCycleStart.getDate() - cycleLength + 1);
  
  // Create the closed cycle with statement balance
  await createOrUpdateCycle(creditCardWithTransactions, cycles, closedCycleStart, closedCycleEnd, nextDueDate, true);
  
  // Calculate the current ongoing cycle that starts after the statement date
  const currentCycleStart = new Date(lastStatementDate);
  currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  const currentCycleEnd = new Date(currentCycleStart);
  currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
  const currentDueDate = new Date(currentCycleEnd);
  currentDueDate.setDate(currentDueDate.getDate() + 21);
  
  // Create the current cycle (no statement balance yet)
  await createOrUpdateCycle(creditCardWithTransactions, cycles, currentCycleStart, currentCycleEnd, currentDueDate, false);
  
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
    
    // Historical cycles that have ended should be treated as having statement balances
    const isCompletedCycle = historicalCycleEnd < now;
    await createOrUpdateCycle(creditCardWithTransactions, cycles, historicalCycleStart, historicalCycleEnd, historicalDueDate, isCompletedCycle);
    
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
  hasStatementBalance: boolean
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
  
  // For current cycles, use balance-based calculation to exclude pending transactions
  if (cycleEnd > today && !hasStatementBalance) {
    // Current cycle: committed charges = current balance - statement balance
    const currentBalance = Math.abs(creditCard.balanceCurrent || 0);
    const statementBalance = Math.abs(creditCard.lastStatementBalance || 0);
    const committedSpend = Math.max(0, currentBalance - statementBalance);
    
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
    
    // Use balance-based calculation for current cycles (excludes pending transactions)
    totalSpend = committedSpend;
  }
  
  // For closed cycles, only use the actual statement balance for the EXACT statement cycle
  // For all other historical cycles, use transaction-based totals
  const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
  const isExactStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
  
  if (hasStatementBalance && creditCard.lastStatementBalance && isExactStatementCycle) {
    // Only for the exact statement cycle, use the actual statement balance
    const statementAmount = Math.abs(creditCard.lastStatementBalance);
    
    // For the statement cycle, prefer the actual statement balance
    totalSpend = statementAmount;
  }

  // Check if cycle already exists
  const { data: existingCycle, error: findError } = await supabaseAdmin
    .from('billing_cycles')
    .select('*')
    .eq('creditCardId', creditCard.id)
    .eq('startDate', cycleStart.toISOString())
    .eq('endDate', cycleEnd.toISOString())
    .single();

  if (findError && findError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    throw new Error(`Failed to check existing cycle: ${findError.message}`);
  }

  let statementBalance = null;
  let minimumPayment = null;
  
  if (hasStatementBalance) {
    const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
    
    // Check if this cycle ends exactly on the last statement date (most recent closed cycle)
    const isStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
    
    if (isStatementCycle) {
      // This is the exact cycle that corresponds to the last statement - use actual statement balance
      statementBalance = creditCard.lastStatementBalance;
      minimumPayment = creditCard.minimumPaymentAmount;
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
      .select()
      .single();

    if (createError || !newCycle) {
      throw new Error(`Failed to create billing cycle: ${createError?.message}`);
    }

    cycles.push({
      id: newCycle.id,
      creditCardId: creditCard.id,
      creditCardName: creditCard.name,
      creditCardMask: creditCard.mask,
      startDate: cycleStart,
      endDate: cycleEnd,
      statementBalance: statementBalance || undefined,
      minimumPayment: minimumPayment || undefined,
      dueDate: dueDate || undefined,
      totalSpend,
      transactionCount: cycleTransactions?.length || 0,
    });
  } else {
    // Always update existing cycles to ensure transaction-based totals are current
    const { data: updatedCycle, error: updateError } = await supabaseAdmin
      .from('billing_cycles')
      .update({
        creditcardname: creditCard.name,
        transactioncount: cycleTransactions?.length || 0,
        statementBalance,
        minimumPayment,
        dueDate: dueDate?.toISOString() || null,
        totalSpend,
      })
      .eq('id', existingCycle.id)
      .select()
      .single();

    if (updateError || !updatedCycle) {
      throw new Error(`Failed to update billing cycle: ${updateError?.message}`);
    }

    cycles.push({
      id: updatedCycle.id,
      creditCardId: creditCard.id,
      creditCardName: creditCard.name,
      creditCardMask: creditCard.mask,
      startDate: cycleStart,
      endDate: cycleEnd,
      statementBalance: statementBalance || undefined,
      minimumPayment: minimumPayment || undefined,
      dueDate: dueDate || undefined,
      totalSpend,
      transactionCount: cycleTransactions?.length || 0,
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
    
    await createOrUpdateCycle(creditCard, cycles, currentCycleStart, currentCycleEnd, currentDueDate, isHistorical);
    
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
      // Standard cards: show all cycles (typically 12+ for 2 years of data)
      allCycles.push(...filteredCycles);
    }
  }

  return allCycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}