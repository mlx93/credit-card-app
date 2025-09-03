#!/usr/bin/env node

/**
 * Capital One Timestamp Requirements Test
 * 
 * Test different API calls with proper timestamp parameters for Capital One
 */

require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');
const { PlaidApi, Configuration, PlaidEnvironments } = require('plaid');
const CryptoJS = require('crypto-js');

function decrypt(encryptedText) {
  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedText, process.env.ENCRYPTION_KEY);
    const originalText = decrypted.toString(CryptoJS.enc.Utf8);
    if (!originalText) {
      throw new Error('Failed to decrypt - invalid data or key');
    }
    return originalText;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

async function testCapitalOneTimestamps() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } }
  });

  const plaidConfig = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });
  const plaidClient = new PlaidApi(plaidConfig);

  try {
    await prisma.$connect();
    console.log('🔍 Testing Capital One API calls with timestamp requirements\n');

    const capitalOneCards = await prisma.creditCard.findMany({
      where: {
        OR: [
          { name: { contains: 'Capital One', mode: 'insensitive' } },
          { name: { contains: 'Venture', mode: 'insensitive' } },
          { name: { contains: 'Quicksilver', mode: 'insensitive' } }
        ]
      },
      include: {
        plaidItem: { select: { institutionName: true, accessToken: true } }
      }
    });

    for (const card of capitalOneCards) {
      console.log(`=== TESTING ${card.name} ===`);
      const accessToken = decrypt(card.plaidItem.accessToken);

      // Test 1: Balance with different timestamp parameters
      console.log('📊 Testing accountsBalanceGet with timestamp variations:');
      
      const timestamps = [
        { desc: 'No timestamp (our current approach)', options: {} },
        { desc: '30 days ago', options: { min_last_updated_datetime: new Date(Date.now() - 30*24*60*60*1000).toISOString() } },
        { desc: '7 days ago', options: { min_last_updated_datetime: new Date(Date.now() - 7*24*60*60*1000).toISOString() } },
        { desc: '1 day ago', options: { min_last_updated_datetime: new Date(Date.now() - 24*60*60*1000).toISOString() } }
      ];

      for (const { desc, options } of timestamps) {
        try {
          console.log(`   🔸 ${desc}`);
          const response = await plaidClient.accountsBalanceGet({
            access_token: accessToken,
            options: options
          });
          console.log(`   ✅ SUCCESS: ${response.data.accounts.length} accounts returned`);
          
          const ourAccount = response.data.accounts.find(acc => acc.account_id === card.accountId);
          if (ourAccount) {
            console.log(`   💰 Balance data: limit=${ourAccount.balances.limit}, available=${ourAccount.balances.available}, current=${ourAccount.balances.current}`);
          }
        } catch (error) {
          console.log(`   ❌ FAILED: ${error.response?.data?.error_code || error.message}`);
        }
      }

      // Test 2: Check if we need to request 'accounts' product
      console.log('\n📊 Testing if our Link Token needs "accounts" product:');
      console.log('   Current products: [\'liabilities\', \'transactions\']');
      console.log('   Suggestion: Try adding \'accounts\' product to link token creation');

      // Test 3: Look for any other fields that might contain limits
      console.log('\n📊 Deep inspection of all available fields:');
      try {
        const liabResponse = await plaidClient.liabilitiesGet({ access_token: accessToken });
        const account = liabResponse.data.accounts[0];
        const liability = liabResponse.data.liabilities?.credit?.[0];
        
        console.log('   🔍 All account balance fields:');
        Object.keys(account.balances).forEach(key => {
          console.log(`     ${key}: ${account.balances[key]} (${typeof account.balances[key]})`);
        });
        
        if (liability) {
          console.log('   🔍 All liability fields:');
          Object.keys(liability).forEach(key => {
            console.log(`     ${key}: ${JSON.stringify(liability[key])} (${typeof liability[key]})`);
          });
        }
      } catch (error) {
        console.log(`   ❌ Deep inspection failed: ${error.message}`);
      }

      console.log('\n' + '='.repeat(50) + '\n');
    }

    console.log('📋 RECOMMENDATIONS:');
    console.log('1. Add "accounts" product to Link Token creation');
    console.log('2. Use timestamp parameters for Balance API calls');
    console.log('3. Check if Capital One requires re-consent for credit limit access');
    console.log('4. Consider if CoPilot uses different Plaid application/credentials');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  testCapitalOneTimestamps();
}