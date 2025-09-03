#!/usr/bin/env node

/**
 * Production User Statistics Query Script
 * 
 * This script queries the production database to get user statistics including:
 * - Total number of users
 * - Number of users who have logged in (have sessions or accounts)
 * - Active vs inactive users
 */

require('dotenv').config({ path: '.env.production' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function getUserStats() {
  try {
    console.log('🔍 Querying production database for user statistics...\n');

    // Get comprehensive user statistics
    const [
      totalUsers,
      usersWithSessions,
      usersWithAccounts,
      usersWithPlaidItems,
      totalSessions,
      activeSessions,
      totalAccounts,
      totalPlaidItems,
      totalCreditCards,
      totalTransactions
    ] = await Promise.all([
      // Total registered users
      prisma.user.count(),
      
      // Users who have had sessions (logged in)
      prisma.user.count({
        where: {
          sessions: {
            some: {}
          }
        }
      }),
      
      // Users with OAuth accounts (Google login)
      prisma.user.count({
        where: {
          accounts: {
            some: {}
          }
        }
      }),
      
      // Users with Plaid connections (connected bank accounts)
      prisma.user.count({
        where: {
          items: {
            some: {}
          }
        }
      }),
      
      // Total sessions (all time)
      prisma.session.count(),
      
      // Active sessions (not expired)
      prisma.session.count({
        where: {
          expires: {
            gt: new Date()
          }
        }
      }),
      
      // Total OAuth accounts
      prisma.account.count(),
      
      // Total Plaid items
      prisma.plaidItem.count(),
      
      // Total credit cards
      prisma.creditCard.count(),
      
      // Total transactions
      prisma.transaction.count()
    ]);

    // Get recent user activity
    const recentUsers = await prisma.user.findMany({
      select: {
        email: true,
        name: true,
        createdAt: true,
        _count: {
          select: {
            sessions: true,
            accounts: true,
            items: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    // Calculate derived metrics
    const usersWhoLoggedIn = Math.max(usersWithSessions, usersWithAccounts);
    const avgSessionsPerUser = totalUsers > 0 ? (totalSessions / totalUsers).toFixed(2) : 0;
    const userEngagementRate = totalUsers > 0 ? ((usersWithPlaidItems / totalUsers) * 100).toFixed(1) : 0;

    // Display results
    console.log('📊 PRODUCTION DATABASE USER STATISTICS');
    console.log('=' .repeat(60));
    console.log(`📅 Generated: ${new Date().toISOString()}`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    console.log();

    console.log('👥 USER METRICS:');
    console.log(`   Total registered users: ${totalUsers.toLocaleString()}`);
    console.log(`   Users who have logged in: ${usersWhoLoggedIn.toLocaleString()}`);
    console.log(`   Users with bank connections: ${usersWithPlaidItems.toLocaleString()}`);
    console.log(`   User engagement rate: ${userEngagementRate}%`);
    console.log();

    console.log('🔐 SESSION & AUTH METRICS:');
    console.log(`   Total sessions (all time): ${totalSessions.toLocaleString()}`);
    console.log(`   Currently active sessions: ${activeSessions.toLocaleString()}`);
    console.log(`   OAuth accounts: ${totalAccounts.toLocaleString()}`);
    console.log(`   Average sessions per user: ${avgSessionsPerUser}`);
    console.log();

    console.log('💳 APPLICATION DATA:');
    console.log(`   Plaid connections: ${totalPlaidItems.toLocaleString()}`);
    console.log(`   Credit cards tracked: ${totalCreditCards.toLocaleString()}`);
    console.log(`   Transactions processed: ${totalTransactions.toLocaleString()}`);
    console.log();

    if (recentUsers.length > 0) {
      console.log('📈 RECENT USER ACTIVITY:');
      recentUsers.forEach((user, index) => {
        const loginCount = Math.max(user._count.sessions, user._count.accounts);
        console.log(`   ${index + 1}. ${user.email || 'Anonymous'}`);
        console.log(`      Joined: ${user.createdAt.toLocaleDateString()}`);
        console.log(`      Sessions/Logins: ${loginCount}`);
        console.log(`      Bank connections: ${user._count.items}`);
        console.log();
      });
    }

    // Summary
    console.log('📋 SUMMARY:');
    console.log(`   • ${totalUsers} users registered`);
    console.log(`   • ${usersWhoLoggedIn} users have logged into the app`);
    console.log(`   • ${activeSessions} users currently have active sessions`);
    console.log(`   • ${usersWithPlaidItems} users have connected their bank accounts`);
    
    if (totalUsers > 0) {
      const loginRate = ((usersWhoLoggedIn / totalUsers) * 100).toFixed(1);
      console.log(`   • ${loginRate}% login rate (users who have logged in at least once)`);
    }

    return {
      totalUsers,
      usersWhoLoggedIn,
      activeSessions,
      usersWithPlaidItems,
      userEngagementRate: parseFloat(userEngagementRate)
    };

  } catch (error) {
    console.error('❌ Error querying database:', error.message);
    
    if (error.message.includes('Environment variable not found')) {
      console.log('\n💡 Make sure you have a .env.production file with DATABASE_URL configured');
    } else if (error.message.includes('Can\'t reach database')) {
      console.log('\n💡 Check your database connection and credentials');
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Main execution
if (require.main === module) {
  getUserStats()
    .then(() => {
      console.log('\n✅ Query completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error.message);
      process.exit(1);
    });
}

module.exports = { getUserStats };