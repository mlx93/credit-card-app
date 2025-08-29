#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function testReconnectionFlow(email) {
  try {
    console.log('\n🧪 COMPREHENSIVE RECONNECTION FLOW TEST');
    console.log(`Email: ${email}`);
    console.log('=' .repeat(80));
    
    // Step 1: Check current state before reconnection
    console.log('🔍 Step 1: Analyzing current state before reconnection...');
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        items: {
          include: {
            accounts: {
              include: {
                billingCycles: {
                  orderBy: { endDate: 'desc' },
                  take: 3
                },
                transactions: {
                  orderBy: { date: 'desc' },
                  take: 5
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

    console.log(`✅ Found user: ${user.name} (${user.email})`);
    console.log(`📱 Plaid items: ${user.items.length}`);
    
    for (const item of user.items) {
      console.log(`\n🏦 ${item.institutionName}:`);
      console.log(`   Status: ${item.status}`);
      console.log(`   Error: ${item.errorMessage || 'None'}`);
      console.log(`   Last Sync: ${item.lastSyncAt ? item.lastSyncAt.toISOString() : 'Never'}`);
      console.log(`   Accounts: ${item.accounts.length}`);
      
      for (const account of item.accounts) {
        console.log(`   \n   💳 ${account.name}:`);
        console.log(`      Open Date: ${account.openDate ? new Date(account.openDate).toDateString() : '❌ NOT SET'}`);
        console.log(`      Statement Date: ${account.lastStatementIssueDate ? new Date(account.lastStatementIssueDate).toDateString() : 'Not set'}`);
        console.log(`      Balance: $${account.balanceCurrent || 0} / $${account.balanceLimit || 'No limit'}`);
        console.log(`      Billing Cycles: ${account.billingCycles.length}`);
        console.log(`      Transactions: ${account.transactions.length}`);
        
        // Show recent billing cycles
        if (account.billingCycles.length > 0) {
          console.log(`      Recent cycles:`);
          account.billingCycles.forEach((cycle, index) => {
            const start = new Date(cycle.startDate).toDateString();
            const end = new Date(cycle.endDate).toDateString();
            console.log(`        ${index + 1}. ${start} to ${end} | Statement: $${cycle.statementBalance || 'N/A'}`);
          });
        }
      }
    }

    // Step 2: Check for problematic conditions
    console.log('\n🔍 Step 2: Identifying problematic conditions...');
    
    const problemCards = [];
    const expiredConnections = [];
    
    for (const item of user.items) {
      if (item.status !== 'active') {
        expiredConnections.push(item);
      }
      
      for (const account of item.accounts) {
        const problems = [];
        
        if (!account.openDate) {
          problems.push('Missing open date');
        }
        
        if (account.openDate && new Date(account.openDate) < new Date('2024-01-01')) {
          problems.push('Open date too old (before 2024)');
        }
        
        if (account.openDate && new Date(account.openDate) > new Date()) {
          problems.push('Open date in future');
        }
        
        if (account.billingCycles.length === 0) {
          problems.push('No billing cycles');
        }
        
        if (account.transactions.length === 0) {
          problems.push('No transactions');
        }
        
        if (problems.length > 0) {
          problemCards.push({
            name: account.name,
            institution: item.institutionName,
            problems
          });
        }
      }
    }

    if (problemCards.length > 0) {
      console.log(`⚠️ Found ${problemCards.length} cards with issues:`);
      problemCards.forEach(card => {
        console.log(`   💳 ${card.name} (${card.institution}):`);
        card.problems.forEach(problem => {
          console.log(`      ❌ ${problem}`);
        });
      });
    } else {
      console.log('✅ No problematic cards found');
    }

    if (expiredConnections.length > 0) {
      console.log(`\n🔗 Found ${expiredConnections.length} expired connections:`);
      expiredConnections.forEach(item => {
        console.log(`   🏦 ${item.institutionName}: ${item.status} - ${item.errorMessage || 'No error message'}`);
      });
      console.log('\n💡 These connections need to be reconnected using the PlaidUpdateLink component');
    }

    // Step 3: Test data validation
    console.log('\n🔍 Step 3: Data validation checks...');
    
    const validationResults = {
      totalCards: 0,
      cardsWithOpenDates: 0,
      cardsWithReasonableOpenDates: 0,
      cardsWithBillingCycles: 0,
      cardsWithTransactions: 0,
      cardsWithRecentTransactions: 0,
      activeConnections: 0,
      expiredConnections: 0
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    for (const item of user.items) {
      if (item.status === 'active') {
        validationResults.activeConnections++;
      } else {
        validationResults.expiredConnections++;
      }
      
      for (const account of item.accounts) {
        validationResults.totalCards++;
        
        if (account.openDate) {
          validationResults.cardsWithOpenDates++;
          
          const openDate = new Date(account.openDate);
          if (openDate >= twoYearsAgo && openDate <= new Date()) {
            validationResults.cardsWithReasonableOpenDates++;
          }
        }
        
        if (account.billingCycles.length > 0) {
          validationResults.cardsWithBillingCycles++;
        }
        
        if (account.transactions.length > 0) {
          validationResults.cardsWithTransactions++;
          
          const recentTransactions = account.transactions.filter(t => 
            new Date(t.date) >= thirtyDaysAgo
          );
          if (recentTransactions.length > 0) {
            validationResults.cardsWithRecentTransactions++;
          }
        }
      }
    }

    console.log('📊 Validation Results:');
    console.log(`   Total Cards: ${validationResults.totalCards}`);
    console.log(`   Cards with Open Dates: ${validationResults.cardsWithOpenDates}/${validationResults.totalCards}`);
    console.log(`   Cards with Reasonable Open Dates: ${validationResults.cardsWithReasonableOpenDates}/${validationResults.totalCards}`);
    console.log(`   Cards with Billing Cycles: ${validationResults.cardsWithBillingCycles}/${validationResults.totalCards}`);
    console.log(`   Cards with Transactions: ${validationResults.cardsWithTransactions}/${validationResults.totalCards}`);
    console.log(`   Cards with Recent Transactions: ${validationResults.cardsWithRecentTransactions}/${validationResults.totalCards}`);
    console.log(`   Active Connections: ${validationResults.activeConnections}/${user.items.length}`);
    console.log(`   Expired Connections: ${validationResults.expiredConnections}/${user.items.length}`);

    // Step 4: Provide recommendations
    console.log('\n💡 Step 4: Recommendations...');
    
    const recommendations = [];
    
    if (validationResults.expiredConnections > 0) {
      recommendations.push(`🔗 Reconnect ${validationResults.expiredConnections} expired connection(s) using PlaidUpdateLink component`);
    }
    
    if (validationResults.cardsWithOpenDates < validationResults.totalCards) {
      const missingCount = validationResults.totalCards - validationResults.cardsWithOpenDates;
      recommendations.push(`📅 ${missingCount} card(s) missing open dates - these will be set automatically during reconnection`);
    }
    
    if (validationResults.cardsWithReasonableOpenDates < validationResults.cardsWithOpenDates) {
      const unreasonableCount = validationResults.cardsWithOpenDates - validationResults.cardsWithReasonableOpenDates;
      recommendations.push(`⚠️ ${unreasonableCount} card(s) have unreasonable open dates - these will be corrected during reconnection`);
    }
    
    if (validationResults.cardsWithBillingCycles < validationResults.totalCards) {
      const missingCount = validationResults.totalCards - validationResults.cardsWithBillingCycles;
      recommendations.push(`📊 ${missingCount} card(s) missing billing cycles - these will be regenerated after reconnection`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ All data looks good! No immediate action needed.');
    }
    
    recommendations.forEach(rec => {
      console.log(`   ${rec}`);
    });

    // Step 5: Expected outcomes after reconnection
    console.log('\n🎯 Step 5: Expected outcomes after reconnection...');
    
    console.log('After using the improved reconnection flow:');
    console.log('   ✅ Fresh access tokens will be stored with encryption');
    console.log('   ✅ All account data (balances, limits) will be refreshed');
    console.log('   ✅ origination_date will be extracted from Plaid liabilities endpoint');
    console.log('   ✅ Intelligent fallbacks will be applied if origination_date is missing');
    console.log('   ✅ Database updates will be atomic (transaction-wrapped)');
    console.log('   ✅ Comprehensive validation will ensure data persistence');
    console.log('   ✅ Billing cycles will be regenerated with correct open date filtering');
    console.log('   ✅ Detailed logging will help debug any issues');

    // Specific Bank of America expectations
    const boaItems = user.items.filter(item => 
      item.institutionName?.toLowerCase().includes('bank of america')
    );
    
    if (boaItems.length > 0) {
      console.log('\n🏦 Bank of America specific expectations:');
      console.log('   📅 Open date should be set to June 28, 2025');
      console.log('   📊 Billing cycles should start from June 28, 2025 (not August 2024)');
      console.log('   💳 Credit limits should be properly extracted from liability APR data');
      console.log('   📈 Only valid cycles (after card opening) should be shown');
    }

    console.log('\n✅ Reconnection flow test completed');
    console.log('💡 To test the fix: Disconnect and reconnect your Bank of America card via the frontend');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Test specific card data validation
async function validateCardData(cardName, institutionName) {
  try {
    console.log(`\n🔍 VALIDATING SPECIFIC CARD: ${cardName} (${institutionName})`);
    console.log('=' .repeat(60));
    
    const card = await prisma.creditCard.findFirst({
      where: {
        name: { contains: cardName },
        plaidItem: {
          institutionName: { contains: institutionName }
        }
      },
      include: {
        plaidItem: true,
        billingCycles: {
          orderBy: { endDate: 'desc' }
        },
        transactions: {
          orderBy: { date: 'desc' },
          take: 10
        }
      }
    });

    if (!card) {
      console.log('❌ Card not found');
      return;
    }

    console.log('📋 Card Details:');
    console.log(`   Name: ${card.name}`);
    console.log(`   Institution: ${card.plaidItem?.institutionName}`);
    console.log(`   Connection Status: ${card.plaidItem?.status}`);
    console.log(`   Open Date: ${card.openDate ? new Date(card.openDate).toDateString() : '❌ NOT SET'}`);
    console.log(`   Statement Date: ${card.lastStatementIssueDate ? new Date(card.lastStatementIssueDate).toDateString() : 'Not set'}`);
    console.log(`   Due Date: ${card.nextPaymentDueDate ? new Date(card.nextPaymentDueDate).toDateString() : 'Not set'}`);
    console.log(`   Balance: $${card.balanceCurrent || 0}`);
    console.log(`   Limit: $${card.balanceLimit || 'Not set'}`);
    console.log(`   Statement Balance: $${card.lastStatementBalance || 0}`);

    console.log(`\n📊 Billing Cycles (${card.billingCycles.length}):`);
    if (card.billingCycles.length > 0) {
      card.billingCycles.slice(0, 5).forEach((cycle, index) => {
        const start = new Date(cycle.startDate).toDateString();
        const end = new Date(cycle.endDate).toDateString();
        const due = cycle.dueDate ? new Date(cycle.dueDate).toDateString() : 'No due date';
        console.log(`   ${index + 1}. ${start} to ${end}`);
        console.log(`      Statement: $${cycle.statementBalance || 'N/A'} | Due: ${due} | Spend: $${cycle.totalSpend || 0}`);
      });
    } else {
      console.log('   ❌ No billing cycles found');
    }

    console.log(`\n💳 Recent Transactions (${card.transactions.length} total):`);
    if (card.transactions.length > 0) {
      card.transactions.slice(0, 5).forEach((tx, index) => {
        const date = new Date(tx.date).toDateString();
        console.log(`   ${index + 1}. ${date} | $${tx.amount} | ${tx.name}`);
      });
    } else {
      console.log('   ❌ No transactions found');
    }

  } catch (error) {
    console.error('❌ Card validation failed:', error.message);
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
testReconnectionFlow(email).then(() => {
  console.log('\n🏁 Test completed');
  
  // Optional: Test specific card if provided
  const cardName = process.argv[3];
  const institutionName = process.argv[4];
  
  if (cardName && institutionName) {
    return validateCardData(cardName, institutionName);
  }
}).catch(error => {
  console.error('\n💥 Test failed:', error.message);
  process.exit(1);
});