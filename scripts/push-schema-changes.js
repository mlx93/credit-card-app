#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function pushSchemaChanges() {
  try {
    console.log('🔄 Adding new fields to CreditCard table...');
    
    // Add openDate column
    await prisma.$executeRaw`
      ALTER TABLE credit_cards 
      ADD COLUMN IF NOT EXISTS "openDate" TIMESTAMP(3);
    `;
    
    // Add annualFee column  
    await prisma.$executeRaw`
      ALTER TABLE credit_cards 
      ADD COLUMN IF NOT EXISTS "annualFee" DOUBLE PRECISION;
    `;
    
    // Add annualFeeDueDate column
    await prisma.$executeRaw`
      ALTER TABLE credit_cards 
      ADD COLUMN IF NOT EXISTS "annualFeeDueDate" TIMESTAMP(3);
    `;
    
    console.log('✅ Schema changes applied successfully');
    
  } catch (error) {
    console.error('❌ Error applying schema changes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

pushSchemaChanges();