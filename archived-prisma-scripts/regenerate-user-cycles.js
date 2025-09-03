#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function regenerateUserCycles(email) {
  try {
    console.log(`\n🔄 REGENERATING CYCLES FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Find user's credit cards
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
            user: {
              select: {
                email: true,
                name: true
              }
            }
          }
        }
      }
    });

    console.log(`Found ${creditCards.length} credit cards for ${email}`);

    for (const card of creditCards) {
      console.log(`\n=== PROCESSING ${card.name} ===`);
      
      // Delete existing billing cycles to force regeneration
      console.log('Deleting existing cycles...');
      const deleteResult = await prisma.billingCycle.deleteMany({
        where: { creditCardId: card.id }
      });
      console.log(`Deleted ${deleteResult.count} existing cycles`);
      
      console.log(`Cycles deleted for ${card.name}. Run the regenerate-cycles API to recreate them with fixed logic.`);
    }
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
regenerateUserCycles(email).then(() => {
  console.log('\n✨ Regeneration complete\n');
}).catch(error => {
  console.error('\n💥 Regeneration failed:', error.message);
  process.exit(1);
});