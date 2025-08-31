/**
 * Test Schema - Check if lowercase columns exist and work
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Debug environment variables
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Found' : 'Missing');
console.log('SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Found' : 'Missing');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSchema() {
  console.log('🔍 Testing transaction table schema...\n');

  try {
    // Test 1: Try to select with lowercase column names
    console.log('1. Testing lowercase column selection...');
    const { data, error } = await supabase
      .from('transactions')
      .select('id, accountid, plaidtransactionid, amount, name')
      .limit(1);
    
    if (error) {
      console.error('❌ Lowercase columns failed:', error.message);
    } else {
      console.log('✅ Lowercase columns work!');
      console.log('Sample result:', data?.[0]);
    }

    // Test 2: Try to insert a test record with lowercase columns
    console.log('\n2. Testing lowercase column insert...');
    const testRecord = {
      id: 'test-' + Date.now(),
      transactionId: 'test-transaction-' + Date.now(),
      plaidItemId: 'test-item',
      accountid: 'test-account',
      plaidtransactionid: 'test-plaid-id',
      amount: 10.00,
      name: 'Test Transaction',
      date: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { data: insertData, error: insertError } = await supabase
      .from('transactions')
      .insert([testRecord])
      .select();

    if (insertError) {
      console.error('❌ Insert with lowercase columns failed:', insertError.message);
    } else {
      console.log('✅ Insert with lowercase columns works!');
      
      // Clean up test record
      await supabase
        .from('transactions')
        .delete()
        .eq('id', testRecord.id);
      console.log('🧹 Cleaned up test record');
    }

    // Test 3: Check actual column definitions
    console.log('\n3. Checking database schema...');
    const { data: columns, error: schemaError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'transactions')
      .in('column_name', ['accountid', 'plaidtransactionid', 'accountId', 'plaidTransactionId']);
    
    if (schemaError) {
      console.error('❌ Schema check failed:', schemaError.message);
    } else {
      console.log('📋 Column definitions:');
      columns?.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
    }

  } catch (error) {
    console.error('💥 Test failed:', error);
  }
}

// Run if called directly
if (require.main === module) {
  testSchema().then(() => {
    console.log('\n✅ Schema test completed');
    process.exit(0);
  }).catch(error => {
    console.error('❌ Schema test failed:', error);
    process.exit(1);
  });
}

module.exports = { testSchema };