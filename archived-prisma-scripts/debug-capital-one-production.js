#!/usr/bin/env node

/**
 * Capital One Credit Limit Production Debug Script
 * 
 * This script connects directly to production PostgreSQL database
 * to analyze Capital One credit limit issues.
 * 
 * Usage: 
 *   DATABASE_URL="your_production_db_url" node debug-capital-one-production.js
 * 
 * Or set up your .env.production file with DATABASE_URL and run:
 *   node debug-capital-one-production.js
 */

require('dotenv').config({ path: '.env.production' });
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');

async function debugCapitalOneProduction() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });

  try {
    console.log('🔍 Connecting to production database...');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Please provide it via environment or .env files.');
    }
    
    await prisma.$connect();
    console.log('✅ Connected to production database successfully\n');

    // 1. GET ALL CREDIT CARDS AND ANALYZE LIMITS
    console.log('=== CREDIT CARD LIMIT ANALYSIS ===');
    const allCards = await prisma.creditCard.findMany({
      include: {
        plaidItem: {
          select: {
            institutionName: true,
            itemId: true,
            status: true,
            lastSyncAt: true,
            errorMessage: true,
            accessToken: true
          }
        }
      }
    });

    console.log(`📊 Total credit cards in database: ${allCards.length}\n`);

    // 2. CATEGORIZE CARDS BY INSTITUTION
    const cardsByInstitution = {};
    const capitalOneCards = [];
    
    allCards.forEach(card => {
      const institution = card.plaidItem?.institutionName || 'Unknown';
      if (!cardsByInstitution[institution]) {
        cardsByInstitution[institution] = [];
      }
      cardsByInstitution[institution].push(card);
      
      // Identify Capital One cards
      if (card.name?.toLowerCase().includes('capital one') ||
          card.name?.toLowerCase().includes('quicksilver') ||
          card.name?.toLowerCase().includes('venture') ||
          card.name?.toLowerCase().includes('savor') ||
          institution?.toLowerCase().includes('capital one')) {
        capitalOneCards.push(card);
      }
    });

    console.log('🏦 Cards by Institution:');
    Object.entries(cardsByInstitution).forEach(([institution, cards]) => {
      console.log(`   ${institution}: ${cards.length} cards`);
    });
    console.log();

    // 3. ANALYZE CREDIT LIMITS BY INSTITUTION
    console.log('💳 Credit Limit Analysis by Institution:');
    Object.entries(cardsByInstitution).forEach(([institution, cards]) => {
      const cardsWithLimits = cards.filter(card => 
        card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit)
      );
      const limitRate = cards.length > 0 ? (cardsWithLimits.length / cards.length * 100) : 0;
      
      console.log(`   ${institution}:`);
      console.log(`     ${cardsWithLimits.length}/${cards.length} cards have valid limits (${limitRate.toFixed(1)}%)`);
      
      if (cardsWithLimits.length > 0) {
        const avgLimit = cardsWithLimits.reduce((sum, card) => sum + card.balanceLimit, 0) / cardsWithLimits.length;
        console.log(`     Average limit: $${avgLimit.toFixed(2)}`);
      }
      console.log();
    });

    // 4. CAPITAL ONE DEEP DIVE
    console.log('🔍 CAPITAL ONE DEEP ANALYSIS:');
    console.log(`   Found ${capitalOneCards.length} Capital One cards\n`);
    
    if (capitalOneCards.length === 0) {
      console.log('❌ No Capital One cards found in database!');
      console.log('   This could mean:');
      console.log('   - Users haven\'t connected Capital One accounts');
      console.log('   - Institution detection logic is failing');
      console.log('   - Database doesn\'t have production data\n');
    } else {
      capitalOneCards.forEach((card, index) => {
        console.log(`Capital One Card ${index + 1}: ${card.name}`);
        console.log(`   Account ID: ${card.accountId}`);
        console.log(`   Mask: ${card.mask}`);
        console.log(`   Balance Limit: ${card.balanceLimit} (${typeof card.balanceLimit})`);
        console.log(`   Balance Current: ${card.balanceCurrent}`);
        console.log(`   Balance Available: ${card.balanceAvailable}`);
        console.log(`   Institution: ${card.plaidItem?.institutionName}`);
        console.log(`   Connection Status: ${card.plaidItem?.status}`);
        console.log(`   Last Sync: ${card.plaidItem?.lastSyncAt}`);
        console.log(`   Error: ${card.plaidItem?.errorMessage || 'None'}`);
        
        // Inferred limit calculation
        if (card.balanceAvailable && card.balanceCurrent) {
          const inferredLimit = Math.abs(card.balanceCurrent) + card.balanceAvailable;
          console.log(`   🧮 Inferred Limit (|current| + available): $${inferredLimit}`);
        }
        
        // Limit status analysis
        const hasValidLimit = card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit);
        console.log(`   ✅ Has Valid Limit: ${hasValidLimit ? 'YES' : 'NO'}`);
        console.log('');
      });
    }

    // 5. CONNECTION STATUS ANALYSIS  
    console.log('🔗 PLAID CONNECTION STATUS ANALYSIS:');
    const plaidItems = await prisma.plaidItem.findMany();
    
    const statusCount = {};
    plaidItems.forEach(item => {
      const status = item.status || 'unknown';
      statusCount[status] = (statusCount[status] || 0) + 1;
    });
    
    console.log('   Connection Status Distribution:');
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`     ${status}: ${count} connections`);
    });
    console.log();
    
    // 6. IDENTIFY PROBLEMATIC CONNECTIONS
    const problemConnections = plaidItems.filter(item => 
      item.status === 'error' || item.errorMessage
    );
    
    if (problemConnections.length > 0) {
      console.log('⚠️  PROBLEMATIC CONNECTIONS:');
      problemConnections.forEach(item => {
        console.log(`   ${item.institutionName}:`);
        console.log(`     Status: ${item.status}`);
        console.log(`     Error: ${item.errorMessage || 'Unknown'}`);
        console.log(`     Last Sync: ${item.lastSyncAt || 'Never'}`);
        console.log('');
      });
    }

    // 7. SUMMARY AND RECOMMENDATIONS
    console.log('📋 SUMMARY AND RECOMMENDATIONS:');
    const totalCardsWithLimits = allCards.filter(card => 
      card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit)
    ).length;
    const overallLimitRate = allCards.length > 0 ? (totalCardsWithLimits / allCards.length * 100) : 0;
    
    console.log(`   • ${totalCardsWithLimits}/${allCards.length} total cards have valid credit limits (${overallLimitRate.toFixed(1)}%)`);
    console.log(`   • ${capitalOneCards.length} Capital One cards found`);
    
    const capitalOneWithLimits = capitalOneCards.filter(card => 
      card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit)
    ).length;
    
    if (capitalOneCards.length > 0) {
      const capitalOneLimitRate = capitalOneWithLimits / capitalOneCards.length * 100;
      console.log(`   • ${capitalOneWithLimits}/${capitalOneCards.length} Capital One cards have limits (${capitalOneLimitRate.toFixed(1)}%)`);
      
      if (capitalOneLimitRate < 50) {
        console.log(`   ⚠️  ISSUE IDENTIFIED: Low Capital One limit detection rate!`);
        console.log(`   📝 Next Steps:`);
        console.log(`      1. Test Plaid API calls directly for Capital One`);
        console.log(`      2. Check if syncAccounts is being called during refresh`);
        console.log(`      3. Verify Capital One detection logic in production`);
      }
    }
    
    console.log(`   • ${problemConnections.length} connections have errors`);
    
    return {
      totalCards: allCards.length,
      cardsWithLimits: totalCardsWithLimits,
      capitalOneCards: capitalOneCards.length,
      capitalOneWithLimits,
      problemConnections: problemConnections.length,
      limitRate: overallLimitRate,
      capitalOneLimitRate: capitalOneCards.length > 0 ? (capitalOneWithLimits / capitalOneCards.length * 100) : 0
    };
    
  } catch (error) {
    console.error('\n❌ Error querying production database:');
    console.error(`   ${error.message}`);
    
    if (error.message.includes('Environment variable not found') || error.message.includes('DATABASE_URL')) {
      console.log('\n💡 SETUP INSTRUCTIONS:');
      console.log('   1. Get your production DATABASE_URL from Vercel');  
      console.log('   2. Run: DATABASE_URL="your_production_url" node debug-capital-one-production.js');
      console.log('   3. Or add DATABASE_URL to .env.production file');
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
    console.log('\n🔚 Database connection closed');
  }
}

// Execute if called directly
if (require.main === module) {
  debugCapitalOneProduction()
    .then((results) => {
      console.log('\n✅ Capital One debug analysis completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Failed to complete analysis');
      process.exit(1);
    });
}

module.exports = { debugCapitalOneProduction };