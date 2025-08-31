import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    console.log('🔍 VERIFY REFRESH PIPELINE ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Check Plaid Items status
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        itemId: true,
        institutionName: true,
        status: true,
        lastSyncAt: true,
        errorCode: true,
        _count: {
          select: {
            accounts: true,
            transactions: true
          }
        }
      }
    });

    // 2. Check Credit Cards with transaction counts
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      select: {
        id: true,
        name: true,
        accountId: true,
        openDate: true,
        lastStatementIssueDate: true,
        _count: {
          select: {
            transactions: true,
            billingCycles: true
          }
        }
      }
    });

    // 3. Check unlinked transactions
    const unlinkedTransactions = await prisma.transaction.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        },
        creditCardId: null
      },
      select: {
        id: true,
        transactionId: true,
        date: true,
        amount: true,
        name: true,
        plaidItemId: true
      }
    });

    // 4. Check billing cycles with transaction counts
    const billingCycles = await prisma.billingCycle.findMany({
      where: {
        creditCard: {
          plaidItem: {
            userId: session.user.id
          }
        }
      },
      orderBy: { startDate: 'desc' },
      include: {
        creditCard: {
          select: {
            name: true
          }
        }
      }
    });

    // 5. Check recent transactions
    const recentTransactions = await prisma.transaction.findMany({
      where: {
        plaidItem: {
          userId: session.user.id
        }
      },
      orderBy: { date: 'desc' },
      take: 5,
      select: {
        id: true,
        date: true,
        amount: true,
        name: true,
        creditCardId: true,
        creditCard: {
          select: {
            name: true
          }
        }
      }
    });

    // Analysis
    const analysis = {
      dataIntegrity: {
        totalPlaidItems: plaidItems.length,
        activeItems: plaidItems.filter(i => i.status === 'active').length,
        errorItems: plaidItems.filter(i => i.status === 'error' || i.status === 'expired').length,
        totalCreditCards: creditCards.length,
        cardsWithTransactions: creditCards.filter(c => c._count.transactions > 0).length,
        cardsWithoutTransactions: creditCards.filter(c => c._count.transactions === 0).length,
        totalUnlinkedTransactions: unlinkedTransactions.length
      },
      potentialIssues: []
    };

    // Identify issues
    if (unlinkedTransactions.length > 0) {
      analysis.potentialIssues.push({
        type: 'UNLINKED_TRANSACTIONS',
        severity: 'HIGH',
        count: unlinkedTransactions.length,
        message: `${unlinkedTransactions.length} transactions not linked to any credit card`,
        impact: 'Billing cycles will show $0.00 spend'
      });
    }

    if (analysis.dataIntegrity.cardsWithoutTransactions > 0) {
      analysis.potentialIssues.push({
        type: 'CARDS_WITHOUT_TRANSACTIONS',
        severity: 'MEDIUM',
        count: analysis.dataIntegrity.cardsWithoutTransactions,
        message: `${analysis.dataIntegrity.cardsWithoutTransactions} cards have no transactions`,
        impact: 'No spending data available for these cards'
      });
    }


    const lastSyncTimes = plaidItems.map(item => ({
      institution: item.institutionName,
      lastSync: item.lastSyncAt,
      minutesAgo: item.lastSyncAt ? Math.round((Date.now() - new Date(item.lastSyncAt).getTime()) / 60000) : null
    }));

    return NextResponse.json({
      message: 'Refresh pipeline verification completed',
      timestamp: new Date().toISOString(),
      analysis,
      details: {
        plaidItems: plaidItems.map(item => ({
          institution: item.institutionName,
          status: item.status,
          accounts: item._count.accounts,
          transactions: item._count.transactions,
          lastSync: item.lastSyncAt,
          errorCode: item.errorCode
        })),
        creditCards: creditCards.map(card => ({
          name: card.name,
          transactions: card._count.transactions,
          billingCycles: card._count.billingCycles,
          openDate: card.openDate,
          hasOpenDate: !!card.openDate
        })),
        unlinkedTransactions: unlinkedTransactions.slice(0, 5).map(t => ({
          date: t.date,
          name: t.name,
          amount: t.amount
        })),
        allBillingCycles: billingCycles.map(cycle => ({
          card: cycle.creditCard.name,
          period: `${new Date(cycle.startDate).toLocaleDateString()} - ${new Date(cycle.endDate).toLocaleDateString()}`,
          totalSpend: cycle.totalSpend,
          statementBalance: cycle.statementBalance
        })),
        lastSyncTimes
      },
      recommendations: [
        unlinkedTransactions.length > 0 && 'Run billing cycle regeneration to link orphaned transactions',
        analysis.dataIntegrity.errorItems > 0 && 'Reconnect failed Plaid items'
      ].filter(Boolean)
    });

  } catch (error) {
    console.error('🔍 VERIFY REFRESH PIPELINE ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to verify refresh pipeline',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}