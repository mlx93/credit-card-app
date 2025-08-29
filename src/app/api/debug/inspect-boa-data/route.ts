import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('🔍 INSPECTING BOA DATABASE DATA');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the BoA Customized Cash Rewards card
    const boaCard = await prisma.creditCard.findFirst({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        name: {
          contains: 'Customized'
        }
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true,
            status: true,
            lastSyncAt: true
          }
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'BoA Customized card not found' }, { status: 404 });
    }

    // Get ALL transactions for this card
    const allTransactions = await prisma.transaction.findMany({
      where: {
        creditCardId: boaCard.id
      },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        transactionId: true,
        date: true,
        amount: true,
        name: true,
        category: true,
        merchantName: true
      }
    });

    // Get ALL billing cycles for this card
    const allBillingCycles = await prisma.billingCycle.findMany({
      where: {
        creditCardId: boaCard.id
      },
      orderBy: { startDate: 'desc' }
    });

    // Group transactions by month for easier analysis
    const transactionsByMonth = allTransactions.reduce((acc: any, t) => {
      const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
      if (!acc[monthKey]) acc[monthKey] = [];
      acc[monthKey].push(t);
      return acc;
    }, {});

    // Find June 2025 transactions specifically
    const june2025Transactions = transactionsByMonth['2025-06'] || [];

    // Analyze billing cycles
    const cycleAnalysis = allBillingCycles.map(cycle => ({
      id: cycle.id,
      period: `${cycle.startDate.toISOString().split('T')[0]} to ${cycle.endDate.toISOString().split('T')[0]}`,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      totalSpend: cycle.totalSpend,
      statementBalance: cycle.statementBalance,
      isHistorical: cycle.statementBalance !== null,
      isCurrent: cycle.statementBalance === null
    }));

    return NextResponse.json({
      message: 'BoA card database inspection completed',
      cardInfo: {
        id: boaCard.id,
        name: boaCard.name,
        accountId: boaCard.accountId,
        openDate: boaCard.openDate,
        lastStatementIssueDate: boaCard.lastStatementIssueDate,
        lastStatementBalance: boaCard.lastStatementBalance,
        nextPaymentDueDate: boaCard.nextPaymentDueDate,
        plaidStatus: boaCard.plaidItem?.status,
        lastSync: boaCard.plaidItem?.lastSyncAt
      },
      transactionSummary: {
        totalTransactions: allTransactions.length,
        transactionsByMonth: Object.keys(transactionsByMonth).sort().map(month => ({
          month,
          count: transactionsByMonth[month].length,
          totalAmount: transactionsByMonth[month].reduce((sum: number, t: any) => sum + t.amount, 0)
        })),
        june2025Count: june2025Transactions.length,
        june2025TotalSpend: june2025Transactions.reduce((sum: number, t: any) => sum + t.amount, 0)
      },
      billingCycleSummary: {
        totalCycles: allBillingCycles.length,
        historicalCycles: cycleAnalysis.filter(c => c.isHistorical).length,
        currentCycles: cycleAnalysis.filter(c => c.isCurrent).length,
        cycleDetails: cycleAnalysis
      },
      rawData: {
        june2025Transactions: june2025Transactions.slice(0, 10), // First 10 June transactions
        allBillingCycles: cycleAnalysis,
        sampleTransactions: allTransactions.slice(0, 10) // First 10 recent transactions
      }
    });

  } catch (error) {
    console.error('🔍 BOA DATA INSPECTION ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to inspect BoA data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}