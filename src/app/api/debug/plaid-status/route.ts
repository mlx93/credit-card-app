import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-plaid-status',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔍 PLAID STATUS ENDPOINT CALLED');
    
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all Plaid items with their current status
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('*')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    
    // Get all credit cards (accounts) for these items
    const { data: accounts, error: accountsError } = await supabaseAdmin
      .from('credit_cards')
      .select('id, name, mask, openDate, balanceCurrent, lastStatementIssueDate, nextPaymentDueDate, plaidItemId')
      .in('plaidItemId', plaidItemIds);

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    // Combine plaid items with their accounts
    const plaidItemsWithAccounts = (plaidItems || []).map(item => ({
      ...item,
      accounts: (accounts || []).filter(account => account.plaidItemId === item.id)
    }));

    const itemStatus = plaidItemsWithAccounts.map(item => ({
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
        totalItems: plaidItemsWithAccounts.length,
        activeItems: plaidItemsWithAccounts.filter(item => item.status === 'active').length,
        expiredItems: plaidItemsWithAccounts.filter(item => item.status === 'expired').length,
        errorItems: plaidItemsWithAccounts.filter(item => item.status === 'error').length,
        itemsWithRecentErrors: plaidItemsWithAccounts.filter(item => item.errorCode).length,
        oldestSync: plaidItemsWithAccounts.reduce((oldest, item) => {
          if (!item.lastSyncAt) return oldest;
          if (!oldest || new Date(item.lastSyncAt) < new Date(oldest)) return item.lastSyncAt;
          return oldest;
        }, null as string | null),
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