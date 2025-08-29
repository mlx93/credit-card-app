#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function auditUserData(email) {
  try {
    console.log(`\n🔍 PRODUCTION DATA AUDIT FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        items: {
          include: {
            accounts: {
              include: {
                transactions: {
                  orderBy: { date: 'desc' },
                  take: 10
                },
                billingCycles: {
                  orderBy: { endDate: 'desc' }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`\n✅ User found: ${user.name || 'No name'} (${user.email})`);
    console.log(`   Created: ${user.createdAt}`);
    console.log(`   Plaid Items: ${user.items.length}`);

    for (const item of user.items) {
      console.log(`\n📦 PLAID ITEM: ${item.institutionName || 'Unknown'}`);
      console.log(`   Status: ${item.status}`);
      console.log(`   Last Sync: ${item.lastSyncAt || 'Never'}`);
      console.log(`   Credit Cards: ${item.accounts.length}`);
      
      if (item.errorCode) {
        console.log(`   ⚠️ ERROR: ${item.errorCode} - ${item.errorMessage}`);
      }

      for (const card of item.accounts) {
        console.log(`\n   💳 ${card.name} (•••• ${card.mask})`);
        console.log(`      Current Balance: $${Math.abs(card.balanceCurrent || 0).toFixed(2)}`);
        console.log(`      Credit Limit: $${card.balanceLimit || 'N/A'}`);
        console.log(`      Last Statement: $${Math.abs(card.lastStatementBalance || 0).toFixed(2)}`);
        console.log(`      Statement Date: ${card.lastStatementIssueDate || 'N/A'}`);
        console.log(`      Due Date: ${card.nextPaymentDueDate || 'N/A'}`);
        console.log(`      Transactions: ${card.transactions.length} total`);
        console.log(`      Billing Cycles: ${card.billingCycles.length}`);

        // Audit current cycle
        const today = new Date();
        const currentCycle = card.billingCycles.find(c => {
          const start = new Date(c.startDate);
          const end = new Date(c.endDate);
          return today >= start && today <= end;
        });

        if (currentCycle) {
          // Calculate expected current spend
          const currentBalance = Math.abs(card.balanceCurrent || 0);
          const statementBalance = Math.abs(card.lastStatementBalance || 0);
          const expectedCurrentSpend = Math.max(0, currentBalance - statementBalance);
          const storedCurrentSpend = currentCycle.totalSpend || 0;
          
          console.log(`\n      📊 CURRENT CYCLE AUDIT:`);
          console.log(`         Period: ${currentCycle.startDate.toDateString()} - ${currentCycle.endDate.toDateString()}`);
          console.log(`         Stored totalSpend: $${storedCurrentSpend.toFixed(2)}`);
          console.log(`         Expected (balance-based): $${expectedCurrentSpend.toFixed(2)}`);
          
          if (Math.abs(expectedCurrentSpend - storedCurrentSpend) > 0.01) {
            console.log(`         ⚠️ DISCREPANCY: $${Math.abs(expectedCurrentSpend - storedCurrentSpend).toFixed(2)}`);
          } else {
            console.log(`         ✅ Data is consistent`);
          }
        }

        // Check historical cycles
        const historicalCycles = card.billingCycles.filter(c => {
          const end = new Date(c.endDate);
          return end < today && c.statementBalance && c.statementBalance > 0;
        });

        console.log(`\n      📅 HISTORICAL CYCLES:`);
        console.log(`         Total: ${historicalCycles.length}`);
        
        // Check for duplicate amounts (the bug we fixed)
        const amounts = historicalCycles.map(c => c.statementBalance);
        const uniqueAmounts = [...new Set(amounts)];
        
        if (uniqueAmounts.length === 1 && historicalCycles.length > 1) {
          console.log(`         ⚠️ ALL CYCLES HAVE SAME AMOUNT: $${uniqueAmounts[0]}`);
        } else {
          console.log(`         ✅ Unique statement amounts: ${uniqueAmounts.length}`);
        }

        // Check for missing transaction data
        const cyclesWithoutSpend = card.billingCycles.filter(c => 
          !c.totalSpend || c.totalSpend === 0
        );
        
        if (cyclesWithoutSpend.length > 0) {
          console.log(`         ⚠️ Cycles missing totalSpend: ${cyclesWithoutSpend.length}`);
        }

        // Show recent transactions
        if (card.transactions.length > 0) {
          console.log(`\n      💸 RECENT TRANSACTIONS (last 5):`);
          card.transactions.slice(0, 5).forEach(t => {
            console.log(`         ${t.date.toDateString()} - ${t.name} - $${Math.abs(t.amount).toFixed(2)}`);
          });
        }
      }
    }

    // Summary
    const totalCards = user.items.reduce((sum, item) => sum + item.accounts.length, 0);
    const totalTransactions = user.items.reduce((sum, item) => 
      item.accounts.reduce((cardSum, card) => cardSum + card.transactions.length, 0), 0);
    const totalCycles = user.items.reduce((sum, item) => 
      item.accounts.reduce((cardSum, card) => cardSum + card.billingCycles.length, 0), 0);

    console.log(`\n📈 SUMMARY:`);
    console.log(`   Total Credit Cards: ${totalCards}`);
    console.log(`   Total Transactions: ${totalTransactions}`);
    console.log(`   Total Billing Cycles: ${totalCycles}`);
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run audit for specific user
const email = process.argv[2] || 'mylesethan93@gmail.com';
auditUserData(email).then(() => {
  console.log('\n✨ Audit complete\n');
});