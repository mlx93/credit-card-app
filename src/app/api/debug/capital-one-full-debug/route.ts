import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { plaidService } from '@/services/plaid';
import { plaidClient } from '@/lib/plaid';
import { decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function POST(request: NextRequest) {{
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-capital-one-full-debug',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE FULL DEBUG ANALYSIS ===');

    // 1. Check database for existing credit limits
    console.log('1. CHECKING DATABASE FOR EXISTING CREDIT LIMITS...');
    const { data: allCards, error } = await supabaseAdmin
      .from('credit_cards')
      .select(`
        *,
        plaid_items!inner (
          id,
          item_id,
          institution_name,
          access_token,
          user_id
        )
      `)
      .eq('plaid_items.user_id', session.user.id);
    
    if (error) {
      console.error('Error fetching credit cards:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    console.log('Database Results:');
    allCards.forEach(card => {
      console.log(`Card: ${card.name}`);
      console.log(`  balanceLimit: ${card.balance_limit} (type: ${typeof card.balance_limit})`);
      console.log(`  balanceCurrent: ${card.balance_current}`);
      console.log(`  balanceAvailable: ${card.balance_available}`);
      console.log(`  Institution: ${card.plaid_items?.institution_name}`);
      console.log('---');
    });

    // 2. Test Plaid API directly for Capital One
    console.log('2. TESTING PLAID API DIRECTLY FOR CAPITAL ONE...');
    const capitalOneCards = allCards.filter(card => 
      card.name?.toLowerCase().includes('capital one') || 
      card.name?.toLowerCase().includes('quicksilver') ||
      card.name?.toLowerCase().includes('venture') ||
      card.plaid_items?.institution_name?.toLowerCase().includes('capital one')
    );

    const apiResults = [];

    for (const card of capitalOneCards) {
      console.log(`\n=== TESTING API FOR: ${card.name} ===`);
      
      try {
        const decryptedToken = decrypt(card.plaid_items.access_token);
        
        // Test all three API endpoints
        console.log('Testing liabilitiesGet...');
        const liabilitiesData = await plaidService.getLiabilities(decryptedToken);
        
        console.log('Testing accountsBalanceGet...');
        const balancesData = await plaidService.getBalances(decryptedToken);
        
        console.log('Testing accountsGet...');
        const accountsData = await plaidService.getAccounts(decryptedToken);

        // Find the specific account
        const liabilityAccount = liabilitiesData.accounts?.find(acc => acc.account_id === card.account_id);
        const liability = liabilitiesData.liabilities?.credit?.find(c => c.account_id === card.account_id);
        const balanceAccount = balancesData.accounts?.find(acc => acc.account_id === card.account_id);
        const accountsAccount = accountsData.accounts?.find(acc => acc.account_id === card.account_id);

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
          accountId: card.account_id,
          databaseLimit: card.balance_limit,
          apiLimitSources: limitSources,
          hasLiabilityData: !!liability,
          hasBalanceData: !!balanceAccount,
          hasAccountsData: !!accountsAccount
        });

      } catch (error) {
        console.error(`API test failed for ${card.name}:`, error);
        apiResults.push({
          cardName: card.name,
          accountId: card.account_id,
          databaseLimit: card.balance_limit,
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
        balanceLimit: card.balance_limit,
        balanceCurrent: card.balance_current,
        institution: card.plaid_items?.institution_name
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