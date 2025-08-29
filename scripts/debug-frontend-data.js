#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function debugFrontendData(email) {
  try {
    console.log(`\n🔍 DEBUGGING FRONTEND DATA FOR: ${email}`);
    console.log('=' .repeat(60));
    
    // Get the exact data that would be sent to frontend
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
          select: {
            id: true,
            itemId: true,
            institutionName: true,
            status: true,
            lastSyncAt: true,
            errorCode: true,
            errorMessage: true
          }
        }
      }
    });

    const boaCard = creditCards.find(card => card.name === 'Customized Cash Rewards Visa Signature');
    
    if (boaCard) {
      console.log('🎯 BANK OF AMERICA CARD DATA (as frontend would receive):');
      console.log('Card Name:', boaCard.name);
      console.log('Card ID:', boaCard.id);
      console.log('Plaid Item:');
      console.log('  - Status:', boaCard.plaidItem?.status);
      console.log('  - Last Sync (raw):', boaCard.plaidItem?.lastSyncAt);
      console.log('  - Last Sync (ISO):', boaCard.plaidItem?.lastSyncAt?.toISOString());
      console.log('  - Error Code:', boaCard.plaidItem?.errorCode);
      console.log('  - Error Message:', boaCard.plaidItem?.errorMessage);
      
      // Simulate frontend staleness calculation
      const lastSyncAt = boaCard.plaidItem?.lastSyncAt;
      if (lastSyncAt) {
        const lastSyncDaysAgo = Math.floor((new Date().getTime() - new Date(lastSyncAt).getTime()) / (1000 * 60 * 60 * 24));
        const connectionStatus = boaCard.plaidItem?.status || 'unknown';
        const hasConnectionIssue = ['error', 'expired', 'disconnected'].includes(connectionStatus);
        const isStale = lastSyncDaysAgo !== null && lastSyncDaysAgo > 14;
        
        console.log('\n📊 FRONTEND LOGIC SIMULATION:');
        console.log('  - Connection Status:', connectionStatus);
        console.log('  - Has Connection Issue:', hasConnectionIssue);
        console.log('  - Last Sync Days Ago:', lastSyncDaysAgo);
        console.log('  - Is Stale (>14 days):', isStale);
        console.log('  - Should Show Warning:', hasConnectionIssue || isStale);
        
        if (hasConnectionIssue) {
          console.log('  - Warning Type: RED (Connection Issue)');
        } else if (isStale) {
          console.log('  - Warning Type: YELLOW (Stale Data)');
        } else {
          console.log('  - Warning Type: NONE');
        }
      }
      
      // Check for any Next.js/API caching headers that might be relevant
      console.log('\n🔄 CACHE DEBUGGING:');
      console.log('Current time:', new Date().toISOString());
      console.log('Database query timestamp:', new Date().toISOString());
      
    } else {
      console.log('❌ Bank of America card not found');
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2] || 'mylesethan93@gmail.com';
debugFrontendData(email).then(() => {
  console.log('\n✨ Frontend debugging complete\n');
}).catch(error => {
  console.error('\n💥 Frontend debugging failed:', error.message);
  process.exit(1);
});