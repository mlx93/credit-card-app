import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    console.log('🔍 PLAID STATUS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all Plaid items with their current status
    const plaidItems = await prisma.plaidItem.findMany({
      where: { userId: session.user.id },
      include: {
        accounts: {
          select: {
            id: true,
            name: true,
            mask: true,
            openDate: true,
            balanceCurrent: true,
            lastStatementIssueDate: true,
            nextPaymentDueDate: true
          }
        }
      }
    });

    const itemStatus = plaidItems.map(item => ({
      institutionName: item.institutionName,
      itemId: item.itemId,
      status: item.status,
      lastSyncAt: item.lastSyncAt,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      accounts: item.accounts.map(account => ({
        name: account.name,
        mask: account.mask,
        openDate: account.openDate,
        openDateString: account.openDate ? new Date(account.openDate).toDateString() : null,
        isOpenDateInFuture: account.openDate ? new Date(account.openDate) > new Date() : false,
        balanceCurrent: account.balanceCurrent,
        lastStatementDate: account.lastStatementIssueDate,
        lastStatementDateString: account.lastStatementIssueDate ? new Date(account.lastStatementIssueDate).toDateString() : null,
        isStatementDateInFuture: account.lastStatementIssueDate ? new Date(account.lastStatementIssueDate) > new Date() : false,
        nextDueDate: account.nextPaymentDueDate,
        nextDueDateString: account.nextPaymentDueDate ? new Date(account.nextPaymentDueDate).toDateString() : null
      }))
    }));

    console.log('\n🔍 PLAID STATUS COMPLETED');
    
    return NextResponse.json({ 
      message: 'Plaid status retrieved successfully',
      timestamp: new Date().toISOString(),
      items: itemStatus,
      summary: {
        totalItems: plaidItems.length,
        activeItems: plaidItems.filter(item => item.status === 'active').length,
        expiredItems: plaidItems.filter(item => item.status === 'expired').length,
        errorItems: plaidItems.filter(item => item.status === 'error').length,
        itemsWithRecentErrors: plaidItems.filter(item => item.errorCode).length,
        oldestSync: plaidItems.reduce((oldest, item) => {
          if (!item.lastSyncAt) return oldest;
          if (!oldest || item.lastSyncAt < oldest) return item.lastSyncAt;
          return oldest;
        }, null as Date | null),
        accountsWithFutureDates: itemStatus.reduce((count, item) => 
          count + item.accounts.filter(acc => acc.isOpenDateInFuture || acc.isStatementDateInFuture).length, 0)
      }
    });
  } catch (error) {
    console.error('🔍 PLAID STATUS ERROR:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve Plaid status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}