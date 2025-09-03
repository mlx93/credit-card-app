#!/usr/bin/env node

/**
 * Amex Billing Cycle Debug Script
 * 
 * This script diagnoses why the Amex billing cycle generation is only producing 8 cycles
 * instead of 12 months by checking three key potential issues:
 * 
 * 1. Card Open Date Limiting - if the card was opened less than 12 months ago
 * 2. Transaction Data Availability - if transaction data only goes back 8 months
 * 3. Historical Cycle Loop Termination - if the while loop exits early
 */

const { PrismaClient } = require('@prisma/client');
const { differenceInMonths, differenceInDays } = require('date-fns');

const prisma = new PrismaClient();

async function debugAmexCycles() {
  console.log('🔍 AMEX BILLING CYCLE DIAGNOSIS');
  console.log('=' .repeat(60));

  try {
    // Find the Amex card (looking for Platinum or any Amex card)
    const amexCard = await prisma.creditCard.findFirst({
      where: {
        OR: [
          { name: { contains: 'Platinum' } },
          { name: { contains: 'Amex' } },
          { name: { contains: 'American Express' } }
        ]
      },
      include: {
        transactions: {
          orderBy: { date: 'asc' }
        },
        plaidItem: true
      }
    });

    if (!amexCard) {
      console.log('❌ No Amex card found in database');
      return;
    }

    console.log(`📱 Found Amex Card: ${amexCard.name} (${amexCard.mask})`);
    console.log(`🏦 Institution: ${amexCard.plaidItem?.institutionName}`);
    console.log(`🆔 Card ID: ${amexCard.id}`);
    console.log('');

    // Get current billing cycles
    const existingCycles = await prisma.billingCycle.findMany({
      where: { creditCardId: amexCard.id },
      orderBy: { startDate: 'desc' }
    });

    console.log(`📊 Existing Cycles in Database: ${existingCycles.length}`);
    console.log('');

    // DIAGNOSIS 1: Card Open Date Analysis
    console.log('🔎 DIAGNOSIS 1: CARD OPEN DATE LIMITING');
    console.log('-' .repeat(50));
    
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);
    
    const cardOpenDate = amexCard.openDate ? new Date(amexCard.openDate) : oneYearAgo;
    const earliestCycleDate = cardOpenDate > oneYearAgo ? cardOpenDate : oneYearAgo;
    
    console.log(`📅 Today: ${today.toISOString().split('T')[0]}`);
    console.log(`📅 One Year Ago: ${oneYearAgo.toISOString().split('T')[0]}`);
    console.log(`📅 Card Open Date: ${amexCard.openDate ? cardOpenDate.toISOString().split('T')[0] : 'Not set (using one year ago)'}`);
    console.log(`📅 Earliest Cycle Date: ${earliestCycleDate.toISOString().split('T')[0]}`);
    
    const monthsSinceOpen = amexCard.openDate ? differenceInMonths(today, cardOpenDate) : 12;
    const isCardLimitingCycles = cardOpenDate > oneYearAgo;
    
    console.log(`⏰ Months Since Card Opened: ${monthsSinceOpen}`);
    console.log(`🚫 Is Card Open Date Limiting Cycles: ${isCardLimitingCycles ? 'YES' : 'NO'}`);
    
    if (isCardLimitingCycles) {
      console.log(`⚠️  POTENTIAL ISSUE 1: Card opened only ${monthsSinceOpen} months ago`);
      console.log(`   This would naturally limit cycles to ~${monthsSinceOpen} instead of 12`);
    } else {
      console.log(`✅ Card Open Date is NOT limiting cycles (card is old enough)`);
    }
    console.log('');

    // DIAGNOSIS 2: Transaction Data Availability
    console.log('🔎 DIAGNOSIS 2: TRANSACTION DATA AVAILABILITY');
    console.log('-' .repeat(50));
    
    const transactions = amexCard.transactions || [];
    console.log(`📈 Total Transactions: ${transactions.length}`);
    
    if (transactions.length === 0) {
      console.log(`❌ CRITICAL ISSUE: No transactions found - this would prevent cycle generation`);
    } else {
      const oldestTransaction = new Date(Math.min(...transactions.map(t => new Date(t.date).getTime())));
      const newestTransaction = new Date(Math.max(...transactions.map(t => new Date(t.date).getTime())));
      const transactionSpanMonths = differenceInMonths(newestTransaction, oldestTransaction);
      const monthsSinceOldest = differenceInMonths(today, oldestTransaction);
      
      console.log(`📅 Oldest Transaction: ${oldestTransaction.toISOString().split('T')[0]}`);
      console.log(`📅 Newest Transaction: ${newestTransaction.toISOString().split('T')[0]}`);
      console.log(`⏰ Transaction Data Span: ${transactionSpanMonths} months`);
      console.log(`⏰ Months Since Oldest Transaction: ${monthsSinceOldest} months`);
      
      // Check if transaction data is limiting cycles
      const isTransactionDataLimited = monthsSinceOldest < 12;
      console.log(`🚫 Is Transaction Data Limiting Cycles: ${isTransactionDataLimited ? 'YES' : 'NO'}`);
      
      if (isTransactionDataLimited) {
        console.log(`⚠️  POTENTIAL ISSUE 2: Transaction data only goes back ${monthsSinceOldest} months`);
        console.log(`   This would limit meaningful cycles to ~${monthsSinceOldest} instead of 12`);
      } else {
        console.log(`✅ Transaction data is NOT limiting cycles (goes back far enough)`);
      }
      
      // Show transaction distribution by month
      console.log(`\n📊 Transaction Distribution by Month:`);
      const transactionsByMonth = {};
      transactions.forEach(t => {
        const monthKey = new Date(t.date).toISOString().substr(0, 7); // YYYY-MM
        transactionsByMonth[monthKey] = (transactionsByMonth[monthKey] || 0) + 1;
      });
      
      const sortedMonths = Object.keys(transactionsByMonth).sort().reverse();
      sortedMonths.slice(0, 12).forEach(month => {
        const count = transactionsByMonth[month];
        const monthsAgo = differenceInMonths(today, new Date(month + '-01'));
        console.log(`   ${month}: ${count} transactions (${monthsAgo} months ago)`);
      });
    }
    console.log('');

    // DIAGNOSIS 3: Historical Cycle Loop Analysis
    console.log('🔎 DIAGNOSIS 3: HISTORICAL CYCLE LOOP SIMULATION');
    console.log('-' .repeat(50));
    
    // Simulate the historical cycle generation logic from billingCycles.ts
    const lastStatementDate = amexCard.lastStatementIssueDate;
    const nextDueDate = amexCard.nextPaymentDueDate;
    
    console.log(`📋 Last Statement Date: ${lastStatementDate ? lastStatementDate.toISOString().split('T')[0] : 'Not set'}`);
    console.log(`📋 Next Due Date: ${nextDueDate ? nextDueDate.toISOString().split('T')[0] : 'Not set'}`);
    
    if (!lastStatementDate) {
      console.log(`⚠️  ISSUE: No lastStatementIssueDate - would use generateEstimatedCycles instead`);
      console.log(`   This might explain different cycle generation behavior`);
    } else {
      // Estimate cycle length (from billingCycles.ts logic)
      let cycleLength = 30;
      if (nextDueDate) {
        const gracePeriod = differenceInDays(nextDueDate, lastStatementDate);
        console.log(`📋 Grace Period: ${gracePeriod} days`);
        
        if (gracePeriod >= 20 && gracePeriod <= 25) {
          cycleLength = 30;
        } else if (gracePeriod >= 26 && gracePeriod <= 32) {
          cycleLength = 31;
        }
      }
      console.log(`📋 Estimated Cycle Length: ${cycleLength} days`);
      
      // Simulate the historical cycle loop
      console.log(`\n🔄 Simulating Historical Cycle Generation:`);
      
      const closedCycleEnd = new Date(lastStatementDate);
      let historicalCycleEnd = new Date(closedCycleEnd);
      historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
      
      let cycleCount = 0;
      const simulatedCycles = [];
      
      console.log(`   Starting from: ${historicalCycleEnd.toISOString().split('T')[0]}`);
      console.log(`   Loop condition: historicalCycleEnd >= earliestCycleDate`);
      console.log(`   Earliest allowed date: ${earliestCycleDate.toISOString().split('T')[0]}`);
      console.log('');
      
      while (historicalCycleEnd >= earliestCycleDate && cycleCount < 20) { // Safety limit
        const historicalCycleStart = new Date(historicalCycleEnd);
        historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);
        
        // Check the skip condition from billingCycles.ts
        const shouldSkip = amexCard.openDate && historicalCycleEnd < new Date(amexCard.openDate);
        
        if (shouldSkip) {
          console.log(`   Cycle ${cycleCount + 1}: ${historicalCycleStart.toISOString().split('T')[0]} to ${historicalCycleEnd.toISOString().split('T')[0]} - SKIPPED (ends before card open)`);
        } else {
          console.log(`   Cycle ${cycleCount + 1}: ${historicalCycleStart.toISOString().split('T')[0]} to ${historicalCycleEnd.toISOString().split('T')[0]} - CREATED`);
          simulatedCycles.push({
            start: new Date(historicalCycleStart),
            end: new Date(historicalCycleEnd)
          });
        }
        
        // Move to next historical cycle
        historicalCycleEnd = new Date(historicalCycleStart);
        historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
        cycleCount++;
        
        // Safety check
        if (cycleCount >= 20) {
          console.log(`   ... (stopping after 20 iterations for safety)`);
          break;
        }
      }
      
      console.log(`\n📊 Simulation Results:`);
      console.log(`   Total iterations: ${cycleCount}`);
      console.log(`   Cycles that would be created: ${simulatedCycles.length}`);
      console.log(`   Loop terminated because: ${historicalCycleEnd < earliestCycleDate ? 'reached earliest date' : 'safety limit'}`);
      console.log(`   Final historicalCycleEnd: ${historicalCycleEnd.toISOString().split('T')[0]}`);
      
      if (simulatedCycles.length < 12) {
        console.log(`⚠️  POTENTIAL ISSUE 3: Loop would only create ${simulatedCycles.length} historical cycles`);
        
        // Check why it's limited
        if (isCardLimitingCycles) {
          console.log(`   Root cause: Card open date is limiting cycle generation`);
        } else {
          console.log(`   Root cause: Loop termination logic or date calculation issue`);
        }
      } else {
        console.log(`✅ Historical cycle loop would generate sufficient cycles (${simulatedCycles.length})`);
      }
    }
    
    console.log('');

    // FINAL ANALYSIS
    console.log('🎯 FINAL DIAGNOSIS');
    console.log('=' .repeat(60));
    
    const issues = [];
    
    if (isCardLimitingCycles && monthsSinceOpen <= 8) {
      issues.push(`1. CARD OPEN DATE: Card opened only ${monthsSinceOpen} months ago, naturally limiting to ~${monthsSinceOpen} cycles`);
    }
    
    if (transactions.length === 0) {
      issues.push(`2. NO TRANSACTION DATA: No transactions available for cycle calculation`);
    } else {
      const monthsSinceOldest = differenceInMonths(today, new Date(Math.min(...transactions.map(t => new Date(t.date).getTime()))));
      if (monthsSinceOldest <= 8) {
        issues.push(`3. LIMITED TRANSACTION DATA: Transaction data only goes back ${monthsSinceOldest} months`);
      }
    }
    
    if (!lastStatementDate) {
      issues.push(`4. MISSING STATEMENT DATE: No lastStatementIssueDate, using estimated cycles instead`);
    }
    
    if (issues.length === 0) {
      console.log(`🤔 No obvious issues found. The 8-cycle limit might be due to:`);
      console.log(`   - Business logic intentionally limiting cycles`);
      console.log(`   - Database filtering in getAllUserBillingCycles`);
      console.log(`   - Capital One-specific limiting (though this card doesn't appear to be Capital One)`);
    } else {
      console.log(`🚨 ROOT CAUSE IDENTIFIED:`);
      issues.forEach(issue => console.log(`   ${issue}`));
    }
    
    console.log(`\n📈 Current Status:`);
    console.log(`   - Cycles in database: ${existingCycles.length}`);
    console.log(`   - Expected based on card age: ${Math.min(12, monthsSinceOpen)}`);
    console.log(`   - Expected based on transaction data: ${transactions.length > 0 ? Math.min(12, differenceInMonths(today, new Date(Math.min(...transactions.map(t => new Date(t.date).getTime()))))) : 0}`);

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the diagnosis
debugAmexCycles().then(() => {
  console.log('\n✨ Diagnosis complete');
}).catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});