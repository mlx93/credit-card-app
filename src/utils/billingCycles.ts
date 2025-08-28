import { prisma } from '@/lib/db';
import { addMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';

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
  console.log('Last statement date:', lastStatementDate);
  console.log('Next due date:', nextDueDate);
  console.log('Cycle length:', cycleLength);
  console.log('Total transactions for card:', creditCard.transactions?.length || 0);
  console.log('Sample transactions:', creditCard.transactions?.slice(0, 3).map(t => ({
    date: t.date,
    amount: t.amount,
    name: t.name
  })));
  
  // Create the closed cycle with statement balance
  console.log('Creating closed cycle:', closedCycleStart, 'to', closedCycleEnd);
  await createOrUpdateCycle(creditCard, cycles, closedCycleStart, closedCycleEnd, nextDueDate, true);
  
  // Calculate the current ongoing cycle that starts after the statement date
  const currentCycleStart = new Date(lastStatementDate);
  currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  const currentCycleEnd = new Date(currentCycleStart);
  currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
  const currentDueDate = new Date(currentCycleEnd);
  currentDueDate.setDate(currentDueDate.getDate() + 21);
  
  // Create the current cycle (no statement balance yet)
  console.log('Creating current cycle:', currentCycleStart, 'to', currentCycleEnd);
  await createOrUpdateCycle(creditCard, cycles, currentCycleStart, currentCycleEnd, currentDueDate, false);
  
  console.log('Total cycles created:', cycles.length);
  console.log('=== END BILLING CYCLE DEBUG ===');
  
  // Create historical cycles going back 12 months
  let historicalCycleEnd = new Date(closedCycleStart);
  historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
  
  const oneYearAgo = new Date();
  oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
  
  while (historicalCycleEnd >= oneYearAgo) {
    const historicalCycleStart = new Date(historicalCycleEnd);
    historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);
    
    const historicalDueDate = new Date(historicalCycleEnd);
    historicalDueDate.setDate(historicalDueDate.getDate() + 21);
    
    await createOrUpdateCycle(creditCard, cycles, historicalCycleStart, historicalCycleEnd, historicalDueDate, false);
    
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

  let totalSpend = cycleTransactions.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);
  
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

  // For current cycles, compare transaction-based vs balance-based calculation
  if (cycleEnd > today && !hasStatementBalance) {
    // Current cycle: new charges since statement = current balance - statement balance
    const currentBalance = Math.abs(creditCard.balanceCurrent || 0);
    const statementBalance = Math.abs(creditCard.lastStatementBalance || 0);
    const calculatedSpend = Math.max(0, currentBalance - statementBalance);
    
    console.log('Current cycle spend comparison for', creditCard.name, {
      currentBalance,
      statementBalance,
      transactionBasedSpend: totalSpend,
      calculatedSpend,
      difference: Math.abs(totalSpend - calculatedSpend),
      usingTransactions: cycleTransactions.length > 0
    });
    
    // Prefer transaction-based calculation if we have transactions, otherwise use balance calculation
    if (cycleTransactions.length === 0 && calculatedSpend > 0) {
      console.log('No transactions found for current cycle, using balance calculation');
      totalSpend = calculatedSpend;
    } else if (cycleTransactions.length > 0) {
      console.log(`Using transaction-based spend: $${totalSpend.toFixed(2)} from ${cycleTransactions.length} transactions`);
      // Keep transaction-based total
    }
  }
  
  // For closed cycles, prefer transaction-based spend but validate against statement balance
  if (hasStatementBalance && creditCard.lastStatementBalance) {
    const statementAmount = Math.abs(creditCard.lastStatementBalance);
    const difference = Math.abs(totalSpend - statementAmount);
    
    console.log('Closed cycle spend validation for', creditCard.name, {
      transactionSpend: totalSpend,
      statementBalance: statementAmount,
      difference,
      transactionCount: cycleTransactions.length
    });
    
    // If we have transactions, use transaction total. If no transactions or big discrepancy, use statement balance
    if (cycleTransactions.length === 0 || difference > statementAmount * 0.1) { // 10% tolerance
      console.log('Using statement balance due to', cycleTransactions.length === 0 ? 'no transactions' : 'large discrepancy');
      totalSpend = statementAmount;
    }
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

  if (!existingCycle) {
    existingCycle = await prisma.billingCycle.create({
      data: {
        creditCardId: creditCard.id,
        startDate: cycleStart,
        endDate: cycleEnd,
        dueDate: dueDate,
        statementBalance: hasStatementBalance ? creditCard.lastStatementBalance : null,
        minimumPayment: hasStatementBalance ? creditCard.minimumPaymentAmount : null,
      },
    });
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
  if (nextDueDate) {
    const daysBetween = differenceInDays(nextDueDate, lastStatementDate);
    if (daysBetween > 25 && daysBetween < 35) {
      return daysBetween - 21;
    }
  }
  
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

    const totalSpend = cycleTransactions.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);

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
      allCycles.push(...cycles);
    }
  }

  return allCycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

export function calculateInterestCost(balance: number, aprPercentage: number, daysLate: number = 30): number {
  const dailyRate = aprPercentage / 100 / 365;
  return balance * dailyRate * daysLate;
}