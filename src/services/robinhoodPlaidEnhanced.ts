import { plaidClient } from '@/lib/plaid';
import { InvestmentsTransactionsGetRequest } from 'plaid';

interface RobinhoodBillingInfo {
  statementDate: Date | null;
  dueDate: Date | null;
  statementBalance: number | null;
  minimumPayment: number | null;
  confidence: number;
  source: string;
}

/**
 * Enhanced Robinhood credit card data extraction using Investments API
 * Since Robinhood doesn't support liabilities, we use the Investments product
 * to extract billing cycle information from investment transactions.
 */
export async function getRobinhoodBillingInfo(
  accessToken: string,
  accountId: string
): Promise<RobinhoodBillingInfo> {
  try {
    console.log('🎯 Fetching Robinhood billing info via Investments API...');
    
    // Get 3 months of investment transactions
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);
    
    const request: InvestmentsTransactionsGetRequest = {
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      options: {
        count: 500,
        offset: 0
      }
    };
    
    const response = await plaidClient.investmentsTransactionsGet(request);
    
    // Filter for credit card related investment transactions
    const creditTransactions = response.data.investment_transactions?.filter(t => {
      const name = t.name?.toLowerCase() || '';
      const type = t.type?.toLowerCase() || '';
      const subtype = t.subtype?.toLowerCase() || '';
      
      return (
        // Interest charges typically indicate statement close
        name.includes('interest') ||
        name.includes('finance charge') ||
        // Fee transactions often align with statement dates
        type === 'fee' ||
        subtype.includes('fee') ||
        name.includes('annual fee') ||
        name.includes('late fee') ||
        // Management fees might correlate with billing
        subtype.includes('management_fee')
      );
    }) || [];
    
    // Find the most recent interest/fee charge (likely statement date)
    const interestCharges = creditTransactions
      .filter(t => 
        t.name?.toLowerCase().includes('interest') || 
        t.name?.toLowerCase().includes('finance charge')
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    let statementDate: Date | null = null;
    let statementBalance: number | null = null;
    let confidence = 0;
    let source = 'none';
    
    if (interestCharges.length > 0) {
      // Most recent interest charge is likely the last statement date
      statementDate = new Date(interestCharges[0].date);
      confidence = 0.8;
      source = 'interest_charge';
      
      // Sum up charges around statement date for balance estimate
      const statementDay = statementDate.getDate();
      const chargesNearStatement = creditTransactions.filter(t => {
        const tDay = new Date(t.date).getDate();
        return Math.abs(tDay - statementDay) <= 2; // Within 2 days
      });
      
      if (chargesNearStatement.length > 0) {
        statementBalance = chargesNearStatement.reduce((sum, t) => sum + (t.amount || 0), 0);
      }
    } else if (creditTransactions.length > 0) {
      // Fallback: Use most recent fee transaction
      const sortedFees = creditTransactions
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      statementDate = new Date(sortedFees[0].date);
      confidence = 0.5;
      source = 'fee_transaction';
    }
    
    // Calculate due date (typically 25 days after statement)
    let dueDate: Date | null = null;
    if (statementDate) {
      dueDate = new Date(statementDate);
      dueDate.setDate(dueDate.getDate() + 25);
    }
    
    // Estimate minimum payment (typically 2% of balance or $25, whichever is greater)
    let minimumPayment: number | null = null;
    if (statementBalance && statementBalance > 0) {
      minimumPayment = Math.max(25, statementBalance * 0.02);
    }
    
    // If we still don't have data, check recurring patterns
    if (!statementDate) {
      console.log('🔄 Checking recurring transactions for Robinhood billing patterns...');
      
      try {
        const recurringResponse = await plaidClient.transactionsRecurringGet({
          access_token: accessToken
        });
        
        // Look for monthly recurring fees/interest
        const monthlyCharges = recurringResponse.data.recurring_transactions?.filter(rt => {
          const desc = rt.description?.toLowerCase() || '';
          return (
            rt.frequency === 'MONTHLY' && (
              desc.includes('interest') ||
              desc.includes('fee') ||
              desc.includes('charge')
            )
          );
        });
        
        if (monthlyCharges && monthlyCharges.length > 0) {
          const mostRecent = monthlyCharges[0];
          if (mostRecent.last_date) {
            statementDate = new Date(mostRecent.last_date);
            dueDate = new Date(statementDate);
            dueDate.setDate(dueDate.getDate() + 25);
            confidence = 0.6;
            source = 'recurring_pattern';
          }
        }
      } catch (recurringError) {
        console.warn('Could not fetch recurring transactions:', recurringError);
      }
    }
    
    // Final check: Use regular transactions API for investment account
    if (!statementDate) {
      console.log('🔍 Checking regular transactions for Robinhood patterns...');
      
      try {
        const transResponse = await plaidClient.transactionsGet({
          access_token: accessToken,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          options: {
            account_ids: [accountId],
            include_personal_finance_category: true
          }
        });
        
        // Look for interest/fee patterns in regular transactions
        const interestTrans = transResponse.data.transactions.filter(t => {
          const name = t.name?.toLowerCase() || '';
          const category = t.personal_finance_category?.primary || '';
          
          return (
            name.includes('interest') ||
            name.includes('finance charge') ||
            category === 'INTEREST' ||
            category === 'BANK_FEES'
          );
        }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        
        if (interestTrans.length > 0) {
          statementDate = new Date(interestTrans[0].date);
          dueDate = new Date(statementDate);
          dueDate.setDate(dueDate.getDate() + 25);
          statementBalance = Math.abs(interestTrans[0].amount || 0);
          confidence = 0.7;
          source = 'transaction_interest';
        }
      } catch (transError) {
        console.warn('Could not fetch regular transactions:', transError);
      }
    }
    
    console.log(`✅ Robinhood billing info extracted with ${(confidence * 100).toFixed(0)}% confidence from ${source}`);
    if (statementDate) {
      console.log(`  Statement Date: ${statementDate.toISOString().split('T')[0]}`);
      console.log(`  Due Date: ${dueDate?.toISOString().split('T')[0]}`);
      console.log(`  Statement Balance: $${statementBalance?.toFixed(2) || 'unknown'}`);
    }
    
    return {
      statementDate,
      dueDate,
      statementBalance,
      minimumPayment,
      confidence,
      source
    };
    
  } catch (error) {
    console.error('Error fetching Robinhood billing info:', error);
    return {
      statementDate: null,
      dueDate: null,
      statementBalance: null,
      minimumPayment: null,
      confidence: 0,
      source: 'error'
    };
  }
}

/**
 * Updates Robinhood credit card with extracted billing information
 */
export async function syncRobinhoodBillingData(
  accessToken: string,
  accountId: string,
  creditCardId: string
): Promise<boolean> {
  try {
    const billingInfo = await getRobinhoodBillingInfo(accessToken, accountId);
    
    if (!billingInfo.statementDate || billingInfo.confidence < 0.3) {
      console.log('⚠️ Insufficient confidence in Robinhood billing data, skipping update');
      return false;
    }
    
    // Import supabase here to avoid circular dependency
    const { supabaseAdmin } = await import('@/lib/supabase');
    
    const updateData: any = {
      updatedAt: new Date().toISOString()
    };
    
    // Only update fields we have confidence in
    if (billingInfo.statementDate) {
      updateData.lastStatementIssueDate = billingInfo.statementDate.toISOString();
    }
    
    if (billingInfo.dueDate) {
      updateData.nextPaymentDueDate = billingInfo.dueDate.toISOString();
    }
    
    if (billingInfo.statementBalance !== null) {
      updateData.lastStatementBalance = billingInfo.statementBalance;
    }
    
    if (billingInfo.minimumPayment !== null) {
      updateData.minimumPaymentAmount = billingInfo.minimumPayment;
    }
    
    const { error } = await supabaseAdmin
      .from('credit_cards')
      .update(updateData)
      .eq('id', creditCardId);
    
    if (error) {
      console.error('Failed to update Robinhood credit card:', error);
      return false;
    }
    
    console.log(`✅ Updated Robinhood credit card with billing data (confidence: ${(billingInfo.confidence * 100).toFixed(0)}%)`);
    return true;
    
  } catch (error) {
    console.error('Error syncing Robinhood billing data:', error);
    return false;
  }
}