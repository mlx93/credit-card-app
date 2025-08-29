import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('🔍 CHECKING BOA JUNE DATA DIRECTLY');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the BoA card
    const boaCard = await prisma.creditCard.findFirst({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        name: {
          contains: 'Customized'
        }
      }
    });

    if (!boaCard) {
      return NextResponse.json({ error: 'BoA card not found' }, { status: 404 });
    }

    // Get June 2025 transactions specifically
    const june2025Start = new Date('2025-06-01');
    const june2025End = new Date('2025-06-30T23:59:59');
    
    const juneTransactions = await prisma.transaction.findMany({
      where: {
        creditCardId: boaCard.id,
        date: {
          gte: june2025Start,
          lte: june2025End
        }
      },
      orderBy: { date: 'asc' }
    });

    // Get the June billing cycle
    const juneCycle = await prisma.billingCycle.findFirst({
      where: {
        creditCardId: boaCard.id,
        startDate: {
          gte: new Date('2025-06-01'),
          lte: new Date('2025-06-30')
        }
      }
    });

    // Get ALL billing cycles for BoA card
    const allBoaCycles = await prisma.billingCycle.findMany({
      where: {
        creditCardId: boaCard.id
      },
      orderBy: { startDate: 'desc' }
    });

    // Calculate June spending manually
    const juneSpend = juneTransactions.reduce((sum, t) => {
      // Skip payments (negative amounts with payment keywords)
      const isPayment = t.name.toLowerCase().includes('pymt') || 
                       t.name.toLowerCase().includes('payment');
      if (isPayment) return sum;
      return sum + t.amount;
    }, 0);

    return NextResponse.json({
      message: 'BoA June data check completed',
      boaCard: {
        id: boaCard.id,
        name: boaCard.name,
        openDate: boaCard.openDate,
        accountId: boaCard.accountId
      },
      juneData: {
        transactionCount: juneTransactions.length,
        totalSpend: juneSpend,
        dateRange: `${june2025Start.toISOString().split('T')[0]} to ${june2025End.toISOString().split('T')[0]}`,
        transactions: juneTransactions.map(t => ({
          id: t.id,
          date: t.date.toISOString().split('T')[0],
          amount: t.amount,
          name: t.name,
          category: t.category
        }))
      },
      juneCycle: juneCycle ? {
        id: juneCycle.id,
        startDate: juneCycle.startDate.toISOString().split('T')[0],
        endDate: juneCycle.endDate.toISOString().split('T')[0],
        totalSpend: juneCycle.totalSpend,
        statementBalance: juneCycle.statementBalance,
        dueDate: juneCycle.dueDate?.toISOString().split('T')[0]
      } : null,
      allCycles: allBoaCycles.map(cycle => ({
        id: cycle.id,
        period: `${cycle.startDate.toISOString().split('T')[0]} to ${cycle.endDate.toISOString().split('T')[0]}`,
        totalSpend: cycle.totalSpend,
        statementBalance: cycle.statementBalance,
        hasStatement: cycle.statementBalance !== null
      })),
      summary: {
        cardOpenedInJune: boaCard.openDate ? new Date(boaCard.openDate).getMonth() === 5 : false,
        hasJuneTransactions: juneTransactions.length > 0,
        hasJuneCycle: !!juneCycle,
        totalCycles: allBoaCycles.length,
        cyclesWithStatements: allBoaCycles.filter(c => c.statementBalance !== null).length
      }
    });

  } catch (error) {
    console.error('🔍 BOA JUNE CHECK ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to check BoA June data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}