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

    // Get user's Plaid items
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      select: { id: true, itemId: true, institutionName: true }
    });

    // Get user's credit cards
    const creditCards = await prisma.creditCard.findMany({
      where: { 
        plaidItem: { userId: session.user.id }
      },
      select: {
        id: true,
        accountId: true,
        name: true,
        mask: true,
        plaidItemId: true,
        balanceCurrent: true,
        balanceLimit: true,
        lastStatementBalance: true,
        _count: {
          select: { transactions: true }
        }
      }
    });

    // Get total transaction count and recent transactions
    const totalTransactions = await prisma.transaction.count({
      where: {
        plaidItem: { userId: session.user.id }
      }
    });

    const recentTransactions = await prisma.transaction.findMany({
      where: {
        plaidItem: { userId: session.user.id }
      },
      select: {
        id: true,
        transactionId: true,
        name: true,
        amount: true,
        date: true,
        creditCardId: true,
        plaidItemId: true
      },
      orderBy: { date: 'desc' },
      take: 10
    });

    // Get transaction counts by credit card
    const transactionsByCard = await prisma.transaction.groupBy({
      by: ['creditCardId'],
      where: {
        plaidItem: { userId: session.user.id }
      },
      _count: {
        _all: true
      }
    });

    // Get date range of transactions
    const dateRange = await prisma.transaction.aggregate({
      where: {
        plaidItem: { userId: session.user.id }
      },
      _min: { date: true },
      _max: { date: true }
    });

    return NextResponse.json({
      plaidItems: plaidItems.map(item => ({
        id: item.id,
        itemId: item.itemId,
        institutionName: item.institutionName
      })),
      creditCards,
      transactionStats: {
        total: totalTransactions,
        byCard: transactionsByCard,
        dateRange: {
          earliest: dateRange._min.date,
          latest: dateRange._max.date
        }
      },
      recentTransactions
    });

  } catch (error) {
    console.error('Database debug error:', error);
    return NextResponse.json({ error: 'Debug failed' }, { status: 500 });
  }
}