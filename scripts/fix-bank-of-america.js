#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function fixBankOfAmericaData(email) {
  try {
    console.log(`\n🏦 FIXING BANK OF AMERICA DATA FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Step 1: Check current Bank of America connection status
    console.log('Step 1: Checking Bank of America connection status...');
    const boaCard = await prisma.creditCard.findFirst({
      where: {
        name: {
          contains: 'Bank of America'
        },
        plaidItem: {
          user: {
            email: email
          }
        }
      },
      include: {
        plaidItem: true
      }
    });

    if (!boaCard) {
      console.log('❌ No Bank of America card found');
      return;
    }

    console.log('Bank of America Card Details:');
    console.log(`  Name: ${boaCard.name}`);
    console.log(`  Connection Status: ${boaCard.plaidItem?.status}`);
    console.log(`  Last Sync: ${boaCard.plaidItem?.lastSyncAt || 'Never'}`);
    console.log(`  Error: ${boaCard.plaidItem?.errorMessage || 'None'}`);
    console.log(`  Open Date: ${boaCard.openDate ? boaCard.openDate.toDateString() : 'Not set'}`);
    console.log(`  Statement Date: ${boaCard.lastStatementIssueDate ? boaCard.lastStatementIssueDate.toDateString() : 'Not set'}`);
    console.log(`  Due Date: ${boaCard.nextPaymentDueDate ? boaCard.nextPaymentDueDate.toDateString() : 'Not set'}`);
    console.log(`  Current Balance: $${boaCard.balanceCurrent || 0}`);
    console.log(`  Statement Balance: $${boaCard.lastStatementBalance || 0}`);

    // Step 2: Check current billing cycles
    console.log('\nStep 2: Checking current Bank of America billing cycles...');
    const currentCycles = await prisma.billingCycle.findMany({
      where: {
        creditCardId: boaCard.id
      },
      orderBy: {
        endDate: 'desc'
      }
    });

    console.log(`Found ${currentCycles.length} existing cycles:`);
    currentCycles.forEach((cycle, index) => {
      console.log(`  ${index + 1}. ${cycle.startDate.toDateString()} - ${cycle.endDate.toDateString()} | Statement: $${cycle.statementBalance || 'N/A'} | Due: ${cycle.dueDate ? cycle.dueDate.toDateString() : 'N/A'}`);
    });

    // Step 3: Delete existing Bank of America cycles
    console.log('\nStep 3: Deleting existing Bank of America cycles...');
    const deleteResult = await prisma.billingCycle.deleteMany({
      where: {
        creditCardId: boaCard.id
      }
    });
    console.log(`Deleted ${deleteResult.count} cycles`);

    // Step 4: Update connection status if needed
    if (boaCard.plaidItem?.status !== 'active') {
      console.log('\nStep 4: Updating connection status to active...');
      await prisma.plaidItem.update({
        where: { id: boaCard.plaidItem.id },
        data: {
          status: 'active',
          lastSyncAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
      console.log('Connection status updated to active');
    } else {
      console.log('\nStep 4: Connection already active, skipping status update');
    }

    console.log('\n✅ Bank of America data cleanup complete');
    console.log('🔄 New billing cycles will be generated on next page refresh or API call');

    // Step 5: Check what new cycles would be generated
    console.log('\nStep 5: Expected cycle generation based on current data:');
    if (boaCard.lastStatementIssueDate) {
      const statementDate = new Date(boaCard.lastStatementIssueDate);
      const cycleLength = 30; // Assume 30-day cycle
      
      // Closed cycle
      const closedStart = new Date(statementDate);
      closedStart.setDate(closedStart.getDate() - cycleLength + 1);
      console.log(`  CLOSED CYCLE (should be DUE): ${closedStart.toDateString()} - ${statementDate.toDateString()}`);
      
      // Current cycle  
      const currentStart = new Date(statementDate);
      currentStart.setDate(currentStart.getDate() + 1);
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + cycleLength - 1);
      console.log(`  CURRENT CYCLE: ${currentStart.toDateString()} - ${currentEnd.toDateString()}`);
    } else {
      console.log('  ⚠️  No statement date available - cycles may not generate correctly');
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
fixBankOfAmericaData(email).then(() => {
  console.log('\n✨ Bank of America fix complete\n');
}).catch(error => {
  console.error('\n💥 Bank of America fix failed:', error.message);
  process.exit(1);
});