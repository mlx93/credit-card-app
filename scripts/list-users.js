#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function listUsers() {
  try {
    console.log('Fetching users from CardCycle.app...\n');
    
    // Get all users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, name, createdAt, updatedAt')
      .order('createdAt', { ascending: false });

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return;
    }

    // Get OAuth accounts for auth type info
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('userId, provider, type');

    if (accountsError) {
      console.error('Note: Could not fetch OAuth accounts:', accountsError.message);
    }

    // Get Plaid connections for each user
    const { data: plaidItems, error: plaidError } = await supabase
      .from('plaid_items')
      .select('userId, institutionName, status');

    if (plaidError) {
      console.error('Note: Could not fetch Plaid connections:', plaidError.message);
    }

    // Process and display users
    console.log('='.repeat(100));
    console.log('CARDCYCLE.APP USER LIST');
    console.log('='.repeat(100));
    console.log();
    
    const userSummary = users?.map(user => {
      const userAccounts = accounts?.filter(acc => acc.userId === user.id) || [];
      const userPlaidItems = plaidItems?.filter(item => item.userId === user.id) || [];
      const authType = userAccounts.length > 0 ? 'Google OAuth' : 'Email Code';
      
      return {
        email: user.email,
        name: user.name || 'No name',
        authType,
        connectedBanks: userPlaidItems.length,
        bankNames: userPlaidItems.map(item => item.institutionName).filter(Boolean),
        createdAt: new Date(user.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    }) || [];

    // Display detailed user list
    userSummary.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email}`);
      console.log(`   Name: ${user.name}`);
      console.log(`   Auth Type: ${user.authType}`);
      console.log(`   Connected Banks: ${user.connectedBanks}`);
      if (user.bankNames.length > 0) {
        console.log(`   Banks: ${user.bankNames.join(', ')}`);
      }
      console.log(`   Joined: ${user.createdAt}`);
      console.log();
    });

    // Summary statistics
    console.log('='.repeat(100));
    console.log('SUMMARY STATISTICS');
    console.log('='.repeat(100));
    console.log(`Total Users: ${users?.length || 0}`);
    console.log(`Google OAuth Users: ${userSummary.filter(u => u.authType === 'Google OAuth').length}`);
    console.log(`Email Code Users: ${userSummary.filter(u => u.authType === 'Email Code').length}`);
    console.log(`Users with Bank Connections: ${userSummary.filter(u => u.connectedBanks > 0).length}`);
    console.log(`Total Bank Connections: ${plaidItems?.length || 0}`);
    
    // Bank statistics
    if (plaidItems && plaidItems.length > 0) {
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
    console.error('Error listing users:', error);
  }
}

listUsers();