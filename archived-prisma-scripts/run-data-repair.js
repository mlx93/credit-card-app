#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

// Helper function to identify payment transactions based on transaction name
function isPaymentTransaction(transactionName) {
  const lowerName = transactionName.toLowerCase();
  
  // Common payment indicators across different banks
  const paymentIndicators = [
    'pymt',           // Capital One payments
    'payment',        // Amex and other banks
    'autopay',        // Automatic payments
    'online payment', // Online payments
    'mobile payment', // Mobile app payments
    'phone payment',  // Phone payments
    'bank payment',   // Bank transfers
    'ach payment',    // ACH payments
    'electronic payment', // Electronic payments
    'web payment',    // Web payments
  ];
  
  return paymentIndicators.some(indicator => lowerName.includes(indicator));
}

async function runDataRepair() {
  try {
    console.log('🔧 STARTING DATA REPAIR SCRIPT');
    console.log('=' .repeat(60));

    // Get all credit cards with related data
    const creditCards = await prisma.creditCard.findMany({
      include: {
        plaidItem: true,
        transactions: {
          orderBy: { date: 'desc' }
        },
        billingCycles: {
          orderBy: { endDate: 'desc' }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards for repair`);

    const repairResults = [];

    for (const card of creditCards) {
      console.log(`\n=== REPAIRING ${card.name} ===`);
      
      const cardRepair = {
        cardName: card.name,
        cardId: card.id,
        repairs: []
      };

      const today = new Date();

      for (const cycle of card.billingCycles) {
        const cycleStart = new Date(cycle.startDate);
        const cycleEnd = new Date(cycle.endDate);
        const isCurrentCycle = today >= cycleStart && today <= cycleEnd;
        const isHistoricalCycle = cycleEnd < today;
        
        // Get transactions for this cycle
        const effectiveEndDate = cycleEnd > today ? today : cycleEnd;
        const cycleTransactions = card.transactions.filter(t => 
          t.date >= cycleStart && t.date <= effectiveEndDate
        );
        
        const transactionBasedSpend = cycleTransactions.reduce((sum, t) => {
          // Exclude payment transactions, include charges and refunds
          if (isPaymentTransaction(t.name)) {
            console.log(`  Excluding payment: ${t.name} (${t.amount})`);
            return sum; // Skip payments
          }
          return sum + t.amount; // Include charges (positive) and refunds (negative)
        }, 0);
        
        // Calculate correct spend value
        let correctSpend = transactionBasedSpend;
        let correctStatementBalance = cycle.statementBalance;
        
        if (isCurrentCycle && card.balanceCurrent && card.lastStatementBalance) {
          // For current cycles, use balance-based calculation
          const currentBalance = Math.abs(card.balanceCurrent);
          const statementBalance = Math.abs(card.lastStatementBalance);
          correctSpend = Math.max(0, currentBalance - statementBalance);
          correctStatementBalance = null; // Current cycles shouldn't have statement balance
        } else if (isHistoricalCycle) {
          // For historical cycles, use transaction-based spend
          correctSpend = transactionBasedSpend;
          
          // Check if this is the exact statement cycle
          const lastStatementDate = card.lastStatementIssueDate ? new Date(card.lastStatementIssueDate) : null;
          const isExactStatementCycle = lastStatementDate && cycleEnd.getTime() === lastStatementDate.getTime();
          
          if (isExactStatementCycle && card.lastStatementBalance) {
            // Use actual statement balance for the exact statement cycle
            correctStatementBalance = Math.abs(card.lastStatementBalance);
            correctSpend = correctStatementBalance; // For statement cycle, spend should match statement
          } else if (transactionBasedSpend > 0 && !correctStatementBalance) {
            // Set statement balance for historical cycles with transactions
            correctStatementBalance = transactionBasedSpend;
          }
        }
        
        // Check if repair is needed
        const needsSpendUpdate = Math.abs((cycle.totalSpend || 0) - correctSpend) > 0.01;
        const needsStatementUpdate = correctStatementBalance !== cycle.statementBalance;
        
        if (needsSpendUpdate || needsStatementUpdate) {
          console.log(`  Repairing cycle ${cycleStart.toDateString()} - ${cycleEnd.toDateString()}:`);
          console.log(`    Old totalSpend: ${cycle.totalSpend} -> New: ${correctSpend}`);
          console.log(`    Old statementBalance: ${cycle.statementBalance} -> New: ${correctStatementBalance}`);
          console.log(`    Transactions in cycle: ${cycleTransactions.length}`);
          
          // Update the billing cycle
          await prisma.billingCycle.update({
            where: { id: cycle.id },
            data: {
              totalSpend: correctSpend,
              statementBalance: correctStatementBalance
            }
          });

          cardRepair.repairs.push({
            cycleId: cycle.id,
            cycleStart: cycleStart.toDateString(),
            cycleEnd: cycleEnd.toDateString(),
            oldTotalSpend: cycle.totalSpend,
            newTotalSpend: correctSpend,
            oldStatementBalance: cycle.statementBalance,
            newStatementBalance: correctStatementBalance,
            transactionCount: cycleTransactions.length
          });
        }
      }

      repairResults.push(cardRepair);
    }

    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('🎉 DATA REPAIR COMPLETED');
    console.log('=' .repeat(60));
    
    let totalRepairs = 0;
    for (const cardResult of repairResults) {
      if (cardResult.repairs.length > 0) {
        console.log(`${cardResult.cardName}: ${cardResult.repairs.length} cycles repaired`);
        totalRepairs += cardResult.repairs.length;
      }
    }
    
    console.log(`\nTotal billing cycles repaired: ${totalRepairs}`);
    console.log('✅ All repairs completed successfully\n');
    
  } catch (error) {
    console.error('❌ ERROR during data repair:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the repair
runDataRepair().catch(error => {
  console.error('💥 Data repair failed:', error.message);
  process.exit(1);
});