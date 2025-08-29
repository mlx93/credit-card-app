#!/usr/bin/env node

/**
 * Production Database User Statistics Script
 * 
 * This script connects directly to your production PostgreSQL database
 * to retrieve user and session statistics.
 * 
 * Usage: 
 *   DATABASE_URL="your_production_db_url" node get-production-stats.js
 * 
 * Or set up your .env.production file with DATABASE_URL and run:
 *   node get-production-stats.js
 */

require('dotenv').config({ path: '.env.production' });
require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

async function getProductionUserStats() {
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
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Connected to database successfully');
    console.log('📊 Gathering user statistics...\n');

    // Run all queries in parallel for better performance
    const [
      totalUsers,
      usersWithSessions,
      usersWithAccounts, 
      usersWithPlaidItems,
      totalSessions,
      activeSessions,
      expiredSessions,
      totalAccounts,
      recentUsers,
      oldestUser,
      newestUser
    ] = await Promise.all([
      // Count total registered users
      prisma.user.count(),
      
      // Count users who have had at least one session (logged in)
      prisma.user.count({
        where: {
          sessions: {
            some: {}
          }
        }
      }),
      
      // Count users with OAuth accounts (Google login setup)
      prisma.user.count({
        where: {
          accounts: {
            some: {}
          }
        }
      }),
      
      // Count users who have connected Plaid (bank accounts)
      prisma.user.count({
        where: {
          items: {
            some: {}
          }
        }
      }),
      
      // Count total sessions (all time)
      prisma.session.count(),
      
      // Count currently active sessions
      prisma.session.count({
        where: {
          expires: {
            gt: new Date()
          }
        }
      }),
      
      // Count expired sessions
      prisma.session.count({
        where: {
          expires: {
            lt: new Date()
          }
        }
      }),
      
      // Count total OAuth accounts
      prisma.account.count(),
      
      // Get 10 most recent users with their activity
      prisma.user.findMany({
        select: {
          id: true,
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
        take: 10
      }),
      
      // Get oldest user
      prisma.user.findFirst({
        select: {
          email: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      }),
      
      // Get newest user 
      prisma.user.findFirst({
        select: {
          email: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
    ]);

    // Calculate derived metrics
    const usersWhoLoggedIn = Math.max(usersWithSessions, usersWithAccounts);
    const loginRate = totalUsers > 0 ? ((usersWhoLoggedIn / totalUsers) * 100) : 0;
    const engagementRate = totalUsers > 0 ? ((usersWithPlaidItems / totalUsers) * 100) : 0;
    const avgSessionsPerUser = totalUsers > 0 ? (totalSessions / totalUsers) : 0;
    
    // Display comprehensive results
    console.log('═'.repeat(70));
    console.log('📊 CARDCYCLE.APP - PRODUCTION USER STATISTICS');
    console.log('═'.repeat(70));
    console.log(`📅 Generated at: ${new Date().toISOString()}`);
    console.log(`🗄️  Database: PostgreSQL (Production)`);
    console.log();
    
    console.log('👥 USER REGISTRATION METRICS:');
    console.log(`   Total Users Registered: ${totalUsers.toLocaleString()}`);
    console.log(`   Oldest User: ${oldestUser?.email || 'N/A'} (${oldestUser?.createdAt?.toLocaleDateString() || 'N/A'})`);
    console.log(`   Newest User: ${newestUser?.email || 'N/A'} (${newestUser?.createdAt?.toLocaleDateString() || 'N/A'})`);
    console.log();
    
    console.log('🔐 LOGIN & SESSION METRICS:');
    console.log(`   Users Who Have Logged In: ${usersWhoLoggedIn.toLocaleString()}`);
    console.log(`   Login Rate: ${loginRate.toFixed(1)}% (users who logged in at least once)`);
    console.log(`   Users With OAuth Accounts: ${usersWithAccounts.toLocaleString()}`);
    console.log(`   Total Sessions Created: ${totalSessions.toLocaleString()}`);
    console.log(`   Currently Active Sessions: ${activeSessions.toLocaleString()}`);
    console.log(`   Expired Sessions: ${expiredSessions.toLocaleString()}`);
    console.log(`   Average Sessions per User: ${avgSessionsPerUser.toFixed(1)}`);
    console.log();
    
    console.log('🏦 USER ENGAGEMENT METRICS:');
    console.log(`   Users with Bank Connections: ${usersWithPlaidItems.toLocaleString()}`);
    console.log(`   Engagement Rate: ${engagementRate.toFixed(1)}% (users who connected banks)`);
    console.log();
    
    if (recentUsers.length > 0) {
      console.log('📈 RECENT USER ACTIVITY (Last 10 Users):');
      recentUsers.forEach((user, index) => {
        const hasLoggedIn = user._count.sessions > 0 || user._count.accounts > 0;
        const status = hasLoggedIn ? '✅ Logged in' : '❌ Never logged in';
        console.log(`   ${String(index + 1).padStart(2)}. ${(user.email || 'Anonymous').padEnd(25)} | ${user.createdAt.toLocaleDateString().padEnd(10)} | ${status} | Banks: ${user._count.items}`);
      });
      console.log();
    }
    
    console.log('📋 SUMMARY FOR CARDCYCLE.APP:');
    console.log(`   • ${totalUsers.toLocaleString()} total users have registered`);
    console.log(`   • ${usersWhoLoggedIn.toLocaleString()} users have actually logged into the app`);
    console.log(`   • ${activeSessions.toLocaleString()} users have active sessions right now`);
    console.log(`   • ${usersWithPlaidItems.toLocaleString()} users have connected their bank accounts`);
    
    if (totalUsers > 0) {
      console.log(`   • ${loginRate.toFixed(1)}% of registered users have logged in`);
      console.log(`   • ${engagementRate.toFixed(1)}% of users are actively using the app (connected banks)`);
    }
    
    console.log();
    console.log('🎯 KEY METRICS:');
    console.log(`   Total Users: ${totalUsers}`);
    console.log(`   Active Users: ${usersWhoLoggedIn}`);
    console.log(`   Engaged Users: ${usersWithPlaidItems}`);
    
    // Save results to history file
    const statsData = {
      totalUsers,
      usersWhoLoggedIn,
      activeSessions,
      usersWithPlaidItems,
      loginRate: parseFloat(loginRate.toFixed(1)),
      engagementRate: parseFloat(engagementRate.toFixed(1)),
      totalSessions,
      expiredSessions,
      avgSessionsPerUser: parseFloat(avgSessionsPerUser.toFixed(1))
    };
    
    const userList = recentUsers.map(user => ({
      email: user.email,
      joinDate: user.createdAt.toLocaleDateString(),
      status: (user._count.sessions > 0 || user._count.accounts > 0) ? '✅ Logged in' : '❌ Never logged in',
      bankConnections: user._count.items
    }));
    
    await saveStatsToHistory(statsData, userList);
    
    return statsData;
    
  } catch (error) {
    console.error('\n❌ Error querying production database:');
    console.error(`   ${error.message}`);
    
    if (error.message.includes('Environment variable not found') || error.message.includes('DATABASE_URL')) {
      console.log('\n💡 SETUP INSTRUCTIONS:');
      console.log('   1. Get your production DATABASE_URL from Vercel/hosting provider');
      console.log('   2. Run: DATABASE_URL="your_production_url" node get-production-stats.js');
      console.log('   3. Or add DATABASE_URL to .env.production file');
    } else if (error.message.includes('connect')) {
      console.log('\n💡 CONNECTION HELP:');
      console.log('   • Check your database URL is correct');
      console.log('   • Ensure database is accessible from your current IP');
      console.log('   • Verify database credentials');
    }
    
    throw error;
  } finally {
    await prisma.$disconnect();
    console.log('\n🔚 Database connection closed');
  }
}

async function saveStatsToHistory(statsData, userList) {
  const historyFile = path.join(__dirname, 'user-stats-history.json');
  const timestamp = new Date().toISOString();
  
  let history = { snapshots: [] };
  
  // Load existing history if it exists
  try {
    if (fs.existsSync(historyFile)) {
      const existingData = fs.readFileSync(historyFile, 'utf8');
      history = JSON.parse(existingData);
    }
  } catch (error) {
    console.log('📝 Creating new stats history file');
  }
  
  // Add new snapshot
  const newSnapshot = {
    timestamp,
    metrics: statsData,
    users: userList,
    summary: {
      description: statsData.totalUsers <= 5 ? "Small but focused user base" : 
                   statsData.totalUsers <= 20 ? "Growing user community" : "Established user base",
      highlights: [
        `${statsData.loginRate}% of registered users have logged in`,
        `${statsData.engagementRate}% of users have connected bank accounts`,
        `${statsData.activeSessions} users currently have active sessions`,
        `${statsData.avgSessionsPerUser} average sessions per user`
      ]
    }
  };
  
  history.snapshots.unshift(newSnapshot); // Add to beginning
  history.lastUpdated = timestamp;
  
  // Keep only last 10 snapshots
  if (history.snapshots.length > 10) {
    history.snapshots = history.snapshots.slice(0, 10);
  }
  
  // Save to file
  try {
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    console.log(`\n💾 Stats saved to ${historyFile}`);
  } catch (error) {
    console.log(`\n❌ Failed to save stats: ${error.message}`);
  }
}

// Execute if called directly
if (require.main === module) {
  getProductionUserStats()
    .then((stats) => {
      console.log('✅ Successfully retrieved production user statistics');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Failed to retrieve statistics');
      process.exit(1);
    });
}

module.exports = { getProductionUserStats };