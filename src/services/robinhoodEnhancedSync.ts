import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Attempts to add investments product to existing Robinhood connection
 * This is done separately after initial connection to avoid filtering issues
 */
export async function addInvestmentsToRobinhoodConnection(
  accessToken: string,
  itemId: string
): Promise<boolean> {
  try {
    console.log('🔄 Attempting to add investments product to Robinhood connection...');
    
    // Check current products on the item
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const currentProducts = itemResponse.data.item.products;
    const availableProducts = itemResponse.data.item.available_products || [];
    
    console.log('Current products:', currentProducts);
    console.log('Available products:', availableProducts);
    
    // Check if investments is available but not yet added
    if (availableProducts.includes('investments') && !currentProducts.includes('investments')) {
      console.log('✅ Investments product is available for addition');
      
      // Note: Adding products requires user to go through Link update mode
      // This would need to be triggered from the UI
      return true;
    } else if (currentProducts.includes('investments')) {
      console.log('✅ Investments product already enabled');
      return true;
    } else {
      console.log('❌ Investments product not available for this institution');
      return false;
    }
  } catch (error) {
    console.error('Error checking investments availability:', error);
    return false;
  }
}

/**
 * Enhanced Robinhood sync that tries multiple approaches to get billing data
 */
export async function enhancedRobinhoodSync(
  accessToken: string,
  accountId: string,
  creditCardId: string
): Promise<{success: boolean; method: string}> {
  console.log('🚀 Starting enhanced Robinhood sync...');
  
  // Method 1: Try to get data from existing products
  try {
    // Check what products are actually available
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken,
    });
    
    const hasInvestments = itemResponse.data.item.products.includes('investments');
    
    if (hasInvestments) {
      console.log('✅ Investments product available - attempting to extract billing data...');
      
      // Try to get investment transactions
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      
      try {
        const investResponse = await plaidClient.investmentsTransactionsGet({
          access_token: accessToken,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
        });
        
        // Look for interest and fee patterns
        const creditRelatedTrans = investResponse.data.investment_transactions?.filter(t => {
          const name = t.name?.toLowerCase() || '';
          return (
            name.includes('interest') ||
            name.includes('fee') ||
            name.includes('charge') ||
            t.type === 'fee'
          );
        });
        
        if (creditRelatedTrans && creditRelatedTrans.length > 0) {
          console.log(`Found ${creditRelatedTrans.length} potential billing indicators in investments`);
          
          // Extract dates from patterns
          const dates = creditRelatedTrans
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 3);
          
          if (dates.length > 0) {
            const mostRecentDate = new Date(dates[0].date);
            const dueDate = new Date(mostRecentDate);
            dueDate.setDate(dueDate.getDate() + 25);
            
            await supabaseAdmin
              .from('credit_cards')
              .update({
                lastStatementIssueDate: mostRecentDate.toISOString(),
                nextPaymentDueDate: dueDate.toISOString(),
                updatedAt: new Date().toISOString()
              })
              .eq('id', creditCardId);
            
            return { success: true, method: 'investments_api' };
          }
        }
      } catch (investError) {
        console.warn('Could not fetch investment transactions:', investError);
      }
    }
    
    // Method 2: Analyze regular transactions for patterns
    console.log('📊 Falling back to transaction pattern analysis...');
    
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    
    const transResponse = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      options: {
        account_ids: [accountId],
        include_personal_finance_category: true
      }
    });
    
    // Look for recurring patterns
    const transactions = transResponse.data.transactions;
    
    // Find interest charges or fees
    const billingIndicators = transactions.filter(t => {
      const name = t.name?.toLowerCase() || '';
      const category = t.personal_finance_category?.primary || '';
      
      return (
        name.includes('interest') ||
        name.includes('finance charge') ||
        category === 'INTEREST' ||
        (name.includes('fee') && t.amount > 0 && t.amount < 100)
      );
    });
    
    if (billingIndicators.length >= 2) {
      // Find the most common day of month
      const dayFrequency = new Map<number, number>();
      billingIndicators.forEach(t => {
        const day = new Date(t.date).getDate();
        dayFrequency.set(day, (dayFrequency.get(day) || 0) + 1);
      });
      
      let maxFreq = 0;
      let statementDay = 0;
      dayFrequency.forEach((freq, day) => {
        if (freq > maxFreq) {
          maxFreq = freq;
          statementDay = day;
        }
      });
      
      if (statementDay > 0) {
        const statementDate = new Date();
        statementDate.setDate(statementDay);
        
        if (statementDate > new Date()) {
          statementDate.setMonth(statementDate.getMonth() - 1);
        }
        
        const dueDate = new Date(statementDate);
        dueDate.setDate(dueDate.getDate() + 25);
        
        await supabaseAdmin
          .from('credit_cards')
          .update({
            lastStatementIssueDate: statementDate.toISOString(),
            nextPaymentDueDate: dueDate.toISOString(),
            updatedAt: new Date().toISOString()
          })
          .eq('id', creditCardId);
        
        console.log(`✅ Updated dates from transaction patterns (day ${statementDay})`);
        return { success: true, method: 'transaction_patterns' };
      }
    }
    
    // Method 3: Use recurring transactions API
    try {
      const recurringResponse = await plaidClient.transactionsRecurringGet({
        access_token: accessToken
      });
      
      const monthlyPatterns = recurringResponse.data.recurring_transactions?.filter(rt =>
        rt.frequency === 'MONTHLY' &&
        rt.is_active &&
        (rt.description?.toLowerCase().includes('interest') ||
         rt.description?.toLowerCase().includes('fee'))
      );
      
      if (monthlyPatterns && monthlyPatterns.length > 0 && monthlyPatterns[0].last_date) {
        const statementDate = new Date(monthlyPatterns[0].last_date);
        const dueDate = new Date(statementDate);
        dueDate.setDate(dueDate.getDate() + 25);
        
        await supabaseAdmin
          .from('credit_cards')
          .update({
            lastStatementIssueDate: statementDate.toISOString(),
            nextPaymentDueDate: dueDate.toISOString(),
            updatedAt: new Date().toISOString()
          })
          .eq('id', creditCardId);
        
        console.log('✅ Updated dates from recurring transaction patterns');
        return { success: true, method: 'recurring_transactions' };
      }
    } catch (recurringError) {
      console.warn('Could not fetch recurring transactions:', recurringError);
    }
    
    console.log('⚠️ No reliable billing patterns found');
    return { success: false, method: 'none' };
    
  } catch (error) {
    console.error('Error in enhanced Robinhood sync:', error);
    return { success: false, method: 'error' };
  }
}