// Quick debug script to check Capital One cycle ordering
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugCapitalOneCycles() {
  console.log('🔍 Checking Capital One cycles in database...\n');

  const { data: cycles, error } = await supabase
    .from('billing_cycles')
    .select('*')
    .ilike('creditcardname', '%quicksilver%')
    .order('startDate', { ascending: false });

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📊 Capital One cycles (sorted by startDate desc):');
  cycles.forEach((cycle, i) => {
    console.log(`${i + 1}. ${cycle.startDate} to ${cycle.endDate} | $${cycle.totalSpend} | Statement: $${cycle.statementBalance || 0}`);
  });

  // Check if the problem is in the database order
  console.log('\n🎯 Focus on the problematic cycles:');
  const problematicCycles = cycles.filter(c => 
    c.endDate.includes('2025-08-27') || c.endDate.includes('2025-06-28')
  );
  
  console.log('Cycles that should be ordered correctly:');
  problematicCycles.forEach(cycle => {
    console.log(`- ${cycle.startDate} to ${cycle.endDate} (Start: ${new Date(cycle.startDate).getTime()})`);
  });
}

if (require.main === module) {
  debugCapitalOneCycles().then(() => process.exit(0)).catch(console.error);
}

module.exports = { debugCapitalOneCycles };