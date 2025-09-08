import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const isLight = url.searchParams.get('light') === '1' || url.searchParams.get('light') === 'true';

    // Get user's plaid items first
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, itemId, institutionName, status, lastSyncAt, errorMessage')
      .eq('userId', session.user.id);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid items: ${plaidError.message}`);
    }

    const plaidItemIds = (plaidItems || []).map(item => item.id);
    if (plaidItemIds.length === 0) {
      return NextResponse.json({ creditCards: [] });
    }

    // Get credit cards for user's plaid items
    const { data: creditCards, error: cardsError } = await supabaseAdmin
      .from('credit_cards')
      .select('*')
      .in('plaidItemId', plaidItemIds)
      .order('createdAt', { ascending: false });

    if (cardsError) {
      throw new Error(`Failed to fetch credit cards: ${cardsError.message}`);
    }

    const creditCardIds = (creditCards || []).map(card => card.id);

    // Get APRs for all credit cards (optional in light mode)
    let aprs: any[] = [];
    if (!isLight) {
      const { data: aprRows, error: aprsError } = await supabaseAdmin
        .from('aprs')
        .select('*')
        .in('creditCardId', creditCardIds);
      if (aprsError) {
        throw new Error(`Failed to fetch APRs: ${aprsError.message}`);
      }
      aprs = aprRows || [];
    }

    // For light mode, skip heavy transaction scan
    const transactionCounts = new Map<string, number>();
    const transactionsByCard = new Map<string, any[]>();
    if (!isLight && creditCardIds.length > 0) {
      const { data: transactions, error: transactionError } = await supabaseAdmin
        .from('transactions')
        .select('creditCardId, name, amount, date, authorizedDate')
        .in('creditCardId', creditCardIds)
        .not('creditCardId', 'is', null)
        .order('date', { ascending: false });

      if (!transactionError && transactions) {
        transactions.forEach(t => {
          const count = transactionCounts.get(t.creditCardId) || 0;
          transactionCounts.set(t.creditCardId, count + 1);
          const cardTransactions = transactionsByCard.get(t.creditCardId) || [];
          cardTransactions.push(t);
          transactionsByCard.set(t.creditCardId, cardTransactions);
        });
      }
    }

    // Create maps for efficient lookup
    const plaidItemMap = new Map();
    (plaidItems || []).forEach(item => {
      plaidItemMap.set(item.id, item);
    });

    const aprMap = new Map();
    (aprs || []).forEach(apr => {
      const cardAprs = aprMap.get(apr.creditCardId) || [];
      cardAprs.push(apr);
      aprMap.set(apr.creditCardId, cardAprs);
    });

    // Helper function to detect payments and calculate remaining statement balance
    function calculateRemainingStatementBalance(card: any): number {
      const originalStatementBalance = Math.abs(card.lastStatementBalance || 0);
      const currentBalance = Math.abs(card.balanceCurrent || 0);
      
      // If no statement balance or current balance >= statement balance, no payment detected
      if (!originalStatementBalance || currentBalance >= originalStatementBalance) {
        return originalStatementBalance;
      }
      
      // Look for payment transactions since the last statement date
      const cardTransactions = transactionsByCard.get(card.id) || [];
      const lastStatementDate = card.lastStatementIssueDate ? new Date(card.lastStatementIssueDate) : null;
      
      if (!lastStatementDate || cardTransactions.length === 0) {
        return originalStatementBalance;
      }
      
      const recentPayments = cardTransactions.filter(t => {
        const transactionDate = new Date(t.date);
        return transactionDate > lastStatementDate && // After statement date
               isPaymentTransaction(t.name) && // Is a payment transaction
               t.amount < 0; // Payments are negative amounts
      });
      
      if (recentPayments.length === 0) {
        return originalStatementBalance;
      }
      
      // Sum up payment amounts
      const totalPayments = recentPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      console.log(`💳 Payment detected for ${card.name}:`, {
        originalStatementBalance,
        currentBalance,
        totalPayments,
        recentPayments: recentPayments.map(p => ({ name: p.name, amount: p.amount, date: p.date }))
      });
      
      // Calculate remaining statement balance
      return Math.max(0, originalStatementBalance - totalPayments);
    }

    // Combine all data and apply payment detection
    const formattedCreditCards = (creditCards || []).map(card => {
      // Debug: Check card's payment data from database
      console.log(`💰 Card data from database for ${card.name}:`, {
        minimumPaymentAmount: card.minimumPaymentAmount,
        lastStatementBalance: card.lastStatementBalance,
        balanceCurrent: card.balanceCurrent,
        nextPaymentDueDate: card.nextPaymentDueDate
      });

      const adjustedCard = {
        ...card,
        plaidItem: plaidItemMap.get(card.plaidItemId) || null,
        aprs: isLight ? [] : (aprMap.get(card.id) || []),
        _count: {
          transactions: transactionCounts.get(card.id) || 0,
        },
      };
      
      // In light mode, skip heavy payment detection (keep DB values as-is)
      if (!isLight && adjustedCard.lastStatementBalance) {
        const originalStatementBalance = adjustedCard.lastStatementBalance;
        adjustedCard.lastStatementBalance = calculateRemainingStatementBalance(card);
        if (originalStatementBalance > 0 && adjustedCard.lastStatementBalance === 0) {
          adjustedCard.minimumPaymentAmount = 0;
        }
      }
      
      return adjustedCard;
    });

    const response = NextResponse.json({ creditCards: formattedCreditCards });
    
    // Add no-cache headers to ensure fresh data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('Error fetching credit cards:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
