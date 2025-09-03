#!/usr/bin/env node

const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Parse the DATABASE_URL to get connection parameters
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL not found in .env.local');
  process.exit(1);
}

const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function listUsers() {
  try {
    console.log('Connecting to CardCycle database...\n');
    await client.connect();

    // Query all users
    const usersQuery = `
      SELECT 
        u.id,
        u.email,
        u.name,
        u."createdAt",
        u."updatedAt",
        u."emailVerified"
      FROM users u
      ORDER BY u."createdAt" DESC
    `;

    const usersResult = await client.query(usersQuery);
    const users = usersResult.rows;

    // Query OAuth accounts
    const accountsQuery = `
      SELECT 
        a."userId",
        a.provider,
        a.type
      FROM accounts a
    `;
    
    const accountsResult = await client.query(accountsQuery);
    const accounts = accountsResult.rows;

    // Query Plaid items
    const plaidQuery = `
      SELECT 
        p."userId",
        p."institutionName",
        p.status,
        p."createdAt"
      FROM plaid_items p
    `;
    
    const plaidResult = await client.query(plaidQuery);
    const plaidItems = plaidResult.rows;

    // Query credit cards count per user
    const cardsQuery = `
      SELECT 
        p."userId",
        COUNT(c.id) as card_count
      FROM plaid_items p
      LEFT JOIN credit_cards c ON c."plaidItemId" = p.id
      GROUP BY p."userId"
    `;
    
    const cardsResult = await client.query(cardsQuery);
    const userCardCounts = cardsResult.rows;

    console.log('='.repeat(100));
    console.log('CARDCYCLE.APP USER LIST');
    console.log('='.repeat(100));
    console.log();

    // Process and display users
    users.forEach((user, index) => {
      const userAccounts = accounts.filter(acc => acc.userId === user.id);
      const userPlaidItems = plaidItems.filter(item => item.userId === user.id);
      const authType = userAccounts.length > 0 ? 'Google OAuth' : 'Email Code';
      const cardInfo = userCardCounts.find(c => c.userId === user.id);
      const cardCount = cardInfo ? parseInt(cardInfo.card_count) : 0;

      console.log(`${index + 1}. ${user.email}`);
      console.log(`   Name: ${user.name || 'Not provided'}`);
      console.log(`   Auth Type: ${authType}`);
      console.log(`   Email Verified: ${user.emailVerified ? 'Yes' : 'No'}`);
      console.log(`   Connected Banks: ${userPlaidItems.length}`);
      
      if (userPlaidItems.length > 0) {
        const bankNames = userPlaidItems
          .map(item => item.institutionName)
          .filter(Boolean);
        if (bankNames.length > 0) {
          console.log(`   Banks: ${bankNames.join(', ')}`);
        }
      }
      
      console.log(`   Credit Cards: ${cardCount}`);
      console.log(`   Joined: ${new Date(user.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}`);
      console.log();
    });

    // Summary statistics
    console.log('='.repeat(100));
    console.log('SUMMARY STATISTICS');
    console.log('='.repeat(100));
    console.log(`Total Users: ${users.length}`);
    
    const oauthUsers = users.filter(user => 
      accounts.some(acc => acc.userId === user.id)
    );
    const emailUsers = users.filter(user => 
      !accounts.some(acc => acc.userId === user.id)
    );
    const usersWithBanks = users.filter(user =>
      plaidItems.some(item => item.userId === user.id)
    );

    console.log(`Google OAuth Users: ${oauthUsers.length}`);
    console.log(`Email Code Users: ${emailUsers.length}`);
    console.log(`Users with Bank Connections: ${usersWithBanks.length}`);
    console.log(`Total Bank Connections: ${plaidItems.length}`);
    
    const totalCards = userCardCounts.reduce((sum, row) => 
      sum + parseInt(row.card_count), 0
    );
    console.log(`Total Credit Cards: ${totalCards}`);

    // Bank distribution
    if (plaidItems.length > 0) {
      const bankCounts = {};
      plaidItems.forEach(item => {
        const bank = item.institutionName || 'Unknown';
        bankCounts[bank] = (bankCounts[bank] || 0) + 1;
      });

      console.log('\nBank Connection Distribution:');
      Object.entries(bankCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([bank, count]) => {
          console.log(`  ${bank}: ${count}`);
        });
    }

  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('authentication')) {
      console.log('\nCheck your DATABASE_URL in .env.local');
    }
  } finally {
    await client.end();
  }
}

listUsers();