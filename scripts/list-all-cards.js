#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function listAllCards(email) {
  try {
    console.log(`\n📋 LISTING ALL CARDS FOR: ${email}`);
    console.log('=' .repeat(60));
    
    const cards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          user: {
            email: email
          }
        }
      },
      include: {
        plaidItem: true,
        billingCycles: {
          orderBy: {
            endDate: 'desc'
          },
          take: 3 // Show latest 3 cycles per card
        }
      }
    });

    console.log(`Found ${cards.length} credit cards:`);
    
    cards.forEach((card, index) => {
      console.log(`\n${index + 1}. CARD: ${card.name}`);
      console.log(`   Official Name: ${card.officialName || 'N/A'}`);
      console.log(`   Mask: •••• ${card.mask}`);
      console.log(`   Institution: ${card.plaidItem?.institutionName}`);
      console.log(`   Connection Status: ${card.plaidItem?.status}`);
      console.log(`   Last Sync: ${card.plaidItem?.lastSyncAt ? new Date(card.plaidItem.lastSyncAt).toLocaleString() : 'Never'}`);
      console.log(`   Error: ${card.plaidItem?.errorMessage || 'None'}`);
      console.log(`   Open Date: ${card.openDate ? card.openDate.toDateString() : 'Not set'}`);
      console.log(`   Statement Date: ${card.lastStatementIssueDate ? card.lastStatementIssueDate.toDateString() : 'Not set'}`);
      console.log(`   Due Date: ${card.nextPaymentDueDate ? card.nextPaymentDueDate.toDateString() : 'Not set'}`);
      console.log(`   Current Balance: $${card.balanceCurrent || 0}`);
      console.log(`   Statement Balance: $${card.lastStatementBalance || 0}`);
      console.log(`   Billing Cycles: ${card.billingCycles.length} total`);
      
      if (card.billingCycles.length > 0) {
        console.log(`   Latest Cycles:`);
        card.billingCycles.forEach((cycle, cycleIndex) => {
          console.log(`     ${cycleIndex + 1}. ${cycle.startDate.toDateString()} - ${cycle.endDate.toDateString()} | Statement: $${cycle.statementBalance || 'N/A'} | Due: ${cycle.dueDate ? cycle.dueDate.toDateString() : 'N/A'}`);
        });
      } else {
        console.log(`   ⚠️  No billing cycles found`);
      }
    });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
listAllCards(email).then(() => {
  console.log('\n✨ Card listing complete\n');
}).catch(error => {
  console.error('\n💥 Card listing failed:', error.message);
  process.exit(1);
});