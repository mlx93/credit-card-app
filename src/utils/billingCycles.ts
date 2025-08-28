import { prisma } from '@/lib/db';
import { addMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';

export interface BillingCycleData {
  id: string;
  creditCardId: string;
  creditCardName: string;
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
  
  // Create the closed cycle with statement balance
  await createOrUpdateCycle(creditCard, cycles, closedCycleStart, closedCycleEnd, nextDueDate, true);
  
  // Calculate the current ongoing cycle that starts after the statement date
  const currentCycleStart = new Date(lastStatementDate);
  currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  const currentCycleEnd = new Date(currentCycleStart);
  currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
  const currentDueDate = new Date(currentCycleEnd);
  currentDueDate.setDate(currentDueDate.getDate() + 21);
  
  // Create the current cycle (no statement balance yet)
  await createOrUpdateCycle(creditCard, cycles, currentCycleStart, currentCycleEnd, currentDueDate, false);
  
  // Create historical cycles going back 24 months
  let historicalCycleEnd = new Date(closedCycleStart);
  historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
  
  const twoYearsAgo = new Date();
  twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
  
  while (historicalCycleEnd >= twoYearsAgo) {
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
  const cycleTransactions = creditCard.transactions.filter((t: any) => 
    t.date >= cycleStart && t.date <= cycleEnd
  );

  const totalSpend = cycleTransactions.reduce((sum: number, t: any) => sum + Math.abs(t.amount), 0);

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