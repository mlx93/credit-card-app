import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing transaction table schema...');
    
    const results = {
      lowercaseSelection: null as any,
      insertTest: null as any,
      schemaCheck: null as any
    };

    // Test 1: Try to select with lowercase column names
    console.log('1. Testing lowercase column selection...');
    try {
      const { data, error } = await supabaseAdmin
        .from('transactions')
        .select('id, accountid, plaidtransactionid, amount, name')
        .limit(1);
      
      if (error) {
        results.lowercaseSelection = { success: false, error: error.message };
        console.error('❌ Lowercase columns failed:', error.message);
      } else {
        results.lowercaseSelection = { success: true, count: data?.length || 0, sample: data?.[0] };
        console.log('✅ Lowercase columns work! Found', data?.length, 'records');
      }
    } catch (err: any) {
      results.lowercaseSelection = { success: false, error: err.message };
    }

    // Test 2: Try to insert a test record with lowercase columns
    console.log('2. Testing lowercase column insert...');
    try {
      const testRecord = {
        id: 'test-schema-' + Date.now(),
        transactionId: 'test-transaction-' + Date.now(),
        plaidItemId: 'test-item',
        accountid: 'test-account-id',
        plaidtransactionid: 'test-plaid-trans-id',
        amount: 1.23,
        name: 'Schema Test Transaction',
        date: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const { data: insertData, error: insertError } = await supabaseAdmin
        .from('transactions')
        .insert([testRecord])
        .select();

      if (insertError) {
        results.insertTest = { success: false, error: insertError.message };
        console.error('❌ Insert with lowercase columns failed:', insertError.message);
      } else {
        results.insertTest = { success: true, inserted: insertData };
        console.log('✅ Insert with lowercase columns works!');
        
        // Clean up test record
        await supabaseAdmin
          .from('transactions')
          .delete()
          .eq('id', testRecord.id);
        console.log('🧹 Cleaned up test record');
      }
    } catch (err: any) {
      results.insertTest = { success: false, error: err.message };
    }

    // Test 3: Check actual column definitions
    console.log('3. Checking database schema...');
    try {
      const { data: columns, error: schemaError } = await supabaseAdmin
        .rpc('get_column_info', { 
          table_name: 'transactions',
          column_names: ['accountid', 'plaidtransactionid', 'accountId', 'plaidTransactionId']
        });
      
      if (schemaError) {
        // Fallback to simpler query
        const { data: fallbackColumns, error: fallbackError } = await supabaseAdmin
          .from('information_schema.columns')
          .select('column_name, data_type, is_nullable')
          .eq('table_name', 'transactions')
          .in('column_name', ['accountid', 'plaidtransactionid']);
          
        if (fallbackError) {
          results.schemaCheck = { success: false, error: fallbackError.message };
        } else {
          results.schemaCheck = { success: true, columns: fallbackColumns };
          console.log('📋 Found columns:', fallbackColumns);
        }
      } else {
        results.schemaCheck = { success: true, columns };
      }
    } catch (err: any) {
      results.schemaCheck = { success: false, error: err.message };
    }

    return NextResponse.json({
      success: true,
      message: 'Schema test completed',
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Schema test failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}