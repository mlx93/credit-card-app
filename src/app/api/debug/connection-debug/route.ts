import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('🔍 CONNECTION DEBUG ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Get all user data in one comprehensive query
    const userData = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      include: {
        accounts: {
          include: {
            billingCycles: {
              orderBy: { startDate: 'desc' },
              take: 15 // Get more cycles to see the problem
            },
            transactions: {
              orderBy: { date: 'asc' },
              take: 5 // Get earliest transactions for fallback logic
            }
          }
        }
      }
    });

    const results = userData.map(plaidItem => {
      const itemResult = {
        institutionName: plaidItem.institutionName,
        itemId: plaidItem.itemId,
        status: plaidItem.status,
        lastSyncAt: plaidItem.lastSyncAt,
        errorCode: plaidItem.errorCode,
        errorMessage: plaidItem.errorMessage,
        accounts: plaidItem.accounts.map(account => {
          const earliestTransaction = account.transactions[0];
          const cyclesBeforeOpen = account.billingCycles.filter(cycle => {
            if (!account.openDate) return false; // Can't filter if no open date
            return new Date(cycle.startDate) < new Date(account.openDate);
          });

          return {
            name: account.name,
            accountId: account.accountId,
            mask: account.mask,
            
            // Date analysis
            openDate: account.openDate ? {
              date: account.openDate,
              dateString: new Date(account.openDate).toDateString(),
              isInFuture: new Date(account.openDate) > now,
              monthsAgo: account.openDate ? Math.round((now.getTime() - new Date(account.openDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) : null
            } : null,
            
            lastStatementDate: account.lastStatementIssueDate ? {
              date: account.lastStatementIssueDate,
              dateString: new Date(account.lastStatementIssueDate).toDateString(),
              isInFuture: new Date(account.lastStatementIssueDate) > now
            } : null,

            // Transaction analysis
            transactionAnalysis: {
              totalTransactions: account.transactions.length,
              earliestTransaction: earliestTransaction ? {
                date: earliestTransaction.date,
                dateString: new Date(earliestTransaction.date).toDateString(),
                name: earliestTransaction.name,
                amount: earliestTransaction.amount,
                monthsAgo: Math.round((now.getTime() - new Date(earliestTransaction.date).getTime()) / (1000 * 60 * 60 * 24 * 30))
              } : null,
              // This would be a good fallback open date
              estimatedOpenFromTransaction: earliestTransaction ? new Date(earliestTransaction.date) : null
            },

            // Billing cycle analysis  
            billingCycleAnalysis: {
              totalCycles: account.billingCycles.length,
              cyclesBeforeOpenDate: cyclesBeforeOpen.length,
              shouldHaveCycles: account.openDate ? Math.round((now.getTime() - new Date(account.openDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 'unknown',
              oldestCycle: account.billingCycles.length > 0 ? {
                startDate: account.billingCycles[account.billingCycles.length - 1].startDate,
                startDateString: new Date(account.billingCycles[account.billingCycles.length - 1].startDate).toDateString(),
                monthsAgo: Math.round((now.getTime() - new Date(account.billingCycles[account.billingCycles.length - 1].startDate).getTime()) / (1000 * 60 * 60 * 24 * 30))
              } : null,
              newestCycle: account.billingCycles.length > 0 ? {
                endDate: account.billingCycles[0].endDate,
                endDateString: new Date(account.billingCycles[0].endDate).toDateString(),
                totalSpend: account.billingCycles[0].totalSpend
              } : null
            },

            // Current balance info
            balanceInfo: {
              current: account.balanceCurrent,
              limit: account.balanceLimit,
              lastStatementBalance: account.lastStatementBalance,
              minimumPayment: account.minimumPaymentAmount
            }
          };
        })
      };

      return itemResult;
    });

    // Generate recommendations
    const recommendations = [];
    results.forEach(item => {
      item.accounts.forEach(account => {
        // Missing open date
        if (!account.openDate) {
          recommendations.push({
            type: 'MISSING_OPEN_DATE',
            account: account.name,
            issue: 'No open date in database',
            solution: account.transactionAnalysis.earliestTransaction 
              ? `Use earliest transaction date: ${account.transactionAnalysis.earliestTransaction.dateString}`
              : 'No transaction data available for fallback'
          });
        }

        // Too many cycles for card age
        if (account.openDate && account.billingCycleAnalysis.shouldHaveCycles < account.billingCycleAnalysis.totalCycles) {
          recommendations.push({
            type: 'TOO_MANY_CYCLES',
            account: account.name,
            issue: `Has ${account.billingCycleAnalysis.totalCycles} cycles but card is only ${account.billingCycleAnalysis.shouldHaveCycles} months old`,
            solution: 'Filter cycles to only show those after open date'
          });
        }

        // Connection issues
        if (item.status !== 'active') {
          recommendations.push({
            type: 'CONNECTION_ISSUE',
            account: account.name,
            issue: `Connection status: ${item.status}, Error: ${item.errorMessage}`,
            solution: 'Reconnect through Plaid Link update flow'
          });
        }
      });
    });

    return NextResponse.json({
      message: 'Connection debug completed',
      timestamp: now.toISOString(),
      summary: {
        totalItems: results.length,
        activeConnections: results.filter(r => r.status === 'active').length,
        expiredConnections: results.filter(r => r.status === 'expired').length,
        errorConnections: results.filter(r => r.status === 'error').length,
        accountsWithoutOpenDate: results.reduce((sum, r) => sum + r.accounts.filter(a => !a.openDate).length, 0),
        totalRecommendations: recommendations.length
      },
      results,
      recommendations,
      nextSteps: [
        'Fix missing open dates using transaction fallback logic',
        'Reconnect expired/error connections',  
        'Filter billing cycles based on corrected open dates',
        'Persist corrected open dates in database'
      ]
    });

  } catch (error) {
    console.error('🔍 CONNECTION DEBUG ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to debug connections',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}