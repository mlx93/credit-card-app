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

// Helper function to detect Robinhood cards
function isRobinhoodCard(institutionId?: string, institutionName?: string): boolean {
  return institutionId === 'ins_54' || /robinhood/i.test(institutionName || '');
}

// Helper function to get the effective transaction date based on institution
function getEffectiveTransactionDate(transaction: any, institutionId?: string, institutionName?: string): Date {
  const isRobinhood = isRobinhoodCard(institutionId, institutionName);
  
  if (isRobinhood) {
    // For Robinhood, always use posted date (transaction.date) to align with billing cycles
    return transaction.date;
  } else {
    // For other institutions, use posted date as well (transaction.date is the standard)
    // Could potentially use authorized_date for different behavior if needed in the future
    return transaction.date;
  }
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
  transactioncount: number;
}

export async function calculateBillingCycles(
  creditCardId: string,
  options?: {
    statementPeriods?: { startDate: Date | null; endDate: Date; dueDate?: Date | null }[];
    baselineDueDate?: Date | null;
  }
): Promise<BillingCycleData[]> {
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

  // If explicit statement periods are provided, build cycles strictly from them
  if (options?.statementPeriods && options.statementPeriods.length > 0) {
    const provided = [...options.statementPeriods]
      .filter(p => p.endDate instanceof Date && !isNaN(p.endDate.getTime()))
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());

    const baselineDue = options.baselineDueDate || nextDueDate || null;
    const baselineDay = baselineDue ? new Date(baselineDue).getDate() : null;

    // Helper to estimate historical due date as same day-of-month as baseline due date
    const estimateHistoricalDue = (cycleEnd: Date): Date | null => {
      if (!baselineDay) return null;
      const m = cycleEnd.getMonth() + 1; // next month
      const y = cycleEnd.getFullYear() + (m > 11 ? 1 : 0);
      const nextMonth = (m % 12);
      const daysInMonth = new Date(y, nextMonth + 1, 0).getDate();
      const day = Math.min(baselineDay, daysInMonth);
      return new Date(y, nextMonth, day);
    };

    // Create cycles for each statement period (historical closed cycles)
    for (let i = 0; i < provided.length; i++) {
      const period = provided[i];
      // Skip if startDate is missing (cannot create a proper window) and there is no older statement to infer
      if (!period.startDate) {
        // If we have the next older period, it would have given us a start; skip this one
        continue;
      }
      const isMostRecentClosed = lastStatementDate && period.endDate.getTime() === lastStatementDate.getTime();
      const due = isMostRecentClosed ? (nextDueDate || null) : (period.dueDate ?? estimateHistoricalDue(period.endDate));
      await createOrUpdateCycle(
        creditCardWithTransactions,
        cycles,
        period.startDate,
        period.endDate,
        due,
        true,
        transactionsWithDates
      );
    }

    // Also include current open cycle if we have a last statement anchor
    if (lastStatementDate) {
      const currentCycleStart = new Date(lastStatementDate);
      currentCycleStart.setDate(currentCycleStart.getDate() + 1);
      // End = same day-of-month as anchor, one month into the future (clamped for month length)
      const anchor = new Date(lastStatementDate);
      const y = anchor.getFullYear();
      const m = anchor.getMonth() + 1; // next month
      const y2 = y + (m > 11 ? 1 : 0);
      const m2 = (m % 12);
      const targetDay = anchor.getDate();
      const dim = new Date(y2, m2 + 1, 0).getDate();
      const currentCycleEnd = new Date(y2, m2, Math.min(targetDay, dim));
      const currentDue = null; // Do not guess due date for open cycle
      await createOrUpdateCycle(
        creditCardWithTransactions,
        cycles,
        currentCycleStart,
        currentCycleEnd,
        currentDue,
        false,
        transactionsWithDates
      );
    }

    return cycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  }

  // Fallback: if no statement periods are available, avoid inventing historical cycles.
  // Only create a best-effort current cycle (no backfill) when no statement anchor exists.
  if (!lastStatementDate) {
    const today = new Date();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    await createOrUpdateCycle(
      creditCardWithTransactions,
      cycles,
      sixtyDaysAgo,
      today,
      null,
      false,
      transactionsWithDates
    );
    return cycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  }

  // Build cycles based on the anchor's day-of-month (or manual config if present)
  const baselineDue = nextDueDate || null;
  const baselineDay = baselineDue ? new Date(baselineDue).getDate() : null;
  const anchorEnd = new Date(lastStatementDate);
  // Get baseline closing day for same_day type (days_before_end is calculated per month)
  let baselineClosingDay = anchorEnd.getDate();
  const cycleDateType = (creditCardWithTransactions as any).cycle_date_type;
  
  if (creditCardWithTransactions.manual_dates_configured) {
    if (cycleDateType === 'same_day' && creditCardWithTransactions.manual_cycle_day) {
      baselineClosingDay = Number(creditCardWithTransactions.manual_cycle_day);
    } else if (cycleDateType === 'dynamic_anchor' && creditCardWithTransactions.manual_cycle_day) {
      // For dynamic anchor, use the manual_cycle_day as the anchor target
      baselineClosingDay = Number(creditCardWithTransactions.manual_cycle_day);
    }
  }
  const closingDay = baselineClosingDay;

  // Generate 13 boundaries for 12 historical cycles
  const endBoundaries: Date[] = [];
  
  if (cycleDateType === 'dynamic_anchor') {
    // Dynamic anchor logic: Based on Amex pattern analysis
    console.log(`🎯 Using dynamic anchor logic with anchor day ${closingDay}`);
    
    // Helper function to choose cycle length based on month transitions
    const chooseCycleLength = (
      prevMonthDays: number,
      currentMonth: number,
      currentYear: number,
      currentEndDay: number,
      recentLengths: number[]
    ): number => {
      // Dec -> Jan: keep 31 to avoid over-correcting around Feb
      if (currentMonth === 0) { // January (0-indexed)
        return 31;
      }
      // Jan -> Feb (short) and Feb -> Mar (give-back)
      if (currentMonth === 1) { // February
        return new Date(currentYear, 2, 0).getDate(); // Days in Feb (28 or 29)
      }
      if (currentMonth === 2) { // March
        return 31;
      }
      
      // Previous month had 30 days
      if (prevMonthDays === 30) {
        return currentEndDay === closingDay ? 31 : 30;
      }
      
      // Previous month had 31 days
      if (prevMonthDays === 31) {
        if (currentEndDay === closingDay) {
          return 32; // Will be clamped to 31 in practice
        } else {
          // Prefer 31 specifically when current end is in November
          if (currentMonth === 10) { // November (0-indexed)
            return 31;
          }
          // Stability: break long runs of 30-day cycles
          if (recentLengths.length >= 2 && 
              recentLengths[recentLengths.length - 1] === 30 && 
              recentLengths[recentLengths.length - 2] === 30) {
            return 31;
          }
          return 30;
        }
      }
      
      return 30; // Default safeguard
    };
    
    // Start with the anchor date and work backwards
    endBoundaries.push(new Date(anchorEnd)); // Most recent (month 0)
    const recentLengths: number[] = [];
    
    for (let m = 1; m <= 12; m++) {
      const currentEnd = endBoundaries[m - 1];
      const currentEndDay = currentEnd.getDate();
      const currentMonth = currentEnd.getMonth();
      const currentYear = currentEnd.getFullYear();
      
      // Calculate previous month
      let prevMonth = currentMonth - 1;
      let prevYear = currentYear;
      if (prevMonth < 0) {
        prevMonth = 11;
        prevYear--;
      }
      
      // Days in previous month
      const prevMonthDays = new Date(prevYear, prevMonth + 1, 0).getDate();
      
      // Choose cycle length based on pattern
      const T = chooseCycleLength(prevMonthDays, currentMonth, currentYear, currentEndDay, recentLengths);
      recentLengths.push(T);
      
      // Apply recurrence: d_prev = d_curr + days_in_prev_month - T
      let d_prev = currentEndDay + prevMonthDays - T;
      
      // Clamp to valid range
      d_prev = Math.max(1, Math.min(prevMonthDays, d_prev));
      
      // Create the previous end date
      const prevEnd = new Date(prevYear, prevMonth, d_prev);
      endBoundaries.push(prevEnd);
      
      // Calculate actual cycle length for logging
      const cycleStart = new Date(prevEnd);
      cycleStart.setDate(cycleStart.getDate() + 1);
      const actualCycleLength = Math.floor((currentEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      console.log(`📊 ${monthNames[prevMonth]} ${d_prev}: Creates ${actualCycleLength}-day cycle ` +
                  `(${monthNames[prevMonth]} ${d_prev + 1} - ${monthNames[currentMonth]} ${currentEndDay}) ` +
                  `[T=${T}, recurrence: ${currentEndDay} + ${prevMonthDays} - ${T} = ${d_prev}]`);
    }
    
    console.log(`🎯 Generated ${endBoundaries.length} dynamic anchor boundaries`);
  } else {
    // Existing logic for same_day and days_before_end
    for (let m = 0; m <= 12; m++) {
      const d = new Date(anchorEnd);
      d.setMonth(d.getMonth() - m);
      const year = d.getFullYear();
      const month = d.getMonth();
      
      // Calculate closing day for this specific month (for days_before_end)
      let monthClosingDay = closingDay;
      if (creditCardWithTransactions.manual_dates_configured) {
        if (cycleDateType === 'days_before_end') {
          const daysBeforeEnd = Number((creditCardWithTransactions as any).cycle_days_before_end);
          if (daysBeforeEnd >= 1 && daysBeforeEnd <= 31) {
            const lastDayOfThisMonth = new Date(year, month + 1, 0).getDate();
            monthClosingDay = Math.max(1, lastDayOfThisMonth - daysBeforeEnd);
          }
        }
      }
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const day = Math.min(monthClosingDay, daysInMonth);
      endBoundaries.push(new Date(year, month, day));
    }
  }

  // helper for due date estimation (same day-of-month as current due date)
  const estimateHistoricalDue = (cycleEnd: Date): Date | null => {
    if (!baselineDay) return null;
    
    // For dynamic anchor, calculate due date based on the adjusted closing date + typical grace period
    const dueDateType = (creditCardWithTransactions as any).due_date_type;
    if (dueDateType === 'dynamic_anchor') {
      // Typically 21 days after statement close for dynamic anchor cards
      const dueDate = new Date(cycleEnd);
      dueDate.setDate(dueDate.getDate() + 21);
      
      // If manual due day is configured, try to hit that target day (but adjust if needed)
      if (creditCardWithTransactions.manual_due_day) {
        const targetDueDay = Number(creditCardWithTransactions.manual_due_day);
        const targetMonth = dueDate.getMonth();
        const targetYear = dueDate.getFullYear();
        const daysInDueMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
        const adjustedDueDay = Math.min(targetDueDay, daysInDueMonth);
        
        // Use the target due day if it's within a reasonable range (±5 days) of calculated due
        const targetDueDate = new Date(targetYear, targetMonth, adjustedDueDay);
        const daysDiff = Math.abs((targetDueDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 5) {
          return targetDueDate;
        }
      }
      
      return dueDate;
    }
    
    // Existing logic for same_day and days_before_end
    const y = cycleEnd.getFullYear();
    const m = cycleEnd.getMonth() + 1; // next month
    const y2 = y + (m > 11 ? 1 : 0);
    const m2 = (m % 12);
    const daysInMonth2 = new Date(y2, m2 + 1, 0).getDate();
    const day2 = Math.min(baselineDay, daysInMonth2);
    return new Date(y2, m2, day2);
  };

  // Create 12 historical closed cycles using consecutive boundaries
  for (let i = 0; i < 12; i++) {
    const end = endBoundaries[i];
    const prevEnd = endBoundaries[i + 1];
    const start = new Date(prevEnd);
    start.setDate(start.getDate() + 1);
    const isAnchor = end.getTime() === anchorEnd.getTime();
    const due = isAnchor ? (nextDueDate || null) : estimateHistoricalDue(end);
    await createOrUpdateCycle(
      creditCardWithTransactions,
      cycles,
      start,
      end,
      due,
      isAnchor,
      transactionsWithDates
    );
  }

  // Add current open cycle (from last anchor end + 1 to next anchor day next month)
  const openStart = new Date(anchorEnd);
  openStart.setDate(openStart.getDate() + 1);
  const y = anchorEnd.getFullYear();
  const m = anchorEnd.getMonth() + 1; // next month
  const y2 = y + (m > 11 ? 1 : 0);
  const m2 = (m % 12);
  const targetDay = anchorEnd.getDate();
  const dim = new Date(y2, m2 + 1, 0).getDate();
  const openEnd = new Date(y2, m2, Math.min(targetDay, dim));
  await createOrUpdateCycle(
    creditCardWithTransactions,
    cycles,
    openStart,
    openEnd,
    null,
    false,
    transactionsWithDates
  );

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
  
  // For Robinhood with manual dates, use authorized date (posted date) for cycle boundaries
  // For all other institutions, continue using transaction date
  const isRobinhoodWithManualDates = creditCard.manual_dates_configured && 
    (creditCard.plaidItem?.institutionId === 'ins_54' || 
     /robinhood/i.test(creditCard.plaidItem?.institutionName || ''));
  
  const cycleTransactions = creditCard.transactions.filter((t: any) => {
    // Exclude pending transactions from all calculations
    if (t.pending === true) {
      return false;
    }
    
    if (isRobinhoodWithManualDates && t.authorizedDate) {
      // For Robinhood with manual dates: use authorized date (posted date)
      return t.authorizedDate >= cycleStart && t.authorizedDate <= effectiveEndDate;
    } else {
      // For all other institutions: use transaction date (existing behavior)
      return t.date >= cycleStart && t.date <= effectiveEndDate;
    }
  });
  
  // Count pending transactions that were excluded
  const pendingCount = creditCard.transactions.filter((t: any) => t.pending === true).length;
  
  if (isRobinhoodWithManualDates) {
    console.log(`🏦 Robinhood manual cycle: Using authorized dates for ${cycleTransactions.length} posted transactions between ${cycleStart.toDateString()} - ${effectiveEndDate.toDateString()} (${pendingCount} pending excluded)`);
  } else if (pendingCount > 0) {
    console.log(`📊 Cycle includes ${cycleTransactions.length} posted transactions (${pendingCount} pending excluded)`);
  }

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
        conditionMet: originalStatementBalance > 0,
        statementDate: lastStatementDate?.toDateString(),
        transactioncount: transactionsWithDates.filter(t => !isPaymentTransaction(t.name || '')).length
      });

      if (originalStatementBalance > 0) {
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
      transactioncount: cycleTransactions?.filter(t => !isPaymentTransaction(t.name || '')).length || 0,
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
      transactioncount: cycleTransactions?.filter(t => !isPaymentTransaction(t.name || '')).length || 0,
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
    // Get the associated plaid item (used multiple times in this loop)
    const plaidItem = plaidItemMap.get(card.plaidItemId);
    
    // Attempt statements-based periods when possible (using cached support status)
    let statementPeriods: { startDate: Date | null; endDate: Date }[] | null = null;
    try {
      const isRobinhood = plaidItem?.institutionId === 'ins_54' || /robinhood/i.test(plaidItem?.institutionName || '');
      
      // Check cached statements support to avoid API calls
      const hasStatementsSupport = plaidItem?.statements_enabled === true;
      const statementsLastChecked = plaidItem?.statements_last_checked ? new Date(plaidItem.statements_last_checked) : null;
      const isStale = !statementsLastChecked || (Date.now() - statementsLastChecked.getTime()) > (24 * 60 * 60 * 1000);
      
      if (!isRobinhood && hasStatementsSupport && plaidItem?.accessToken && card.accountId) {
        console.log(`📄 Using cached statements support for ${card.name} (enabled: ${hasStatementsSupport})`);
        
        // Dynamic import to avoid bundling server-only modules into client
        const { decrypt } = await import('@/lib/encryption');
        const { listStatementPeriods } = await import('@/services/plaidStatements');
        const accessToken = decrypt(plaidItem.accessToken);
        const periods: any[] = await listStatementPeriods(accessToken, card.accountId, 13, plaidItem?.institutionName);
        // Use only periods that have both start and end (skip newest if start is null)
        const usable = periods
          .filter(p => p.endDate && (p.startDate instanceof Date))
          .map(p => ({ startDate: p.startDate!, endDate: p.endDate }));
        if (usable.length > 0) {
          statementPeriods = usable;
        }
      } else if (!isRobinhood && isStale && plaidItem?.accessToken) {
        // If statements support hasn't been checked recently, refresh it in background
        console.log(`🔄 Refreshing statements support cache for ${card.name} (stale by ${Math.round((Date.now() - (statementsLastChecked?.getTime() || 0)) / (60 * 60 * 1000))} hours)`);
        (async () => {
          try {
            const { decrypt } = await import('@/lib/encryption');
            const { checkAndCacheStatementsSupport } = await import('@/services/plaidStatements');
            const accessToken = decrypt(plaidItem.accessToken);
            await checkAndCacheStatementsSupport(accessToken, plaidItem.id, true);
          } catch (e) {
            console.warn('Background statements support refresh failed:', e);
          }
        })();
      } else if (!hasStatementsSupport) {
        console.log(`📄 Skipping statements for ${card.name}: ${isRobinhood ? 'Robinhood' : 'statements not enabled'}`);
      }
    } catch (e) {
      console.warn('Statements-based period listing failed; falling back to heuristic cycles:', e);
    }

    // For Robinhood without manual configuration, do not generate/display cycles yet
    const isRobinhood = plaidItem?.institutionId === 'ins_54' || /robinhood/i.test(plaidItem?.institutionName || '');
    const manualConfigured = !!(card as any).manual_dates_configured;
    if (isRobinhood && !manualConfigured) {
      // Skip cycle generation; transactions will still sync in background
      continue;
    }

    const cycles = await calculateBillingCycles(card.id, {
      statementPeriods: statementPeriods || undefined,
      baselineDueDate: card.nextPaymentDueDate ? new Date(card.nextPaymentDueDate) : null,
    });
    
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

    // Check if this is a Robinhood card without proper data sources
    // Only skip cycle generation if we have NEITHER liabilities data NOR manual configuration
    let isRobinhoodCard = false;
    
    if (creditCard.plaidItemId) {
      try {
        const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
          .from('plaid_items')
          .select('institutionId, institutionName')
          .eq('id', creditCard.plaidItemId)
          .single();
        
        if (plaidItemError) {
          console.warn(`⚠️  Orphaned Plaid item reference detected for card ${creditCard.name}: ${creditCard.plaidItemId}`, plaidItemError);
          // Continue processing but treat as non-Robinhood card
        } else {
          isRobinhoodCard = plaidItem?.institutionId === 'ins_54';
        }
      } catch (error) {
        console.error('Error checking Plaid item for Robinhood detection:', error);
        // Continue processing but treat as non-Robinhood card
      }
    }
    
    if (isRobinhoodCard && !creditCard.manual_dates_configured && !creditCard.lastStatementIssueDate) {
      console.log('🔒 Skipping cycle calculation for Robinhood card - no reliable data source (needs manual config or liabilities data)');
      return null;
    }
    
    if (isRobinhoodCard) {
      console.log('✅ Robinhood card has reliable data source:', {
        hasManualConfig: !!creditCard.manual_dates_configured,
        hasLiabilitiesData: !!creditCard.lastStatementIssueDate
      });
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
    // For Robinhood with manual dates, use authorized date (posted date) for cycle boundaries
    // For all other institutions, continue using transaction date
    const isRobinhoodWithManualDates = creditCard.manual_dates_configured && 
      (creditCard.plaidItemId && 
       (await supabaseAdmin.from('plaid_items').select('institutionId, institutionName').eq('id', creditCard.plaidItemId).single())
        .data?.institutionId === 'ins_54' || 
       /robinhood/i.test((await supabaseAdmin.from('plaid_items').select('institutionId, institutionName').eq('id', creditCard.plaidItemId).single())
        .data?.institutionName || ''));
    
    const cycleTransactions = transactionsWithDates.filter(t => {
      // Exclude pending transactions from all calculations
      if (t.pending === true) {
        return false;
      }
      
      if (isRobinhoodWithManualDates && t.authorizedDate) {
        // For Robinhood with manual dates: use authorized date (posted date)
        return t.authorizedDate >= currentCycleStart && t.authorizedDate <= currentCycleEnd;
      } else {
        // For all other institutions: use transaction date (existing behavior)
        return t.date >= currentCycleStart && t.date <= currentCycleEnd;
      }
    });
    
    if (isRobinhoodWithManualDates) {
      console.log(`🏦 Robinhood current cycle: Using authorized dates for ${cycleTransactions.length} transactions between ${currentCycleStart.toDateString()} - ${currentCycleEnd.toDateString()}`);
    }

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
          transactioncount: nonPaymentTransactions.length,
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
        transactioncount: nonPaymentTransactions.length,
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
          transactioncount: nonPaymentTransactions.length,
          paymentstatus: 'current', // Current cycle is always in progress
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
        transactioncount: nonPaymentTransactions.length,
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

    // Check if this is a Robinhood card without proper data sources
    // Only skip cycle generation if we have NEITHER liabilities data NOR manual configuration
    let isRobinhoodCard = false;
    
    if (creditCard.plaidItemId) {
      try {
        const { data: plaidItem, error: plaidItemError } = await supabaseAdmin
          .from('plaid_items')
          .select('institutionId, institutionName')
          .eq('id', creditCard.plaidItemId)
          .single();
        
        if (plaidItemError) {
          console.warn(`⚠️  Orphaned Plaid item reference detected for card ${creditCard.name}: ${creditCard.plaidItemId}`, plaidItemError);
          // Continue processing but treat as non-Robinhood card
        } else {
          isRobinhoodCard = plaidItem?.institutionId === 'ins_54';
        }
      } catch (error) {
        console.error('Error checking Plaid item for Robinhood detection:', error);
        // Continue processing but treat as non-Robinhood card
      }
    }
    
    if (isRobinhoodCard && !creditCard.manual_dates_configured && !creditCard.lastStatementIssueDate) {
      console.log('🔒 Skipping recent closed cycle calculation for Robinhood card - no reliable data source (needs manual config or liabilities data)');
      return null;
    }
    
    if (isRobinhoodCard) {
      console.log('✅ Robinhood recent closed cycle has reliable data source:', {
        hasManualConfig: !!creditCard.manual_dates_configured,
        hasLiabilitiesData: !!creditCard.lastStatementIssueDate
      });
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
    // For Robinhood with manual dates, use authorized date (posted date) for cycle boundaries
    // For all other institutions, continue using transaction date
    const isRobinhoodWithManualDates = creditCard.manual_dates_configured && 
      (creditCard.plaidItemId && 
       (await supabaseAdmin.from('plaid_items').select('institutionId, institutionName').eq('id', creditCard.plaidItemId).single())
        .data?.institutionId === 'ins_54' || 
       /robinhood/i.test((await supabaseAdmin.from('plaid_items').select('institutionId, institutionName').eq('id', creditCard.plaidItemId).single())
        .data?.institutionName || ''));
    
    const cycleTransactions = transactionsWithDates.filter(t => {
      // Exclude pending transactions from all calculations
      if (t.pending === true) {
        return false;
      }
      
      if (isRobinhoodWithManualDates && t.authorizedDate) {
        // For Robinhood with manual dates: use authorized date (posted date)
        return t.authorizedDate >= closedCycleStart && t.authorizedDate <= closedCycleEnd;
      } else {
        // For all other institutions: use transaction date (existing behavior)
        return t.date >= closedCycleStart && t.date <= closedCycleEnd;
      }
    });
    
    if (isRobinhoodWithManualDates) {
      console.log(`🏦 Robinhood closed cycle: Using authorized dates for ${cycleTransactions.length} transactions between ${closedCycleStart.toDateString()} - ${closedCycleEnd.toDateString()}`);
    }

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
          transactioncount: nonPaymentTransactions.length,
          // Use the determined statement balance (either Plaid's for matching cycle or totalSpend)
          statementBalance: cycleStatementBalance,
          paymentstatus: 'due', // Closed cycles are typically due
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
        transactioncount: nonPaymentTransactions.length,
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
          transactioncount: nonPaymentTransactions.length,
          statementBalance: cycleStatementBalance, // Use the determined statement balance
          dueDate: dueDateVal,
          paymentstatus: 'due', // Closed cycles are typically due
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
        transactioncount: nonPaymentTransactions.length,
      };
    }
  } catch (error) {
    console.error('Error calculating recent closed billing cycle:', error);
    return null;
  }
}
