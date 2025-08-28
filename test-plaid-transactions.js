const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Test script to directly call Plaid transactions API
async function testPlaidTransactions() {
  const configuration = new Configuration({
    basePath: PlaidEnvironments.production, // Use production
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  const client = new PlaidApi(configuration);

  // You'll need to replace this with an actual access token from your database
  // const accessToken = 'YOUR_ACCESS_TOKEN_HERE';
  
  console.log('Testing different date ranges with Plaid transactions API...');
  
  const endDate = new Date();
  const testRanges = [
    { months: 3, label: '3 months' },
    { months: 6, label: '6 months' }, 
    { months: 12, label: '12 months' },
    { months: 24, label: '24 months' }
  ];

  // Test each date range
  for (const range of testRanges) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - range.months);
    
    console.log(`\n=== Testing ${range.label} back (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}) ===`);
    
    try {
      // You would uncomment this when you have an access token:
      /*
      const request = {
        access_token: accessToken,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      };
      
      const response = await client.transactionsGet(request);
      console.log(`✅ Success: ${response.data.transactions.length} transactions returned`);
      console.log(`Total available: ${response.data.total_transactions}`);
      
      if (response.data.transactions.length > 0) {
        const dates = response.data.transactions.map(t => t.date).sort();
        console.log(`Actual date range: ${dates[0]} to ${dates[dates.length - 1]}`);
      }
      */
      
      console.log('(Uncomment the API call section when you have an access token)');
      
    } catch (error) {
      console.error(`❌ Error for ${range.label}:`, error.message);
    }
  }
}

console.log('To use this script:');
console.log('1. npm install plaid');
console.log('2. Get an access token from your database');
console.log('3. Uncomment the API call section');
console.log('4. Run: node test-plaid-transactions.js');

// testPlaidTransactions();