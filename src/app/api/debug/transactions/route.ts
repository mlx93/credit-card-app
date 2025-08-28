import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's plaid items
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      select: { id: true, itemId: true, institutionName: true }
    });

    // Get transaction counts by plaid item
    const transactionStats = await Promise.all(plaidItems.map(async (item) => {
      const count = await prisma.transaction.count({
        where: { plaidItemId: item.id }
      });

      const recent = await prisma.transaction.findMany({
        where: { plaidItemId: item.id },
        orderBy: { date: 'desc' },
        take: 5,
        select: { 
          id: true,
          transactionId: true,
          date: true, 
          amount: true, 
          name: true,
          creditCardId: true
        }
      });

      const oldest = await prisma.transaction.findFirst({
        where: { plaidItemId: item.id },
        orderBy: { date: 'asc' },
        select: { date: true }
      });

      const newest = await prisma.transaction.findFirst({
        where: { plaidItemId: item.id },
        orderBy: { date: 'desc' },
        select: { date: true }
      });

      return {
        institutionName: item.institutionName,
        itemId: item.itemId,
        totalTransactions: count,
        dateRange: {
          oldest: oldest?.date,
          newest: newest?.date
        },
        recentTransactions: recent
      };
    }));

    // Get credit card info
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
        plaidItemId: true,
        transactions: {
          select: { id: true, date: true },
          orderBy: { date: 'desc' },
          take: 3
        }
      }
    });

    return NextResponse.json({
      plaidItems: plaidItems.length,
      transactionStats,
      creditCards: creditCards.map(card => ({
        name: card.name,
        accountId: card.accountId,
        linkedTransactions: card.transactions.length,
        recentTransactionDates: card.transactions.map(t => t.date)
      })),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json({ 
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}