#!/usr/bin/env node

const http = require('http');

const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

async function makeRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/debug/${endpoint}`, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 3000),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
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

async function runCommand(command) {
  console.log(`\n🔧 Running: ${command}`);
  console.log('=' .repeat(50));
  
  try {
    const result = await makeRequest(command);
    
    if (result.status === 200) {
      console.log('✅ SUCCESS');
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      console.log(`❌ FAILED (${result.status})`);
      console.log(JSON.stringify(result.data, null, 2));
    }
  } catch (error) {
    console.log('❌ ERROR');
    console.error(error.message);
  }
}

const command = process.argv[2];
const availableCommands = [
  'regenerate-cycles',
  'capital-one-sync', 
  'fix-cycles',
  'data-audit',
  'data-repair'
];

if (!command || !availableCommands.includes(command)) {
  console.log('🔧 Debug Tools CLI');
  console.log('\nUsage: node scripts/debug-tools.js <command>');
  console.log('\nAvailable commands:');
  availableCommands.forEach(cmd => {
    console.log(`  • ${cmd}`);
  });
  console.log('\nExamples:');
  console.log('  node scripts/debug-tools.js data-audit');
  console.log('  node scripts/debug-tools.js regenerate-cycles');
  process.exit(1);
}

console.log('🔧 Credit Card App Debug Tools');
console.log(`Target: ${BASE_URL}`);

runCommand(command).then(() => {
  console.log('\n✨ Done');
}).catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});