import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('📊 USER STATS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get comprehensive user statistics
    const [
      totalUsers,
      usersWithPlaidItems,
      totalPlaidItems,
      totalCreditCards,
      totalTransactions,
      totalBillingCycles,
      recentUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          items: {
            some: {}
          }
        }
      }),
      prisma.plaidItem.count(),
      prisma.creditCard.count(),
      prisma.transaction.count(),
      prisma.billingCycle.count(),
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              items: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 10
      })
    ]);

    // Get active vs inactive items
    const [activeItems, errorItems] = await Promise.all([
      prisma.plaidItem.count({
        where: {
          status: 'active'
        }
      }),
      prisma.plaidItem.count({
        where: {
          status: {
            not: 'active'
          }
        }
      })
    ]);

    const stats = {
      users: {
        total: totalUsers,
        withConnections: usersWithPlaidItems,
        withoutConnections: totalUsers - usersWithPlaidItems
      },
      connections: {
        totalPlaidItems,
        active: activeItems,
        withErrors: errorItems
      },
      data: {
        creditCards: totalCreditCards,
        transactions: totalTransactions,
        billingCycles: totalBillingCycles,
        avgTransactionsPerCard: totalCreditCards > 0 ? Math.round(totalTransactions / totalCreditCards) : 0,
        avgCyclesPerCard: totalCreditCards > 0 ? Math.round(totalBillingCycles / totalCreditCards) : 0
      },
      recent: recentUsers.map(user => ({
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        plaidItems: user._count.items,
        isCurrentUser: user.id === session.user.id
      }))
    };

    console.log('📊 USER STATS:', stats);
    
    return NextResponse.json({ 
      message: 'User statistics retrieved',
      stats
    });
  } catch (error) {
    console.error('📊 USER STATS ERROR:', error);
    return NextResponse.json({ error: 'Failed to get user statistics' }, { status: 500 });
  }
}