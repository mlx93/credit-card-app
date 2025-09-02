import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'fix-cycles',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    console.log('🔧 Fixing billing_cycles table schema...');
    
    // First, check current table structure
    const { data: columns, error: schemaError } = await supabaseAdmin
      .rpc('get_table_columns', { table_name: 'billing_cycles' })
      .single();
    
    let currentColumns: string[] = [];
    if (!schemaError && columns) {
      currentColumns = columns;
    } else {
      // Fallback: try a different approach
      const { data: testData, error: testError } = await supabaseAdmin
        .from('billing_cycles')
        .select('*')
        .limit(1);
      
      if (!testError && testData && testData.length > 0) {
        currentColumns = Object.keys(testData[0]);
      }
    }

    // Check what columns the insert is trying to use
    const requiredColumns = [
      'id',
      'creditCardId', 
      'creditCardName',
      'startDate',
      'endDate',
      'statementBalance',
      'minimumPayment',
      'dueDate',
      'totalSpend',
      'transactionCount',
      'updatedAt'
    ];

    const missingColumns = requiredColumns.filter(col => 
      !currentColumns.some(existing => 
        existing.toLowerCase() === col.toLowerCase()
      )
    );

    // Try to add missing columns (this might fail due to permissions)
    const addColumnResults = [];
    for (const column of missingColumns) {
      try {
        let columnType = 'TEXT';
        if (column === 'transactionCount') columnType = 'INTEGER DEFAULT 0';
        if (column === 'totalSpend' || column === 'statementBalance' || column === 'minimumPayment') columnType = 'NUMERIC';
        if (column.includes('Date') || column === 'updatedAt') columnType = 'TIMESTAMP';
        
        const { error } = await supabaseAdmin.rpc('exec_sql', {
          query: `ALTER TABLE billing_cycles ADD COLUMN IF NOT EXISTS ${column} ${columnType}`
        });
        
        if (error) {
          addColumnResults.push({ column, success: false, error: error.message });
        } else {
          addColumnResults.push({ column, success: true });
        }
      } catch (err: any) {
        addColumnResults.push({ column, success: false, error: err.message });
      }
    }

    // Test if we can insert a record now
    let insertTest = { success: false, error: 'Not attempted' };
    try {
      const testRecord = {
        id: 'test-' + Date.now(),
        creditCardId: 'test-card-id',
        creditCardName: 'Test Card',
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        totalSpend: 0,
        transactionCount: 0,
        updatedAt: new Date().toISOString()
      };

      const { error: insertError } = await supabaseAdmin
        .from('billing_cycles')
        .insert([testRecord]);
      
      if (insertError) {
        insertTest = { success: false, error: insertError.message };
      } else {
        insertTest = { success: true, error: null };
        
        // Clean up test record
        await supabaseAdmin
          .from('billing_cycles')
          .delete()
          .eq('id', testRecord.id);
      }
    } catch (err: any) {
      insertTest = { success: false, error: err.message };
    }

    return NextResponse.json({
      success: true,
      message: 'Schema analysis completed',
      currentColumns,
      requiredColumns,
      missingColumns,
      addColumnResults,
      insertTest,
      recommendation: missingColumns.length > 0 
        ? 'Run the following SQL in Supabase dashboard: ' + missingColumns.map(col => {
            let columnType = 'TEXT';
            if (col === 'transactionCount') columnType = 'INTEGER DEFAULT 0';
            if (col === 'totalSpend' || col === 'statementBalance' || col === 'minimumPayment') columnType = 'NUMERIC';
            if (col.includes('Date') || col === 'updatedAt') columnType = 'TIMESTAMP';
            return `ALTER TABLE billing_cycles ADD COLUMN IF NOT EXISTS ${col} ${columnType};`;
          }).join(' ')
        : 'All required columns exist',
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('💥 Fix cycles failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}