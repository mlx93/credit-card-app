import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE FULL DEBUG ANALYSIS ===');

    // 1. Check database for existing credit limits
    console.log('1. CHECKING DATABASE FOR EXISTING CREDIT LIMITS...');
    const allCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: { userId: session.user.id }
      },
      include: {
        plaidItem: {
          select: {
            id: true,
            itemId: true,
            institutionName: true,
            accessToken: true
          }
        }
      }
    });

    console.log('Database Results:');
    allCards.forEach(card => {
      console.log(`Card: ${card.name}`);
      console.log(`  balanceLimit: ${card.balanceLimit} (type: ${typeof card.balanceLimit})`);
      console.log(`  balanceCurrent: ${card.balanceCurrent}`);
      console.log(`  balanceAvailable: ${card.balanceAvailable}`);
      console.log(`  Institution: ${card.plaidItem?.institutionName}`);
      console.log('---');
    });

    // 2. Test Plaid API directly for Capital One
    console.log('2. TESTING PLAID API DIRECTLY FOR CAPITAL ONE...');
    const capitalOneCards = allCards.filter(card => 
      card.name?.toLowerCase().includes('capital one') || 
      card.name?.toLowerCase().includes('quicksilver') ||
      card.name?.toLowerCase().includes('venture') ||
      card.plaidItem?.institutionName?.toLowerCase().includes('capital one')
    );

    const apiResults = [];

    for (const card of capitalOneCards) {
      console.log(`\n=== TESTING API FOR: ${card.name} ===`);
      
      try {
        const decryptedToken = decrypt(card.plaidItem.accessToken);
        
        // Test all three API endpoints
        console.log('Testing liabilitiesGet...');
        const liabilitiesData = await plaidService.getLiabilities(decryptedToken);
        
        console.log('Testing accountsBalanceGet...');
        const balancesData = await plaidService.getBalances(decryptedToken);
        
        console.log('Testing accountsGet...');
        const accountsData = await plaidService.getAccounts(decryptedToken);

        // Find the specific account
        const liabilityAccount = liabilitiesData.accounts?.find(acc => acc.account_id === card.accountId);
        const liability = liabilitiesData.liabilities?.credit?.find(c => c.account_id === card.accountId);
        const balanceAccount = balancesData.accounts?.find(acc => acc.account_id === card.accountId);
        const accountsAccount = accountsData.accounts?.find(acc => acc.account_id === card.accountId);

        console.log('Raw API Data for', card.name, ':');
        console.log('  Liability Account:', JSON.stringify(liabilityAccount, null, 2));
        console.log('  Liability Data:', JSON.stringify(liability, null, 2));
        console.log('  Balance Account:', JSON.stringify(balanceAccount, null, 2));
        console.log('  Accounts Account:', JSON.stringify(accountsAccount, null, 2));

        // Extract all possible limit values
        const limitSources = {
          liabilityAccountLimit: liabilityAccount?.balances?.limit,
          liabilityLimit: liability?.limit,
          liabilityLimitCurrent: liability?.limit_current,
          liabilityBalancesLimit: liability?.balances?.limit,
          balanceAccountLimit: balanceAccount?.balances?.limit,
          accountsAccountLimit: accountsAccount?.balances?.limit,
          aprBasedLimits: liability?.aprs?.map(apr => ({
            type: apr.apr_type,
            percentage: apr.apr_percentage,
            balanceSubjectToApr: apr.balance_subject_to_apr
          }))
        };

        console.log('All possible limit sources:', limitSources);

        apiResults.push({
          cardName: card.name,
          accountId: card.accountId,
          databaseLimit: card.balanceLimit,
          apiLimitSources: limitSources,
          hasLiabilityData: !!liability,
          hasBalanceData: !!balanceAccount,
          hasAccountsData: !!accountsAccount
        });

      } catch (error) {
        console.error(`API test failed for ${card.name}:`, error);
        apiResults.push({
          cardName: card.name,
          accountId: card.accountId,
          databaseLimit: card.balanceLimit,
          error: error.message
        });
      }
    }

    console.log('=== END CAPITAL ONE FULL DEBUG ANALYSIS ===');

    return NextResponse.json({
      success: true,
      totalCards: allCards.length,
      capitalOneCards: capitalOneCards.length,
      databaseResults: allCards.map(card => ({
        name: card.name,
        balanceLimit: card.balanceLimit,
        balanceCurrent: card.balanceCurrent,
        institution: card.plaidItem?.institutionName
      })),
      apiResults,
      message: 'Full Capital One debug completed - check console for detailed logs'
    });

  } catch (error) {
    console.error('Capital One full debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}