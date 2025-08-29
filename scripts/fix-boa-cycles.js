#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function fixBOACycles(email) {
  try {
    console.log(`\n🏦 FIXING CUSTOMIZED CASH REWARDS CYCLES FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Find the Customized Cash Rewards card
    const card = await prisma.creditCard.findFirst({
      where: {
        name: 'Customized Cash Rewards Visa Signature',
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

    if (!card) {
      console.log('❌ Customized Cash Rewards card not found');
      return;
    }

    console.log('Found card:', card.name);
    console.log('Current open date:', card.openDate ? card.openDate.toDateString() : 'Not set');

    // Set open date to late June 2025 if not set
    if (!card.openDate) {
      console.log('Setting open date to June 28, 2025...');
      await prisma.creditCard.update({
        where: { id: card.id },
        data: { openDate: new Date('2025-06-28') }
      });
      console.log('✅ Open date updated');
    }

    // Delete existing cycles
    console.log('Deleting existing billing cycles...');
    const deleteResult = await prisma.billingCycle.deleteMany({
      where: { creditCardId: card.id }
    });
    console.log(`Deleted ${deleteResult.count} cycles`);

    console.log('\n✅ Cycles cleared. Fresh cycles will be generated on next page refresh.');

    // Show what the correct cycles should be based on statement date
    console.log('\nExpected cycles based on statement date Aug 5, 2025:');
    console.log('1. CLOSED CYCLE (should be DUE): Jul 7, 2025 - Aug 5, 2025 | Statement: $1462.84');
    console.log('2. CURRENT CYCLE: Aug 6, 2025 - Sep 4, 2025 | Current spending: ~$155');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
fixBOACycles(email).then(() => {
  console.log('\n✨ BOA cycles fix complete\n');
}).catch(error => {
  console.error('\n💥 BOA cycles fix failed:', error.message);
  process.exit(1);
});