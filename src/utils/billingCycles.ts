import { prisma } from '@/lib/db';
import { addMonths, startOfMonth, endOfMonth, differenceInDays } from 'date-fns';

export interface BillingCycleData {
  id: string;
  creditCardId: string;
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
  const startDate = new Date(lastStatementDate);
  startDate.setMonth(startDate.getMonth() - 24);

  let currentCycleStart = new Date(startDate);
  
  while (currentCycleStart <= now) {
    const currentCycleEnd = new Date(currentCycleStart);
    currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
    
    const dueDate = new Date(currentCycleEnd);
    dueDate.setDate(dueDate.getDate() + 21);

    const cycleTransactions = creditCard.transactions.filter(t => 
      t.date >= currentCycleStart && t.date <= currentCycleEnd
    );

    const totalSpend = cycleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    let existingCycle = await prisma.billingCycle.findFirst({
      where: {
        creditCardId,
        startDate: currentCycleStart,
        endDate: currentCycleEnd,
      },
    });

    if (!existingCycle) {
      existingCycle = await prisma.billingCycle.create({
        data: {
          creditCardId,
          startDate: currentCycleStart,
          endDate: currentCycleEnd,
          dueDate,
          statementBalance: currentCycleStart.getTime() === lastStatementDate.getTime() 
            ? creditCard.lastStatementBalance 
            : null,
          minimumPayment: currentCycleStart.getTime() === lastStatementDate.getTime()
            ? creditCard.minimumPaymentAmount
            : null,
        },
      });
    }

    cycles.push({
      id: existingCycle.id,
      creditCardId: existingCycle.creditCardId,
      startDate: existingCycle.startDate,
      endDate: existingCycle.endDate,
      statementBalance: existingCycle.statementBalance || undefined,
      minimumPayment: existingCycle.minimumPayment || undefined,
      dueDate: existingCycle.dueDate || undefined,
      totalSpend,
      transactionCount: cycleTransactions.length,
    });

    currentCycleStart = new Date(currentCycleEnd);
    currentCycleStart.setDate(currentCycleStart.getDate() + 1);
  }

  return cycles.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
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