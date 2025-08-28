import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { plaidService } from '@/services/plaid';
import { decrypt } from '@/lib/encryption';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== CAPITAL ONE LIMITS DEBUG ===');

    // Get Capital One cards from database
    const capitalOneCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: { userId: session.user.id },
        OR: [
          { name: { contains: 'Capital One', mode: 'insensitive' } },
          { name: { contains: 'Quicksilver', mode: 'insensitive' } },
          { name: { contains: 'Venture', mode: 'insensitive' } },
        ]
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

    const results = [];

    for (const card of capitalOneCards) {
      console.log(`\n=== CHECKING CARD: ${card.name} ===`);
      
      // Database values
      const dbInfo = {
        cardName: card.name,
        cardMask: card.mask,
        dbBalanceLimit: card.balanceLimit,
        dbBalanceCurrent: card.balanceCurrent,
        dbBalanceAvailable: card.balanceAvailable,
        accountId: card.accountId
      };
      
      console.log('Database values:', dbInfo);

      try {
        // Test Plaid API calls
        const decryptedToken = decrypt(card.plaidItem.accessToken);
        
        // Get fresh data from Plaid
        console.log('Fetching fresh Plaid data...');
        
        const [liabilities, balances] = await Promise.all([
          plaidService.getLiabilities(decryptedToken),
          plaidService.getBalances(decryptedToken)
        ]);

        // Find this specific card in the responses
        const liabilityAccount = liabilities.liabilities.credit?.find(
          (acc: any) => acc.account_id === card.accountId
        );
        
        const balanceAccount = balances.accounts?.find(
          (acc: any) => acc.account_id === card.accountId
        );

        const plaidInfo = {
          liabilityExists: !!liabilityAccount,
          balanceExists: !!balanceAccount,
          liabilityLimits: liabilityAccount ? {
            limit: liabilityAccount.limit,
            limit_current: liabilityAccount.limit_current,
            balances_limit: liabilityAccount.balances?.limit,
          } : null,
          balanceLimits: balanceAccount ? {
            limit: balanceAccount.balances?.limit,
            available: balanceAccount.balances?.available,
            current: balanceAccount.balances?.current,
          } : null,
          calculatedLimit: null
        };

        // Try the same calculation logic
        if (balanceAccount?.balances?.available && balanceAccount?.balances?.current) {
          const available = balanceAccount.balances.available;
          const current = Math.abs(balanceAccount.balances.current);
          plaidInfo.calculatedLimit = available + current;
        }

        console.log('Plaid API fresh data:', plaidInfo);

        results.push({
          database: dbInfo,
          plaidApi: plaidInfo
        });

      } catch (error) {
        console.error(`Error fetching Plaid data for ${card.name}:`, error);
        results.push({
          database: dbInfo,
          plaidApi: { error: error.message }
        });
      }
    }

    console.log('=== END CAPITAL ONE LIMITS DEBUG ===');

    return NextResponse.json({
      success: true,
      totalCapitalOneCards: capitalOneCards.length,
      results
    });

  } catch (error) {
    console.error('Capital One limits debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug failed',
      details: error.message 
    }, { status: 500 });
  }
}