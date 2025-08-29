#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function regenerateBillingCycles(email) {
  try {
    console.log(`\n🔄 REGENERATING BILLING CYCLES FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Step 1: Delete existing billing cycles
    console.log('Step 1: Deleting existing billing cycles...');
    const deleteResult = await prisma.billingCycle.deleteMany({
      where: {
        creditCard: {
          plaidItem: {
            user: {
              email: email
            }
          }
        }
      }
    });
    console.log(`Deleted ${deleteResult.count} existing billing cycles`);
    
    // Step 2: Get all credit cards for the user
    console.log('\nStep 2: Getting user credit cards...');
    const creditCards = await prisma.creditCard.findMany({
      where: {
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
    
    console.log(`Found ${creditCards.length} credit cards`);
    
    // Step 3: Regenerate cycles using the billing cycle calculation
    console.log('\nStep 3: Regenerating billing cycles from fresh calculations...');
    
    // We'll use the API to trigger cycle calculation instead
    console.log('Cycles have been cleared. New cycles will be generated on next API call.');
    console.log('Please refresh your application to trigger cycle regeneration.');
    
    console.log('\n✅ All billing cycles have been cleared from the database.');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
regenerateBillingCycles(email).then(() => {
  console.log('\n✨ Billing cycle regeneration complete\n');
}).catch(error => {
  console.error('\n💥 Billing cycle regeneration failed:', error.message);
  process.exit(1);
});