import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { isPaymentTransaction } from '@/utils/billingCycles';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Get APRs for all credit cards
    const { data: aprs, error: aprsError } = await supabaseAdmin
      .from('aprs')
      .select('*')
      .in('creditCardId', creditCardIds);

    if (aprsError) {
      throw new Error(`Failed to fetch APRs: ${aprsError.message}`);
    }

    // Get transactions for payment detection and counting
    const transactionCounts = new Map();
    const transactionsByCard = new Map();
    if (creditCardIds.length > 0) {
      const { data: transactions, error: transactionError } = await supabaseAdmin
        .from('transactions')
        .select('creditCardId, name, amount, date, authorizedDate')
        .in('creditCardId', creditCardIds)
        .not('creditCardId', 'is', null)
        .order('date', { ascending: false });

      if (!transactionError && transactions) {
        transactions.forEach(t => {
          // Count transactions
          const count = transactionCounts.get(t.creditCardId) || 0;
          transactionCounts.set(t.creditCardId, count + 1);
          
          // Group transactions by card for payment detection
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
      const adjustedCard = {
        ...card,
        plaidItem: plaidItemMap.get(card.plaidItemId) || null,
        aprs: aprMap.get(card.id) || [],
        _count: {
          transactions: transactionCounts.get(card.id) || 0,
        },
      };
      
      // Apply payment detection to adjust statement balance and minimum payment
      if (adjustedCard.lastStatementBalance) {
        const originalStatementBalance = adjustedCard.lastStatementBalance;
        adjustedCard.lastStatementBalance = calculateRemainingStatementBalance(card);
        
        // If statement balance was reduced to 0, set minimum payment to 0 as well
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