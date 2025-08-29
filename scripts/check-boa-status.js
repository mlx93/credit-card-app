#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function checkBOAStatus(email) {
  try {
    console.log(`\n🔍 CHECKING CUSTOMIZED CASH REWARDS STATUS FOR: ${email}`);
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
      console.log('❌ Customized Cash Rewards card not found');
      return;
    }

    console.log('📋 CARD DETAILS:');
    console.log(`Name: ${card.name}`);
    console.log(`Mask: •••• ${card.mask}`);
    console.log(`Current Balance: $${card.balanceCurrent || 0}`);
    console.log(`Statement Balance: $${card.lastStatementBalance || 0}`);
    console.log(`Credit Limit: ${card.balanceLimit ? `$${card.balanceLimit.toLocaleString()}` : 'Not set'}`);

    console.log('\n🔗 CONNECTION STATUS:');
    console.log(`Status: ${card.plaidItem?.status}`);
    console.log(`Institution: ${card.plaidItem?.institutionName}`);
    console.log(`Last Sync: ${card.plaidItem?.lastSyncAt ? new Date(card.plaidItem.lastSyncAt).toLocaleString() : 'Never'}`);
    console.log(`Error Code: ${card.plaidItem?.errorCode || 'None'}`);
    console.log(`Error Message: ${card.plaidItem?.errorMessage || 'None'}`);

    // Calculate staleness
    const lastSyncAt = card.plaidItem?.lastSyncAt;
    if (lastSyncAt) {
      const lastSyncDate = new Date(lastSyncAt);
      const now = new Date();
      const daysSinceSync = Math.floor((now.getTime() - lastSyncDate.getTime()) / (1000 * 60 * 60 * 24));
      
      console.log(`\n⏰ STALENESS CHECK:`);
      console.log(`Last Sync Date: ${lastSyncDate.toLocaleString()}`);
      console.log(`Days Since Last Sync: ${daysSinceSync}`);
      console.log(`Is Stale (>14 days): ${daysSinceSync > 14 ? 'YES ⚠️' : 'NO ✅'}`);
      
      // Check connection issues
      const hasConnectionIssue = ['error', 'expired', 'disconnected'].includes(card.plaidItem?.status);
      console.log(`Has Connection Issue: ${hasConnectionIssue ? 'YES ⚠️' : 'NO ✅'}`);
      
      // Determine what warning would show
      console.log(`\n🚨 WARNING ANALYSIS:`);
      if (hasConnectionIssue) {
        console.log(`- Connection Issue Warning: YES (Red WiFi icon)`);
        console.log(`- Reason: Status is '${card.plaidItem?.status}'`);
      } else if (daysSinceSync > 14) {
        console.log(`- Stale Data Warning: YES (Yellow triangle)`);
        console.log(`- Reason: No sync for ${daysSinceSync} days`);
      } else {
        console.log(`- No Warning Expected: Connection healthy and recently synced`);
      }
    } else {
      console.log(`\n⏰ STALENESS CHECK:`);
      console.log(`Last Sync Date: Never`);
      console.log(`Warning: YES (Never synced) ⚠️`);
    }

    // Check if name matching works for debug logs
    console.log(`\n🔍 DEBUG LOG MATCHING:`);
    const includesBoA = card.name.includes('Bank of America');
    const includesCustomized = card.name.includes('Customized Cash Rewards');
    console.log(`Includes 'Bank of America': ${includesBoA}`);
    console.log(`Includes 'Customized Cash Rewards': ${includesCustomized}`);
    console.log(`Would trigger debug logs: ${includesBoA || includesCustomized ? 'YES' : 'NO'}`);

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
checkBOAStatus(email).then(() => {
  console.log('\n✨ Status check complete\n');
}).catch(error => {
  console.error('\n💥 Status check failed:', error.message);
  process.exit(1);
});