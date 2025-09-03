const { PrismaClient } = require('@prisma/client');

async function debugDatabase() {
  const prisma = new PrismaClient();
  
  try {
    console.log('=== DATABASE ANALYSIS ===');
    
    // 1. Check all credit cards and their limits
    console.log('\n1. CHECKING ALL CREDIT CARDS:');
    const allCards = await prisma.creditCard.findMany({
      include: {
        plaidItem: {
          select: {
            institutionName: true,
            itemId: true,
            status: true,
            lastSyncAt: true
          }
        }
      }
    });
    
    console.log(`Total cards in database: ${allCards.length}`);
    
    allCards.forEach((card, index) => {
      console.log(`\nCard ${index + 1}: ${card.name}`);
      console.log(`  balanceLimit: ${card.balanceLimit} (${typeof card.balanceLimit})`);
      console.log(`  balanceCurrent: ${card.balanceCurrent}`);
      console.log(`  balanceAvailable: ${card.balanceAvailable}`);
      console.log(`  Institution: ${card.plaidItem?.institutionName}`);
      console.log(`  Last sync: ${card.plaidItem?.lastSyncAt}`);
      console.log(`  Status: ${card.plaidItem?.status}`);
      console.log(`  Account ID: ${card.accountId}`);
      console.log(`  Mask: ${card.mask}`);
    });
    
    // 2. Focus on Capital One cards
    console.log('\n2. CAPITAL ONE SPECIFIC ANALYSIS:');
    const capitalOneCards = allCards.filter(card => 
      card.name?.toLowerCase().includes('capital one') ||
      card.name?.toLowerCase().includes('quicksilver') ||
      card.name?.toLowerCase().includes('venture') ||
      card.name?.toLowerCase().includes('savor') ||
      card.plaidItem?.institutionName?.toLowerCase().includes('capital one')
    );
    
    console.log(`Capital One cards found: ${capitalOneCards.length}`);
    
    capitalOneCards.forEach(card => {
      console.log(`\nCapital One Card: ${card.name}`);
      console.log(`  Limit: ${card.balanceLimit} (${card.balanceLimit === null ? 'NULL' : typeof card.balanceLimit})`);
      console.log(`  Current: ${card.balanceCurrent}`);
      console.log(`  Available: ${card.balanceAvailable}`);
      console.log(`  Institution: ${card.plaidItem?.institutionName}`);
      
      // Calculate if we can infer limit
      if (card.balanceAvailable && card.balanceCurrent) {
        const inferredLimit = Math.abs(card.balanceCurrent) + card.balanceAvailable;
        console.log(`  Inferred Limit (current + available): ${inferredLimit}`);
      }
    });
    
    // 3. Check for any limits that exist
    console.log('\n3. CARDS WITH EXISTING LIMITS:');
    const cardsWithLimits = allCards.filter(card => 
      card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit)
    );
    
    console.log(`Cards with valid limits: ${cardsWithLimits.length}/${allCards.length}`);
    cardsWithLimits.forEach(card => {
      console.log(`  ${card.name}: $${card.balanceLimit} (${card.plaidItem?.institutionName})`);
    });
    
    // 4. Check Plaid items status
    console.log('\n4. PLAID CONNECTION STATUS:');
    const plaidItems = await prisma.plaidItem.findMany();
    
    plaidItems.forEach(item => {
      console.log(`\nPlaid Item: ${item.institutionName}`);
      console.log(`  Status: ${item.status}`);
      console.log(`  Last sync: ${item.lastSyncAt}`);
      console.log(`  Error: ${item.errorMessage || 'None'}`);
      console.log(`  Item ID: ${item.itemId}`);
    });
    
  } catch (error) {
    console.error('Database query error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugDatabase();