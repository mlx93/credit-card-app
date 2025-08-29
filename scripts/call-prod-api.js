#!/usr/bin/env node

const https = require('https');
require('dotenv').config({ path: '.env.local' });

async function callProductionAPI(endpoint, method = 'POST') {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/debug/${endpoint}`, process.env.NEXTAUTH_URL || 'https://www.cardcycle.app');
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; debug-script/1.0)'
      }
    };

    console.log(`📞 Calling production API: ${method} ${url.href}`);

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`📊 Response Status: ${res.statusCode}`);
        console.log(`📊 Response Headers:`, res.headers);
        console.log(`📊 Response Body:`, data);
        
        try {
          const result = JSON.parse(data);
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data: { error: 'Invalid JSON response', raw: data } });
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

const endpoint = process.argv[2] || 'regenerate-cycles';
callProductionAPI(endpoint).then((result) => {
  console.log('\n✨ API call complete');
}).catch(error => {
  console.error('\n💥 API call failed:', error.message);
});