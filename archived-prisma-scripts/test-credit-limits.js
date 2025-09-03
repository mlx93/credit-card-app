#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function testCreditLimits(email) {
  try {
    console.log(`\n💳 TESTING CREDIT LIMIT PERSISTENCE FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Get all credit cards for the user
    const cards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          user: {
            email: email
          }
        }
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true
          }
        }
      }
    });

    console.log(`Found ${cards.length} credit cards:`);
    
    cards.forEach((card, index) => {
      console.log(`\n${index + 1}. ${card.name} (${card.plaidItem?.institutionName})`);
      console.log(`   ID: ${card.id}`);
      console.log(`   Mask: •••• ${card.mask}`);
      console.log(`   Current Balance: $${card.balanceCurrent || 0}`);
      console.log(`   Credit Limit: ${card.balanceLimit ? `$${card.balanceLimit.toLocaleString()}` : 'Not set'}`);
      
      if (card.balanceLimit) {
        const utilization = ((Math.abs(card.balanceCurrent || 0) / card.balanceLimit) * 100).toFixed(1);
        console.log(`   Utilization: ${utilization}%`);
      }
    });

    // Test the API endpoint for updating limits
    console.log('\n🧪 TESTING API FUNCTIONALITY:');
    
    const testCard = cards.find(card => card.name.includes('Capital One') || card.name.includes('Quicksilver'));
    
    if (testCard) {
      console.log(`\nTesting with ${testCard.name}:`);
      console.log(`Current limit: ${testCard.balanceLimit ? `$${testCard.balanceLimit}` : 'Not set'}`);
      
      // Test setting a limit (we'll simulate the API call logic)
      const testLimit = 5000;
      console.log(`\nSimulating setting limit to $${testLimit}...`);
      
      const updatedCard = await prisma.creditCard.update({
        where: { id: testCard.id },
        data: { balanceLimit: testLimit }
      });
      
      console.log(`✅ Updated successfully! New limit: $${updatedCard.balanceLimit}`);
      
      // Verify persistence by re-querying
      const verifyCard = await prisma.creditCard.findUnique({
        where: { id: testCard.id }
      });
      
      console.log(`✅ Verification query: $${verifyCard?.balanceLimit} (persisted correctly: ${verifyCard?.balanceLimit === testLimit ? 'YES' : 'NO'})`);
      
      // Test removing the limit (set to null)
      console.log(`\nTesting limit removal...`);
      
      const clearedCard = await prisma.creditCard.update({
        where: { id: testCard.id },
        data: { balanceLimit: null }
      });
      
      console.log(`✅ Limit removed! Current limit: ${clearedCard.balanceLimit || 'Not set'}`);
      
    } else {
      console.log('No suitable test card found (looking for Capital One)');
    }

    console.log('\n📋 FINAL STATE:');
    const finalCards = await prisma.creditCard.findMany({
      where: {
        plaidItem: {
          user: {
            email: email
          }
        }
      }
    });

    finalCards.forEach((card, index) => {
      console.log(`${index + 1}. ${card.name}: ${card.balanceLimit ? `$${card.balanceLimit.toLocaleString()}` : 'No limit set'}`);
    });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
testCreditLimits(email).then(() => {
  console.log('\n✨ Credit limit test complete\n');
}).catch(error => {
  console.error('\n💥 Credit limit test failed:', error.message);
  process.exit(1);
});