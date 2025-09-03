#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function regenerateBillingCycles(email) {
  try {
    console.log(`\n🔄 REGENERATING BILLING CYCLES FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Get user's credit cards
    const creditCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          user: {
            email: email
          }
        }
      },
      include: {
        plaidItem: {
          include: {
            user: true
          }
        },
        transactions: {
          orderBy: { date: 'asc' }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards for ${email}`);

    for (const card of creditCards) {
      console.log(`\n=== REGENERATING CYCLES FOR ${card.name} ===`);
      
      if (!card.lastStatementIssueDate) {
        console.log('⚠️ No statement date - skipping regeneration');
        continue;
      }

      const cycles = [];
      const lastStatementDate = new Date(card.lastStatementIssueDate);
      const nextDueDate = card.nextPaymentDueDate ? new Date(card.nextPaymentDueDate) : null;
      const cycleLength = 30; // Use fixed 30-day cycles
      const today = new Date();

      console.log(`Last statement date: ${lastStatementDate.toDateString()}`);
      console.log(`Next due date: ${nextDueDate?.toDateString() || 'N/A'}`);
      console.log(`Using cycle length: ${cycleLength} days`);

      // Create the closed cycle that ends on the statement date
      const closedCycleEnd = new Date(lastStatementDate);
      const closedCycleStart = new Date(closedCycleEnd);
      closedCycleStart.setDate(closedCycleStart.getDate() - cycleLength + 1);

      console.log(`Creating closed cycle: ${closedCycleStart.toDateString()} - ${closedCycleEnd.toDateString()}`);
      
      const closedCycle = await prisma.billingCycle.create({
        data: {
          creditCardId: card.id,
          startDate: closedCycleStart,
          endDate: closedCycleEnd,
          dueDate: nextDueDate,
          statementBalance: card.lastStatementBalance,
          minimumPayment: card.minimumPaymentAmount,
          totalSpend: Math.abs(card.lastStatementBalance || 0)
        }
      });
      cycles.push(closedCycle);

      // Create the current cycle
      const currentCycleStart = new Date(lastStatementDate);
      currentCycleStart.setDate(currentCycleStart.getDate() + 1);
      const currentCycleEnd = new Date(currentCycleStart);
      currentCycleEnd.setDate(currentCycleEnd.getDate() + cycleLength - 1);
      const currentDueDate = new Date(currentCycleEnd);
      currentDueDate.setDate(currentDueDate.getDate() + 21);

      // Calculate current cycle spend
      const currentBalance = Math.abs(card.balanceCurrent || 0);
      const statementBalance = Math.abs(card.lastStatementBalance || 0);
      const currentSpend = Math.max(0, currentBalance - statementBalance);

      console.log(`Creating current cycle: ${currentCycleStart.toDateString()} - ${currentCycleEnd.toDateString()}`);
      console.log(`Current cycle spend: $${currentSpend.toFixed(2)}`);

      const currentCycle = await prisma.billingCycle.create({
        data: {
          creditCardId: card.id,
          startDate: currentCycleStart,
          endDate: currentCycleEnd,
          dueDate: currentDueDate,
          statementBalance: null,
          minimumPayment: null,
          totalSpend: currentSpend
        }
      });
      cycles.push(currentCycle);

      // Create historical cycles going back 12 months
      let historicalCycleEnd = new Date(closedCycleStart);
      historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);

      const oneYearAgo = new Date();
      oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);

      while (historicalCycleEnd >= oneYearAgo) {
        const historicalCycleStart = new Date(historicalCycleEnd);
        historicalCycleStart.setDate(historicalCycleStart.getDate() - cycleLength + 1);

        const historicalDueDate = new Date(historicalCycleEnd);
        historicalDueDate.setDate(historicalDueDate.getDate() + 21);

        // Get transactions for this historical cycle
        const cycleTransactions = card.transactions.filter(t => 
          t.date >= historicalCycleStart && t.date <= historicalCycleEnd
        );
        
        const transactionSpend = cycleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const statementBalance = transactionSpend > 0 ? transactionSpend : 0;

        const historicalCycle = await prisma.billingCycle.create({
          data: {
            creditCardId: card.id,
            startDate: historicalCycleStart,
            endDate: historicalCycleEnd,
            dueDate: historicalDueDate,
            statementBalance: statementBalance > 0 ? statementBalance : null,
            minimumPayment: statementBalance > 0 ? Math.max(25, statementBalance * 0.02) : null,
            totalSpend: transactionSpend
          }
        });
        cycles.push(historicalCycle);

        historicalCycleEnd = new Date(historicalCycleStart);
        historicalCycleEnd.setDate(historicalCycleEnd.getDate() - 1);
      }

      console.log(`✅ Generated ${cycles.length} cycles for ${card.name}`);
      
      // Show cycle lengths to verify they're correct
      const recentCycles = cycles.slice(0, 3);
      console.log('Recent cycles:');
      recentCycles.forEach(c => {
        const cycleLength = Math.abs(
          new Date(c.endDate).getTime() - new Date(c.startDate).getTime()
        ) / (1000 * 60 * 60 * 24) + 1; // +1 because both start and end dates are inclusive
        console.log(`  ${c.startDate.toDateString()} - ${c.endDate.toDateString()} (${Math.round(cycleLength)} days)`);
      });
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
regenerateBillingCycles(email).then(() => {
  console.log('\n✨ Regeneration complete\n');
}).catch(error => {
  console.error('\n💥 Regeneration failed:', error.message);
  process.exit(1);
});