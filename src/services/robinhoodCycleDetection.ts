import { plaidClient } from '@/lib/plaid';
import { supabaseAdmin } from '@/lib/supabase';

interface CyclePattern {
  statementDay: number;
  dueDay: number;
  confidence: number;
  method: string;
}

/**
 * Advanced Robinhood billing cycle detection for users without fees/interest
 * Uses multiple signals to infer billing cycles
 */
export async function detectRobinhoodCycleAdvanced(
  accessToken: string,
  accountId: string
): Promise<CyclePattern | null> {
  try {
    console.log('🔍 Advanced Robinhood cycle detection starting...');
    
    // Get 6 months of transactions for pattern analysis
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6);
    
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      options: {
        account_ids: [accountId],
        include_personal_finance_category: true,
        count: 500
      }
    });
    
    const transactions = response.data.transactions;
    console.log(`Analyzing ${transactions.length} transactions...`);
    
    // Method 1: Payment Pattern Detection
    const payments = detectPaymentPattern(transactions);
    if (payments) {
      return payments;
    }
    
    // Method 2: Transaction Volume Analysis
    const volumePattern = detectVolumePattern(transactions);
    if (volumePattern) {
      return volumePattern;
    }
    
    // Method 3: Cashback/Rewards Pattern
    const rewardsPattern = detectRewardsPattern(transactions);
    if (rewardsPattern) {
      return rewardsPattern;
    }
    
    // Method 4: Transaction Gap Analysis
    const gapPattern = detectTransactionGaps(transactions);
    if (gapPattern) {
      return gapPattern;
    }
    
    // Method 5: Account Balance Patterns
    const balancePattern = await detectBalancePattern(accessToken, accountId);
    if (balancePattern) {
      return balancePattern;
    }
    
    console.log('⚠️ No reliable pattern detected');
    return null;
    
  } catch (error) {
    console.error('Error in advanced cycle detection:', error);
    return null;
  }
}

/**
 * Method 1: Detect payment patterns (even if always on time)
 */
function detectPaymentPattern(transactions: any[]): CyclePattern | null {
  const payments = transactions.filter(t => {
    const name = t.name?.toLowerCase() || '';
    const category = t.personal_finance_category?.primary || '';
    
    return (
      t.amount < 0 && (
        name.includes('payment') ||
        name.includes('pymt') ||
        name.includes('transfer') ||
        name.includes('ach') ||
        category === 'TRANSFER_IN' ||
        category === 'DEPOSIT' ||
        // Robinhood specific payment patterns
        name.includes('robinhood') && t.amount < 0
      )
    );
  });
  
  if (payments.length >= 3) {
    // Analyze payment timing
    const paymentDays = payments.map(p => new Date(p.date).getDate());
    const dayFrequency = new Map<number, number>();
    
    paymentDays.forEach(day => {
      // Group within 3-day window for weekends/holidays
      const normalizedDay = Math.round(day / 3) * 3;
      dayFrequency.set(normalizedDay, (dayFrequency.get(normalizedDay) || 0) + 1);
    });
    
    let maxFreq = 0;
    let paymentDay = 0;
    dayFrequency.forEach((freq, day) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        paymentDay = day;
      }
    });
    
    if (maxFreq >= 2) {
      // Statement is typically 25 days before payment
      let statementDay = paymentDay - 25;
      if (statementDay <= 0) statementDay += 30;
      
      console.log(`✅ Found payment pattern: payments around day ${paymentDay}`);
      
      return {
        statementDay,
        dueDay: paymentDay,
        confidence: Math.min(0.8, 0.4 + (maxFreq * 0.1)),
        method: 'payment_pattern'
      };
    }
  }
  
  return null;
}

/**
 * Method 2: Detect transaction volume patterns (spending often drops after statement close)
 */
function detectVolumePattern(transactions: any[]): CyclePattern | null {
  // Group transactions by day of month
  const transactionsByDay = new Map<number, number[]>();
  
  transactions.forEach(t => {
    if (t.amount > 0) { // Only purchases
      const day = new Date(t.date).getDate();
      if (!transactionsByDay.has(day)) {
        transactionsByDay.set(day, []);
      }
      transactionsByDay.get(day)!.push(t.amount);
    }
  });
  
  // Find days with notably low transaction volume
  const dailyAverages = new Map<number, number>();
  let totalAvg = 0;
  let dayCount = 0;
  
  transactionsByDay.forEach((amounts, day) => {
    const avg = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    dailyAverages.set(day, avg);
    totalAvg += avg;
    dayCount++;
  });
  
  if (dayCount > 0) {
    totalAvg /= dayCount;
    
    // Find days with significantly lower spending (potential statement close)
    const quietDays: number[] = [];
    dailyAverages.forEach((avg, day) => {
      if (avg < totalAvg * 0.5) { // Less than 50% of average
        quietDays.push(day);
      }
    });
    
    if (quietDays.length > 0) {
      // Most common quiet day might be around statement close
      const dayFreq = new Map<number, number>();
      quietDays.forEach(day => {
        dayFreq.set(day, (dayFreq.get(day) || 0) + 1);
      });
      
      let maxFreq = 0;
      let statementDay = 0;
      dayFreq.forEach((freq, day) => {
        if (freq > maxFreq) {
          maxFreq = freq;
          statementDay = day;
        }
      });
      
      if (statementDay > 0) {
        console.log(`📊 Found volume pattern: low spending around day ${statementDay}`);
        
        return {
          statementDay,
          dueDay: (statementDay + 25) % 31 || 1,
          confidence: 0.5,
          method: 'volume_pattern'
        };
      }
    }
  }
  
  return null;
}

/**
 * Method 3: Detect cashback/rewards posting patterns
 */
function detectRewardsPattern(transactions: any[]): CyclePattern | null {
  const rewards = transactions.filter(t => {
    const name = t.name?.toLowerCase() || '';
    const category = t.personal_finance_category?.primary || '';
    
    return (
      (t.amount < 0 && t.amount > -100) && ( // Small credits
        name.includes('cashback') ||
        name.includes('cash back') ||
        name.includes('reward') ||
        name.includes('points') ||
        name.includes('credit adjustment') ||
        name.includes('statement credit') ||
        category === 'CREDIT_CARD_REWARD'
      )
    );
  });
  
  if (rewards.length >= 2) {
    // Rewards often post with statement
    const rewardDays = rewards.map(r => new Date(r.date).getDate());
    const dayFreq = new Map<number, number>();
    
    rewardDays.forEach(day => {
      dayFreq.set(day, (dayFreq.get(day) || 0) + 1);
    });
    
    let maxFreq = 0;
    let rewardDay = 0;
    dayFreq.forEach((freq, day) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        rewardDay = day;
      }
    });
    
    if (rewardDay > 0 && maxFreq >= 2) {
      console.log(`🎁 Found rewards pattern: cashback posts around day ${rewardDay}`);
      
      return {
        statementDay: rewardDay,
        dueDay: (rewardDay + 25) % 31 || 1,
        confidence: 0.6,
        method: 'rewards_pattern'
      };
    }
  }
  
  return null;
}

/**
 * Method 4: Detect transaction gaps (no transactions right after statement)
 */
function detectTransactionGaps(transactions: any[]): CyclePattern | null {
  // Sort transactions by date
  const sorted = transactions
    .filter(t => t.amount > 0) // Only purchases
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  if (sorted.length < 30) return null;
  
  // Find gaps between transactions
  const gaps: { startDay: number; gapDays: number }[] = [];
  
  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(sorted[i - 1].date);
    const currDate = new Date(sorted[i].date);
    const gapDays = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (gapDays >= 3) { // Gap of 3+ days
      gaps.push({
        startDay: prevDate.getDate(),
        gapDays
      });
    }
  }
  
  if (gaps.length >= 3) {
    // Find recurring gap pattern
    const gapDayFreq = new Map<number, number>();
    gaps.forEach(gap => {
      gapDayFreq.set(gap.startDay, (gapDayFreq.get(gap.startDay) || 0) + 1);
    });
    
    let maxFreq = 0;
    let gapStartDay = 0;
    gapDayFreq.forEach((freq, day) => {
      if (freq > maxFreq) {
        maxFreq = freq;
        gapStartDay = day;
      }
    });
    
    if (gapStartDay > 0 && maxFreq >= 2) {
      console.log(`⏸️ Found gap pattern: spending gaps after day ${gapStartDay}`);
      
      return {
        statementDay: gapStartDay,
        dueDay: (gapStartDay + 25) % 31 || 1,
        confidence: 0.4,
        method: 'gap_pattern'
      };
    }
  }
  
  return null;
}

/**
 * Method 5: Detect balance reset patterns
 */
async function detectBalancePattern(
  accessToken: string,
  accountId: string
): Promise<CyclePattern | null> {
  try {
    // Get historical balances to look for patterns
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 3);
    
    // Try to get balance history (not all institutions support this)
    const balanceResponse = await plaidClient.accountsBalanceGet({
      access_token: accessToken,
      options: {
        account_ids: [accountId]
      }
    });
    
    // Check if balance follows a pattern
    const account = balanceResponse.data.accounts[0];
    if (account && account.balances) {
      // This is limited - Plaid doesn't provide historical balance data easily
      // But we can infer from current balance and payment date
      const currentBalance = account.balances.current || 0;
      const availableCredit = account.balances.available || 0;
      const limit = account.balances.limit || 0;
      
      // If balance is very low compared to limit, payment might be recent
      if (limit > 0 && currentBalance < limit * 0.1) {
        const today = new Date().getDate();
        // Assume payment was recent (within last 5 days)
        const estimatedPaymentDay = today <= 5 ? today + 25 : today - 5;
        const estimatedStatementDay = estimatedPaymentDay - 25;
        
        console.log(`💳 Inferred from low balance: payment likely around day ${estimatedPaymentDay}`);
        
        return {
          statementDay: estimatedStatementDay > 0 ? estimatedStatementDay : estimatedStatementDay + 30,
          dueDay: estimatedPaymentDay,
          confidence: 0.3,
          method: 'balance_inference'
        };
      }
    }
  } catch (error) {
    console.warn('Could not analyze balance patterns:', error);
  }
  
  return null;
}

/**
 * Apply detected pattern to update credit card dates
 */
export async function applyRobinhoodCyclePattern(
  creditCardId: string,
  pattern: CyclePattern
): Promise<boolean> {
  try {
    const today = new Date();
    const currentDay = today.getDate();
    
    // Calculate the most recent statement date
    let statementDate = new Date();
    statementDate.setDate(pattern.statementDay);
    
    // If statement day hasn't occurred this month yet, go to previous month
    if (pattern.statementDay > currentDay) {
      statementDate.setMonth(statementDate.getMonth() - 1);
    }
    
    // Calculate due date
    let dueDate = new Date(statementDate);
    dueDate.setDate(dueDate.getDate() + 25);
    
    // If due date has passed, move to next cycle
    if (dueDate < today) {
      statementDate.setMonth(statementDate.getMonth() + 1);
      dueDate.setMonth(dueDate.getMonth() + 1);
    }
    
    console.log(`📅 Applying cycle pattern (${pattern.method}):`);
    console.log(`   Statement: ${statementDate.toISOString().split('T')[0]}`);
    console.log(`   Due: ${dueDate.toISOString().split('T')[0]}`);
    console.log(`   Confidence: ${(pattern.confidence * 100).toFixed(0)}%`);
    
    const { error } = await supabaseAdmin
      .from('credit_cards')
      .update({
        lastStatementIssueDate: statementDate.toISOString(),
        nextPaymentDueDate: dueDate.toISOString(),
        updatedAt: new Date().toISOString()
      })
      .eq('id', creditCardId);
    
    if (error) {
      console.error('Failed to update credit card:', error);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('Error applying cycle pattern:', error);
    return false;
  }
}