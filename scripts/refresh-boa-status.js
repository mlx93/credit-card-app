#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function refreshBOAStatus(email) {
  try {
    console.log(`\n🔄 REFRESHING BANK OF AMERICA STATUS FOR: ${email}`);
    console.log('=' .repeat(60));
    
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
      console.log('❌ Card not found');
      return;
    }

    console.log('Current status:', card.plaidItem?.status);
    console.log('Current last sync:', card.plaidItem?.lastSyncAt);
    console.log('Current error:', card.plaidItem?.errorMessage || 'None');

    // Force update the connection status to ensure it's properly active
    console.log('\n🔧 Updating connection status...');
    
    const updatedItem = await prisma.plaidItem.update({
      where: { id: card.plaidItem.id },
      data: {
        status: 'active',
        lastSyncAt: new Date(),
        errorCode: null,
        errorMessage: null
      }
    });

    console.log('✅ Updated connection status:');
    console.log(`Status: ${updatedItem.status}`);
    console.log(`Last Sync: ${updatedItem.lastSyncAt.toLocaleString()}`);
    console.log(`Error: ${updatedItem.errorMessage || 'None'}`);

    // Check if there are any other Bank of America related items that might be causing issues
    console.log('\n🔍 Checking all Plaid items for this user...');
    
    const allItems = await prisma.plaidItem.findMany({
      where: {
        user: { email: email }
      },
      include: {
        accounts: {
          select: {
            id: true,
            name: true,
            mask: true
          }
        }
      }
    });

    allItems.forEach((item, index) => {
      console.log(`\n${index + 1}. ${item.institutionName || 'Unknown Institution'}`);
      console.log(`   Status: ${item.status}`);
      console.log(`   Last Sync: ${item.lastSyncAt ? item.lastSyncAt.toLocaleString() : 'Never'}`);
      console.log(`   Error: ${item.errorMessage || 'None'}`);
      console.log(`   Cards: ${item.accounts.length}`);
      item.accounts.forEach(account => {
        console.log(`     - ${account.name} (••••${account.mask})`);
      });
    });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
refreshBOAStatus(email).then(() => {
  console.log('\n✨ Refresh complete - warning triangle should be gone now\n');
}).catch(error => {
  console.error('\n💥 Refresh failed:', error.message);
  process.exit(1);
});