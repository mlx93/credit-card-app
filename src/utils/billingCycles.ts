import { prisma } from '@/lib/db';
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
  const creditCard = await prisma.creditCard.findUnique({
    where: { id: creditCardId },
    include: {
      transactions: {
        orderBy: { date: 'asc' },
      },
    },
  });

  if (!creditCard) {
    throw new Error('Credit card not found');
  }

  // Debug transaction association
  console.log(`=== BILLING CYCLE TRANSACTION DEBUG for ${creditCard.name} ===`);
  console.log(`Credit card ID: ${creditCard.id}`);
  console.log(`Credit card accountId: ${creditCard.accountId}`);
  console.log(`Transactions linked to this credit card: ${creditCard.transactions?.length || 0}`);
  
  // Check for transactions in database that might not be linked
  const allTransactionsForItem = await prisma.transaction.findMany({
    where: { plaidItemId: creditCard.plaidItemId },
    select: {
      id: true,
      transactionId: true,
      creditCardId: true,
      name: true,
      amount: true,
      date: true
    },
    orderBy: { date: 'desc' },
    take: 5
  });
  
  console.log(`Total transactions for this Plaid item: ${allTransactionsForItem.length}`);
  console.log('Sample transactions for this item:', allTransactionsForItem.map(t => ({
    id: t.id,
    transactionId: t.transactionId,
    creditCardId: t.creditCardId,
    linkedToThisCard: t.creditCardId === creditCard.id,
    name: t.name,
    amount: t.amount,
    date: t.date
  })));
  
  console.log(`=== END BILLING CYCLE TRANSACTION DEBUG ===`);

  const cycles: BillingCycleData[] = [];
  
  const lastStatementDate = creditCard.lastStatementIssueDate;
  const nextDueDate = creditCard.nextPaymentDueDate;
  
  if (!lastStatementDate) {
    return generateEstimatedCycles(creditCard, cycles);
  }

  const cycleLength = estimateCycleLength(creditCard, lastStatementDate, nextDueDate);
  
  const now = new Date();
  
  // Calculate the closed cycle that ends on the statement date (contains the statement balance)
  const closedCycleEnd = new Date(lastStatementDate);
  const closedCycleStart = new Date(closedCycleEnd);
  closedCycleStart.setDate(closedCycleStart.getDate() - cycleLength + 1);
  
  console.log('=== BILLING CYCLE CREATION DEBUG for', creditCard.name, '===');
  console.log('Card open date:', creditCard.openDate ? new Date(creditCard.openDate).toDateString() : 'Not set');
  console.log('Last statement date:', lastStatementDate);
  console.log('Next due date:', nextDueDate);
  console.log('Cycle length:', cycleLength);
  console.log('Today:', now.toDateString());
  console.log('Total transactions for card:', creditCard.transactions?.length || 0);
  console.log('Sample transactions:', creditCard.transactions?.slice(0, 3).map(t => ({
    date: t.date,
    amount: t.amount,
    name: t.name
  })));
  
  // Create the closed cycle with statement balance
  console.log('🏦 Creating CLOSED cycle for', creditCard.name, ':', closedCycleStart.toDateString(), 'to', closedCycleEnd.toDateString(), '- hasStatementBalance: TRUE');
  await createOrUpdateCycle(creditCard, cycles, closedCycleStart, closedCycleEnd, nextDueDate, true);
  
  // Calculate the current ongoing cycle that starts after the statement date
  const currentCycleStart = new Date(lastStatementDate);
  currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  const currentCycleEnd = new Date(currentCycleStart);
  currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
  const currentDueDate = new Date(currentCycleEnd);
  currentDueDate.setDate(currentDueDate.getDate() + 21);
  
  // Create the current cycle (no statement balance yet)
  console.log('🏦 Creating CURRENT cycle for', creditCard.name, ':', currentCycleStart.toDateString(), 'to', currentCycleEnd.toDateString(), '- hasStatementBalance: FALSE');
  await createOrUpdateCycle(creditCard, cycles, currentCycleStart, currentCycleEnd, currentDueDate, false);
  
  console.log('Total cycles created:', cycles.length);
  console.log('=== END BILLING CYCLE DEBUG ===');
  
  // Create historical cycles going back 12 months, but not before card open date
  let historicalCycleEnd = new Date(closedCycleStart);
  historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
  
  const oneYearAgo = new Date();
  oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
  
  // Don't create cycles before card open date
  const cardOpenDate = creditCard.openDate ? new Date(creditCard.openDate) : oneYearAgo;
  const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;
  
  console.log('Historical cycle date limits:', {
    oneYearAgo: oneYearAgo.toDateString(),
    cardOpenDate: cardOpenDate.toDateString(),
    earliestCycleDate: earliestCycleDate.toDateString()
  });
  
  while (historicalCycleEnd >= earliestCycleDate) {
    const historicalCycleStart = new Date(historicalCycleEnd);
    historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);
    
    // Skip cycles only if they end before the card open date (no meaningful overlap)
    if (creditCard.openDate && historicalCycleEnd < new Date(creditCard.openDate)) {
      console.log('Skipping cycle that ends before card open date:', {
        cycleStart: historicalCycleStart.toDateString(),
        cycleEnd: historicalCycleEnd.toDateString(),
        cardOpenDate: new Date(creditCard.openDate).toDateString()
      });
      // Move to the next historical cycle instead of breaking
      historicalCycleEnd = new Date(historicalCycleStart);
      historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
      continue;
    }
    
    // If cycle starts before open date but ends after, it's valid (partial cycle)
    if (creditCard.openDate && historicalCycleStart < new Date(creditCard.openDate)) {
      console.log('Creating partial cycle that overlaps with card opening:', {
        cycleStart: historicalCycleStart.toDateString(),
        cycleEnd: historicalCycleEnd.toDateString(),
        cardOpenDate: new Date(creditCard.openDate).toDateString(),
        note: 'Cycle starts before open but contains post-opening period'
      });
    }
    
    // This check is now handled above - removed duplicate logic
    
    const historicalDueDate = new Date(historicalCycleEnd);
    historicalDueDate.setDate(historicalDueDate.getDate() + 21);
    
    // Historical cycles that have ended should be treated as having statement balances
    // With PRODUCT_STATEMENTS consent, we can get actual historical statement data
    const isCompletedCycle = historicalCycleEnd < now;
    console.log('🏦 Creating HISTORICAL cycle for', creditCard.name, ':', {
      cycleStart: historicalCycleStart.toDateString(),
      cycleEnd: historicalCycleEnd.toDateString(), 
      isCompleted: isCompletedCycle,
      hasStatementBalance: isCompletedCycle ? 'TRUE' : 'FALSE'
    });
    await createOrUpdateCycle(creditCard, cycles, historicalCycleStart, historicalCycleEnd, historicalDueDate, isCompletedCycle);
    
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
      console.log(`Excluding payment from spend calculation: ${t.name} (${t.amount})`);
      return sum;
    }
    
    // Include all non-payment transactions:
    // - Positive amounts = charges/purchases
    // - Negative amounts = refunds/returns (should be included to reduce spend)
    return sum + t.amount;
  }, 0);
  
  // Debug transaction details
  console.log(`=== TRANSACTION DEBUG for ${creditCard.name} cycle ${cycleStart.toDateString()} to ${effectiveEndDate.toDateString()} ===`);
  console.log(`Total transactions available for card: ${creditCard.transactions?.length || 0}`);
  console.log(`Transactions in this cycle: ${cycleTransactions.length}`);
  console.log(`Transaction-based total spend: $${totalSpend.toFixed(2)}`);
  console.log('Sample transactions in cycle:', cycleTransactions.slice(0, 5).map(t => ({
    date: t.date,
    amount: t.amount,
    name: t.name,
    merchant: t.merchantName
  })));
  console.log('=== END TRANSACTION DEBUG ===');

  // For current cycles, use balance-based calculation to exclude pending transactions
  if (cycleEnd > today && !hasStatementBalance) {
    // Current cycle: committed charges = current balance - statement balance
    const currentBalance = Math.abs(creditCard.balanceCurrent || 0);
    const statementBalance = Math.abs(creditCard.lastStatementBalance || 0);
    const committedSpend = Math.max(0, currentBalance - statementBalance);
    
    // Count only authorized (non-pending) transactions for comparison
    const authorizedTransactions = cycleTransactions.filter((t: any) => t.authorizedDate);
    const authorizedSpend = authorizedTransactions.reduce((sum: number, t: any) => {
      // Exclude payment transactions, include charges and refunds
      if (isPaymentTransaction(t.name)) {
        return sum; // Skip payments
      }
      return sum + t.amount; // Include charges (positive) and refunds (negative)
    }, 0);
    
    console.log('Current cycle spend calculation for', creditCard.name, {
      currentBalance,
      statementBalance,
      committedSpend: `${currentBalance} - ${statementBalance} = ${committedSpend}`,
      allTransactions: cycleTransactions.length,
      authorizedTransactions: authorizedTransactions.length,
      pendingTransactions: cycleTransactions.length - authorizedTransactions.length,
      transactionBasedTotal: totalSpend,
      authorizedTransactionTotal: authorizedSpend,
      usingCommittedAmount: committedSpend
    });
    
    // Use balance-based calculation for current cycles (excludes pending transactions)
    totalSpend = committedSpend;
    console.log(`✅ Current cycle using committed balance: $${totalSpend.toFixed(2)} (excludes pending transactions)`);
  }
  
  // For closed cycles, only use the actual statement balance for the EXACT statement cycle
  // For all other historical cycles, use transaction-based totals
  const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
  const isExactStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
  
  if (hasStatementBalance && creditCard.lastStatementBalance && isExactStatementCycle) {
    // Only for the exact statement cycle, use the actual statement balance
    const statementAmount = Math.abs(creditCard.lastStatementBalance);
    
    console.log('Statement cycle validation for', creditCard.name, {
      cycleEnd: cycleEnd.toDateString(),
      statementDate: lastStatementDate?.toDateString(),
      transactionSpend: totalSpend,
      statementBalance: statementAmount,
      transactionCount: cycleTransactions.length
    });
    
    // For the statement cycle, prefer the actual statement balance
    totalSpend = statementAmount;
  } else if (hasStatementBalance) {
    // For all other historical cycles, keep the transaction-based total
    console.log('Historical cycle using transaction total for', creditCard.name, {
      cycleEnd: cycleEnd.toDateString(),
      transactionBasedTotal: totalSpend,
      transactionCount: cycleTransactions.length
    });
  }

  // Debug logging for current cycles
  if (cycleEnd > today) {
    console.log('Current cycle calculation for', creditCard.name, {
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      effectiveEndDate: effectiveEndDate.toISOString(),
      transactionCount: cycleTransactions.length,
      finalTotalSpend: totalSpend,
      hasStatementBalance
    });
  }

  let existingCycle = await prisma.billingCycle.findFirst({
    where: {
      creditCardId: creditCard.id,
      startDate: cycleStart,
      endDate: cycleEnd,
    },
  });

  // Determine statement balance for this cycle (for both new and existing cycles)
  let statementBalance = null;
  let minimumPayment = null;
  
  if (hasStatementBalance) {
    const lastStatementDate = creditCard.lastStatementIssueDate ? new Date(creditCard.lastStatementIssueDate) : null;
    
    // Check if this cycle ends exactly on the last statement date (most recent closed cycle)
    const isStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
    
    console.log('🏦 STATEMENT BALANCE DEBUG for', creditCard.name, ':', {
      cycleEnd: cycleEnd.toDateString(),
      cycleEndTime: cycleEnd.getTime(),
      lastStatementDate: lastStatementDate?.toDateString(),
      lastStatementTime: lastStatementDate?.getTime(),
      isStatementCycle,
      totalSpend,
      creditCardLastStatementBalance: creditCard.lastStatementBalance,
      hasStatementBalance,
      willAssignStatementBalance: true
    });
    
    if (isStatementCycle) {
      // This is the exact cycle that corresponds to the last statement - use actual statement balance
      statementBalance = creditCard.lastStatementBalance;
      minimumPayment = creditCard.minimumPaymentAmount;
      console.log('✅ Using actual statement balance for statement cycle:', {
        cycleEnd: cycleEnd.toDateString(),
        statementDate: lastStatementDate.toDateString(),
        statementBalance,
        transactionTotal: totalSpend
      });
    } else {
      // This is a historical completed cycle - ALWAYS use calculated spend from transactions
      // Don't use the last statement balance for historical cycles
      statementBalance = totalSpend > 0 ? totalSpend : 0; // Use 0 instead of null for empty cycles
      minimumPayment = totalSpend > 0 ? Math.max(25, totalSpend * 0.02) : 0; // Estimate 2% minimum payment
      console.log('📊 Using transaction-based total for historical cycle:', {
        cycleEnd: cycleEnd.toDateString(),
        totalSpend,
        statementBalance,
        transactionsFound: cycleTransactions?.length || 0,
        sampleTransactions: cycleTransactions?.slice(0, 3).map(t => ({
          date: t.date,
          amount: t.amount,
          name: t.name
        }))
      });
    }
  } else {
    console.log('❌ NO STATEMENT BALANCE assigned for', creditCard.name, 'cycle', cycleEnd.toDateString(), '- hasStatementBalance:', hasStatementBalance);
  }

  console.log('💰 FINAL STATEMENT BALANCE for', creditCard.name, 'cycle ending', cycleEnd.toDateString(), ':', {
    finalStatementBalance: statementBalance,
    hasStatementBalance,
    totalSpend,
    cycleType: hasStatementBalance ? 'statement cycle' : 'non-statement cycle'
  });

  if (!existingCycle) {
    existingCycle = await prisma.billingCycle.create({
      data: {
        creditCardId: creditCard.id,
        startDate: cycleStart,
        endDate: cycleEnd,
        dueDate: dueDate,
        statementBalance: statementBalance,
        minimumPayment: minimumPayment,
        totalSpend: totalSpend,
      },
    });
  } else {
    // Always update existing cycles to ensure transaction-based totals are current
    // This is important when we have new transaction data
    const needsUpdate = true; // Always update to reflect current transaction totals
    
    if (needsUpdate) {
      console.log('Updating existing cycle with current data:', {
        cycleId: existingCycle.id,
        cycleEnd: cycleEnd.toDateString(),
        oldStatementBalance: existingCycle.statementBalance,
        newStatementBalance: statementBalance,
        totalSpend: totalSpend,
        transactionCount: cycleTransactions?.length || 0
      });
      
      existingCycle = await prisma.billingCycle.update({
        where: { id: existingCycle.id },
        data: {
          statementBalance: statementBalance,
          minimumPayment: minimumPayment,
          totalSpend: totalSpend,
        },
      });
    }
  }

  cycles.push({
    id: existingCycle.id,
    creditCardId: existingCycle.creditCardId,
    creditCardName: creditCard.name,
    creditCardMask: creditCard.mask,
    startDate: existingCycle.startDate,
    endDate: existingCycle.endDate,
    statementBalance: existingCycle.statementBalance || undefined,
    minimumPayment: existingCycle.minimumPayment || undefined,
    dueDate: existingCycle.dueDate || undefined,
    totalSpend,
    transactionCount: cycleTransactions.length,
  });
}

function estimateCycleLength(
  creditCard: any, 
  lastStatementDate: Date, 
  nextDueDate: Date | null
): number {
  // Most credit cards have monthly billing cycles of 28-31 days
  // The due date is typically 21-25 days AFTER the statement date
  // So we can't use the due date to calculate cycle length
  
  // Default to 30 days for most cards
  // Could be enhanced to look at historical statement dates if available
  return 30;
}

function generateEstimatedCycles(creditCard: any, cycles: BillingCycleData[]): BillingCycleData[] {
  const now = new Date();
  const startDate = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 24, 1));
  
  let currentMonth = new Date(startDate);
  
  while (currentMonth <= now) {
    const cycleStart = startOfMonth(currentMonth);
    const cycleEnd = endOfMonth(currentMonth);
    const dueDate = new Date(cycleEnd);
    dueDate.setDate(dueDate.getDate() + 25);

    const cycleTransactions = creditCard.transactions?.filter((t: any) => 
      t.date >= cycleStart && t.date <= cycleEnd
    ) || [];

    const totalSpend = cycleTransactions.reduce((sum: number, t: any) => {
      // Exclude payment transactions, include charges and refunds
      if (isPaymentTransaction(t.name)) {
        return sum; // Skip payments
      }
      return sum + t.amount; // Include charges (positive) and refunds (negative)
    }, 0);

    cycles.push({
      id: `estimated-${creditCard.id}-${currentMonth.getTime()}`,
      creditCardId: creditCard.id,
      creditCardName: creditCard.name,
      creditCardMask: creditCard.mask,
      startDate: cycleStart,
      endDate: cycleEnd,
      dueDate,
      totalSpend,
      transactionCount: cycleTransactions.length,
    });

    currentMonth = addMonths(currentMonth, 1);
  }

  return cycles;
}

export async function getAllUserBillingCycles(userId: string): Promise<BillingCycleData[]> {
  const plaidItems = await prisma.plaidItem.findMany({
    where: { userId },
    include: {
      accounts: true,
    },
  });

  const allCycles: BillingCycleData[] = [];
  
  for (const item of plaidItems) {
    for (const card of item.accounts) {
      const cycles = await calculateBillingCycles(card.id);
      
      // Filter out cycles that start OR end before the card open date
      let filteredCycles = cycles;
      if (card.openDate) {
        const cardOpenDate = new Date(card.openDate);
        console.log(`🗓️ FILTERING CYCLES FOR ${card.name}:`);
        console.log(`   Card open date: ${cardOpenDate.toDateString()} (${cardOpenDate.toISOString()})`);
        console.log(`   Total cycles before filtering: ${cycles.length}`);
        
        const beforeFiltering = cycles.map(cycle => ({
          start: new Date(cycle.startDate).toDateString(),
          startISO: cycle.startDate.toISOString(),
          end: new Date(cycle.endDate).toDateString(),
          endISO: cycle.endDate.toISOString(),
          valid: new Date(cycle.endDate) >= cardOpenDate
        }));
        
        console.log(`   Cycle validation details:`, beforeFiltering);
        
        filteredCycles = cycles.filter(cycle => {
          const cycleStart = new Date(cycle.startDate);
          const cycleEnd = new Date(cycle.endDate);
          // A cycle is valid if it ends after the card open date (overlaps with card opening)
          // This allows partial cycles where the start is before open date but end is after
          const isValid = cycleEnd >= cardOpenDate;
          
          if (!isValid) {
            console.log(`   ❌ FILTERING OUT: ${cycleStart.toDateString()} to ${cycleEnd.toDateString()} (cycle ends before card opened: ${cycleEnd < cardOpenDate})`);
          } else {
            console.log(`   ✅ KEEPING: ${cycleStart.toDateString()} to ${cycleEnd.toDateString()} (cycle overlaps with card opening)`);
          }
          
          return isValid;
        });
        
        console.log(`🗓️ Card ${card.name}: Filtered billing cycles from ${cycles.length} to ${filteredCycles.length} based on open date (${cardOpenDate.toDateString()})`);
        
        if (filteredCycles.length !== cycles.length) {
          const removedCycles = cycles.filter(cycle => {
            const cycleStart = new Date(cycle.startDate);
            const cycleEnd = new Date(cycle.endDate);
            return cycleStart < cardOpenDate || cycleEnd < cardOpenDate;
          });
          console.log(`   Removed ${removedCycles.length} cycles:`, removedCycles.map(cycle => ({
            start: new Date(cycle.startDate).toDateString(),
            end: new Date(cycle.endDate).toDateString(),
            reason: (() => {
              const start = new Date(cycle.startDate);
              const end = new Date(cycle.endDate);
              if (start < cardOpenDate && end < cardOpenDate) return 'both dates before open';
              if (start < cardOpenDate) return 'start date before open';
              if (end < cardOpenDate) return 'end date before open';
              return 'unknown';
            })()
          })));
        } else {
          console.log(`   No cycles needed to be filtered out`);
        }
      } else {
        console.log(`🗓️ Card ${card.name}: No open date set, not filtering cycles`);
      }
      
      // Apply Capital One-specific cycle limiting
      const isCapitalOne = isCapitalOneCard(item.institutionName, card.name);
      
      if (isCapitalOne) {
        // For Capital One cards, limit to 4 most recent cycles (90 days = ~3-4 billing cycles)
        const limitedCycles = filteredCycles
          .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
          .slice(0, 4);
        
        console.log(`📍 Capital One card ${card.name}: Limited billing cycles from ${filteredCycles.length} to ${limitedCycles.length} (90-day transaction limit)`);
        
        allCycles.push(...limitedCycles);
      } else {
        // Standard cards: show all cycles (typically 12+ for 2 years of data)
        allCycles.push(...filteredCycles);
      }
    }
  }

  return allCycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

export function calculateInterestCost(balance: number, aprPercentage: number, daysLate: number = 30): number {
  const dailyRate = aprPercentage / 100 / 365;
  return balance * dailyRate * daysLate;
}