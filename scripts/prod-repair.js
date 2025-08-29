#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function repairData(email) {
  try {
    console.log(`\n🔧 PRODUCTION DATA REPAIR${email ? ` FOR: ${email}` : ''}`);
    console.log('=' .repeat(60));
    
    // Build query
    const whereClause = email ? {
      plaidItem: {
        user: {
          email: email
        }
      }
    } : {};
    
    // Get all credit cards with related data
    const creditCards = await prisma.creditCard.findMany({
      where: whereClause,
      include: {
        plaidItem: {
          include: {
            user: {
              select: {
                email: true,
                name: true
              }
            }
          }
        },
        transactions: {
          orderBy: { date: 'desc' }
        },
        billingCycles: {
          orderBy: { endDate: 'desc' }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards to repair`);

    const repairResults = [];

    for (const card of creditCards) {
      console.log(`\n=== REPAIRING ${card.name} (${card.plaidItem.user.email}) ===`);
      
      const cardRepair = {
        cardName: card.name,
        cardId: card.id,
        userEmail: card.plaidItem.user.email,
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
        
        const transactionBasedSpend = cycleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        
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
          console.log(`    Old totalSpend: $${(cycle.totalSpend || 0).toFixed(2)}`);
          console.log(`    New totalSpend: $${correctSpend.toFixed(2)}`);
          if (needsStatementUpdate) {
            console.log(`    Old statementBalance: $${(cycle.statementBalance || 0).toFixed(2)}`);
            console.log(`    New statementBalance: $${(correctStatementBalance || 0).toFixed(2)}`);
          }
          
          try {
            const updatedCycle = await prisma.billingCycle.update({
              where: { id: cycle.id },
              data: {
                totalSpend: correctSpend,
                statementBalance: correctStatementBalance,
                minimumPayment: correctStatementBalance && correctStatementBalance > 0 
                  ? Math.max(25, correctStatementBalance * 0.02) 
                  : null
              }
            });
            
            cardRepair.repairs.push({
              cycleId: cycle.id,
              period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
              type: isCurrentCycle ? 'CURRENT_CYCLE' : 'HISTORICAL_CYCLE',
              changes: {
                totalSpend: { from: cycle.totalSpend, to: correctSpend },
                statementBalance: { from: cycle.statementBalance, to: correctStatementBalance }
              },
              success: true
            });
            
            console.log(`    ✅ Updated successfully`);
          } catch (error) {
            console.error(`    ❌ Failed to update: ${error.message}`);
            cardRepair.repairs.push({
              cycleId: cycle.id,
              period: `${cycleStart.toDateString()} - ${cycleEnd.toDateString()}`,
              success: false,
              error: error.message
            });
          }
        }
      }
      
      console.log(`  Completed repairs for ${card.name}: ${cardRepair.repairs.length} cycles updated`);
      repairResults.push(cardRepair);
    }
    
    // Summary statistics
    const summary = {
      totalCards: repairResults.length,
      totalRepairs: repairResults.reduce((sum, r) => sum + r.repairs.length, 0),
      successfulRepairs: repairResults.reduce((sum, r) => 
        sum + r.repairs.filter(repair => repair.success).length, 0),
      failedRepairs: repairResults.reduce((sum, r) => 
        sum + r.repairs.filter(repair => !repair.success).length, 0)
    };

    console.log('\n📊 REPAIR SUMMARY:');
    console.log(`   Total Cards Processed: ${summary.totalCards}`);
    console.log(`   Total Repairs Attempted: ${summary.totalRepairs}`);
    console.log(`   Successful Repairs: ${summary.successfulRepairs}`);
    console.log(`   Failed Repairs: ${summary.failedRepairs}`);
    
    return repairResults;
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run repair for specific user or all users
const email = process.argv[2];
repairData(email).then(() => {
  console.log('\n✨ Repair complete\n');
}).catch(error => {
  console.error('\n💥 Repair failed:', error.message);
  process.exit(1);
});