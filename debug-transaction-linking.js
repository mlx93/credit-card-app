/**
 * Debug Transaction Linking Issues
 * 
 * This script investigates why historical cycles show $0 instead of actual transaction data
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugTransactionLinking() {
  console.log('🔍 Debugging Transaction Linking Issues\n');

  try {
    // 1. Check how many transactions exist total
    const { data: allTransactions, error: transError } = await supabase
      .from('transactions')
      .select('id, name, amount, date, creditCardId, accountid, plaidtransactionid, transactionId')
      .limit(20);
    
    if (transError) {
      console.error('Error fetching transactions:', transError);
      return;
    }

    console.log(`📊 Found ${allTransactions?.length || 0} transactions (showing first 20)`);
    
    // 2. Count transactions with and without creditCardId
    const linkedTransactions = allTransactions?.filter(t => t.creditCardId) || [];
    const unlinkedTransactions = allTransactions?.filter(t => !t.creditCardId) || [];
    
    console.log(`✅ Linked transactions (have creditCardId): ${linkedTransactions.length}`);
    console.log(`❌ Unlinked transactions (no creditCardId): ${unlinkedTransactions.length}\n`);

    // 3. Show sample unlinked transactions
    if (unlinkedTransactions.length > 0) {
      console.log('🔍 Sample unlinked transactions:');
      unlinkedTransactions.slice(0, 5).forEach(t => {
        console.log(`  - ${t.name}: $${t.amount}`);
        console.log(`    accountid: ${t.accountid}, creditCardId: ${t.creditCardId}`);
        console.log(`    plaidtransactionid: ${t.plaidtransactionid}, transactionId: ${t.transactionId}`);
      });
      console.log();
    }

    // 4. Check credit cards and their accountIds
    const { data: creditCards, error: cardsError } = await supabase
      .from('credit_cards')
      .select('id, name, accountId, mask');
    
    if (cardsError) {
      console.error('Error fetching credit cards:', cardsError);
      return;
    }

    console.log(`💳 Found ${creditCards?.length || 0} credit cards:`);
    creditCards?.forEach(card => {
      console.log(`  - ${card.name} (*${card.mask}): accountId = ${card.accountId}`);
    });
    console.log();

    // 5. Check for accountId mismatches
    const accountIds = new Set(creditCards?.map(c => c.accountId) || []);
    const transactionAccountIds = new Set(allTransactions?.map(t => t.accountId) || []);
    
    console.log('🔍 Account ID Analysis:');
    console.log(`Credit card account IDs: ${Array.from(accountIds).join(', ')}`);
    console.log(`Transaction account IDs: ${Array.from(transactionAccountIds).join(', ')}`);
    
    const missingAccounts = Array.from(transactionAccountIds).filter(id => !accountIds.has(id));
    const unusedAccounts = Array.from(accountIds).filter(id => !transactionAccountIds.has(id));
    
    if (missingAccounts.length > 0) {
      console.log(`❌ Transaction account IDs with no matching credit card: ${missingAccounts.join(', ')}`);
    }
    
    if (unusedAccounts.length > 0) {
      console.log(`⚠️ Credit card account IDs with no transactions: ${unusedAccounts.join(', ')}`);
    }

    // 6. Check if any credit cards have transactions
    console.log('\n📈 Transaction counts per credit card:');
    for (const card of creditCards || []) {
      const { count, error } = await supabase
        .from('transactions')
        .select('id', { count: 'exact' })
        .eq('creditCardId', card.id);
      
      if (!error) {
        console.log(`  - ${card.name}: ${count || 0} transactions`);
      }
    }

    // 7. Check billing cycles
    console.log('\n📅 Checking billing cycles:');
    const { data: billingCycles, error: cyclesError } = await supabase
      .from('billing_cycles')
      .select('id, creditCardName, totalSpend, transactionCount, startDate, endDate')
      .limit(10);
    
    if (!cyclesError && billingCycles) {
      console.log(`Found ${billingCycles.length} billing cycles (showing first 10):`);
      billingCycles.forEach(cycle => {
        console.log(`  - ${cycle.creditCardName}: $${cycle.totalSpend} (${cycle.transactionCount} transactions) ${cycle.startDate} to ${cycle.endDate}`);
      });
    }

  } catch (error) {
    console.error('Debug error:', error);
  }
}

// Run the debug if this file is executed directly
if (require.main === module) {
  debugTransactionLinking().then(() => {
    console.log('\n✅ Debug completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  });
}

module.exports = { debugTransactionLinking };