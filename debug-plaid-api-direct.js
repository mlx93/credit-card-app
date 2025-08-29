#!/usr/bin/env node

/**
 * Direct Plaid API Test Script for Capital One
 * 
 * This script uses production access tokens to test Plaid API calls directly
 * and analyze what data Capital One is actually returning.
 */

require('dotenv').config({ path: '.env.production' });
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const { PlaidApi, Configuration, PlaidEnvironments } = require('plaid');
const CryptoJS = require('crypto-js');

// Import encryption functions (matching the actual implementation)
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

async function testPlaidAPIDirectly() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });

  // Initialize Plaid client
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
    console.log('🔍 Connecting to production database...');
    await prisma.$connect();
    console.log('✅ Connected successfully\n');

    console.log('🔍 Initializing Plaid client...');
    console.log(`   Environment: ${process.env.PLAID_ENV}`);
    console.log(`   Client ID: ${process.env.PLAID_CLIENT_ID?.substring(0, 8)}...`);
    console.log('✅ Plaid client initialized\n');

    // Get Capital One cards with their access tokens
    const capitalOneCards = await prisma.creditCard.findMany({
      where: {
        OR: [
          { name: { contains: 'Capital One', mode: 'insensitive' } },
          { name: { contains: 'Quicksilver', mode: 'insensitive' } },
          { name: { contains: 'Venture', mode: 'insensitive' } },
          { plaidItem: { institutionName: { contains: 'Capital One', mode: 'insensitive' } } }
        ]
      },
      include: {
        plaidItem: {
          select: {
            institutionName: true,
            accessToken: true,
            itemId: true
          }
        }
      }
    });

    console.log(`🎯 Found ${capitalOneCards.length} Capital One cards for API testing\n`);

    for (const [index, card] of capitalOneCards.entries()) {
      console.log(`=== TESTING CARD ${index + 1}: ${card.name} ===`);
      console.log(`Account ID: ${card.accountId}`);
      console.log(`Institution: ${card.plaidItem?.institutionName}\n`);

      try {
        // Decrypt access token
        const accessToken = decrypt(card.plaidItem.accessToken);
        console.log(`✅ Access token decrypted successfully\n`);

        // Test 1: Liabilities Get
        console.log('📊 TEST 1: Liabilities Get');
        try {
          const liabilitiesResponse = await plaidClient.liabilitiesGet({
            access_token: accessToken
          });
          
          console.log('✅ liabilitiesGet SUCCESS');
          console.log(`   Total accounts: ${liabilitiesResponse.data.accounts.length}`);
          console.log(`   Credit liabilities: ${liabilitiesResponse.data.liabilities?.credit?.length || 0}`);
          
          // Find our specific account
          const ourAccount = liabilitiesResponse.data.accounts.find(acc => acc.account_id === card.accountId);
          const ourLiability = liabilitiesResponse.data.liabilities?.credit?.find(liability => liability.account_id === card.accountId);
          
          if (ourAccount) {
            console.log('   📄 Our Account Data:');
            console.log('     ', JSON.stringify(ourAccount, null, 6));
          }
          
          if (ourLiability) {
            console.log('   💳 Our Liability Data:');
            console.log('     ', JSON.stringify(ourLiability, null, 6));
            
            // Check for limit fields
            const limitFields = ['limit', 'limit_current', 'limit_amount'];
            console.log('   🔍 Limit Field Analysis:');
            limitFields.forEach(field => {
              if (ourLiability[field] !== undefined) {
                console.log(`     ${field}: ${ourLiability[field]} (${typeof ourLiability[field]})`);
              } else {
                console.log(`     ${field}: undefined`);
              }
            });
            
            // Check APR data for balance_subject_to_apr
            if (ourLiability.aprs && ourLiability.aprs.length > 0) {
              console.log('   📈 APR Data Analysis:');
              ourLiability.aprs.forEach((apr, i) => {
                console.log(`     APR ${i + 1}:`);
                console.log(`       Type: ${apr.apr_type}`);
                console.log(`       Percentage: ${apr.apr_percentage}`);
                console.log(`       Balance Subject to APR: ${apr.balance_subject_to_apr} (${typeof apr.balance_subject_to_apr})`);
              });
            }
          } else {
            console.log('   ❌ No liability data found for this account');
          }
        } catch (error) {
          console.log('❌ liabilitiesGet FAILED');
          console.log(`   Error: ${error.message}`);
          console.log(`   Code: ${error.response?.data?.error_code}`);
          console.log(`   Type: ${error.response?.data?.error_type}`);
        }

        console.log('');

        // Test 2: Accounts Balance Get
        console.log('📊 TEST 2: Accounts Balance Get');
        try {
          const balanceResponse = await plaidClient.accountsBalanceGet({
            access_token: accessToken
          });
          
          console.log('✅ accountsBalanceGet SUCCESS');
          console.log(`   Total accounts: ${balanceResponse.data.accounts.length}`);
          
          const ourBalanceAccount = balanceResponse.data.accounts.find(acc => acc.account_id === card.accountId);
          if (ourBalanceAccount) {
            console.log('   💰 Our Balance Data:');
            console.log('     ', JSON.stringify(ourBalanceAccount, null, 6));
            
            // Specific balance field analysis
            const balanceFields = ['limit', 'available', 'current'];
            console.log('   🔍 Balance Field Analysis:');
            balanceFields.forEach(field => {
              if (ourBalanceAccount.balances[field] !== undefined) {
                console.log(`     balances.${field}: ${ourBalanceAccount.balances[field]} (${typeof ourBalanceAccount.balances[field]})`);
              } else {
                console.log(`     balances.${field}: undefined`);
              }
            });
          } else {
            console.log('   ❌ No balance data found for this account');
          }
        } catch (error) {
          console.log('❌ accountsBalanceGet FAILED');
          console.log(`   Error: ${error.message}`);
          console.log(`   Code: ${error.response?.data?.error_code}`);
          console.log(`   Type: ${error.response?.data?.error_type}`);
        }

        console.log('');

        // Test 3: Accounts Get
        console.log('📊 TEST 3: Accounts Get');
        try {
          const accountsResponse = await plaidClient.accountsGet({
            access_token: accessToken
          });
          
          console.log('✅ accountsGet SUCCESS');
          console.log(`   Total accounts: ${accountsResponse.data.accounts.length}`);
          
          const ourStandardAccount = accountsResponse.data.accounts.find(acc => acc.account_id === card.accountId);
          if (ourStandardAccount) {
            console.log('   🏛️  Our Standard Account Data:');
            console.log('     ', JSON.stringify(ourStandardAccount, null, 6));
          } else {
            console.log('   ❌ No standard account data found for this account');
          }
        } catch (error) {
          console.log('❌ accountsGet FAILED');
          console.log(`   Error: ${error.message}`);
          console.log(`   Code: ${error.response?.data?.error_code}`);
          console.log(`   Type: ${error.response?.data?.error_type}`);
        }

        console.log('');
        console.log('='.repeat(80));
        console.log('');

      } catch (error) {
        console.error(`❌ Failed to test card ${card.name}:`, error.message);
      }
    }

    console.log('📋 PLAID API TEST SUMMARY:');
    console.log(`   • Tested ${capitalOneCards.length} Capital One cards`);
    console.log(`   • Check above for specific API response data`);
    console.log(`   • Look for limit values in liability, balance, and account data`);
    console.log(`   • Pay attention to balance_subject_to_apr in APR data`);

  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await prisma.$disconnect();
    console.log('\n🔚 Database connection closed');
  }
}

// Execute if called directly
if (require.main === module) {
  testPlaidAPIDirectly()
    .then(() => {
      console.log('✅ Plaid API testing completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Failed to complete API testing');
      process.exit(1);
    });
}

module.exports = { testPlaidAPIDirectly };