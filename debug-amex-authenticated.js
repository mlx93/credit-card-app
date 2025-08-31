// Use Node.js built-in fetch (Node 18+)
const fetch = globalThis.fetch;

async function debugAmexCyclesAuthenticated() {
  console.log('🔍 Debugging Amex Cycles on cardcycle.app\n');
  
  try {
    // First, let's check the debug endpoint
    console.log('📡 Testing Amex Historical Debug endpoint...');
    const response = await fetch('https://cardcycle.app/api/debug/amex-historical-debug', {
      method: 'GET',
      headers: {
        'User-Agent': 'CardCycle-Debug-Script',
        'Accept': 'application/json'
      }
    });
    
    console.log(`Status: ${response.status}`);
    console.log(`Headers:`, Object.fromEntries(response.headers));
    
    if (response.status === 401) {
      console.log('\n❌ Authentication required. You need to be logged in.');
      console.log('\n📋 To debug with authentication:');
      console.log('1. Open cardcycle.app in your browser');
      console.log('2. Sign in with your Google account');
      console.log('3. Open Developer Tools (F12)');
      console.log('4. Go to Application/Storage → Cookies');
      console.log('5. Copy the session cookie value');
      console.log('6. Run this script with the cookie:\n');
      console.log('   node debug-amex-authenticated.js "your-session-cookie"');
      return;
    }
    
    const data = await response.text();
    console.log('\n📊 Response:', data);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Check if session cookie was provided as argument
const sessionCookie = process.argv[2];

if (sessionCookie) {
  console.log('🔑 Using provided session cookie...\n');
  debugAmexCyclesWithCookie(sessionCookie);
} else {
  debugAmexCyclesAuthenticated();
}

async function debugAmexCyclesWithCookie(cookie) {
  try {
    console.log('📡 Testing with authentication...');
    
    const response = await fetch('https://cardcycle.app/api/debug/amex-historical-debug', {
      method: 'GET',
      headers: {
        'Cookie': `next-auth.session-token=${cookie}`,
        'User-Agent': 'CardCycle-Debug-Script',
        'Accept': 'application/json'
      }
    });
    
    console.log(`Status: ${response.status}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('\n✅ Successfully authenticated!');
      console.log('\n📊 Amex Cycle Analysis:');
      console.log(JSON.stringify(data, null, 2));
      
      // Analyze the results
      if (data.cycleAnalysis) {
        console.log(`\n🔍 Found ${data.cycleAnalysis.length} total cycles`);
        
        const validCycles = data.cycleAnalysis.filter(c => c.isWithinOneYear);
        console.log(`📅 Cycles within one year: ${validCycles.length}`);
        
        const oldestCycle = data.cycleAnalysis[data.cycleAnalysis.length - 1];
        if (oldestCycle) {
          console.log(`📆 Oldest cycle: ${oldestCycle.period} (${oldestCycle.monthsFromToday} months ago)`);
        }
        
        // Check for limiting factors
        if (data.dateLimits.cardOpenedRecently) {
          console.log(`⚠️  Card opened recently: ${data.dateLimits.cardOpenDate}`);
          console.log(`   This may limit historical data availability`);
        }
      }
      
    } else {
      console.log(`❌ Request failed: ${response.status}`);
      const text = await response.text();
      console.log('Response:', text);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}