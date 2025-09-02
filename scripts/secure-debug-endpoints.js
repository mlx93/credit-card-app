#!/usr/bin/env node

/**
 * Script to add admin security to all debug endpoints
 * Run with: node scripts/secure-debug-endpoints.js
 */

const fs = require('fs');
const path = require('path');

// List of debug endpoints to secure (paths relative to src/app/api/)
const DEBUG_ENDPOINTS = [
  // debug/* folder endpoints
  'debug/amex-filtering-debug',
  'debug/amex-historical-debug',
  'debug/auth-debug',
  'debug/boa-billing-debug',
  'debug/boa-june-check',
  'debug/capital-one-full-debug',
  'debug/capital-one-jsx',
  'debug/capital-one-limits',
  'debug/capital-one-sync',
  'debug/card-open-dates',
  'debug/connection-debug',
  'debug/current-cards',
  'debug/data-audit',
  'debug/data-repair',
  'debug/encryption',
  'debug/fix-cycles',
  'debug/fix-future-dates',
  'debug/fix-incorrect-open-dates',
  'debug/fix-open-dates-from-transactions',
  'debug/fix-open-dates',
  'debug/force-fix-boa-date',
  'debug/full-pipeline',
  'debug/google-oauth-check',
  'debug/inspect-boa-data',
  'debug/link-token-test',
  'debug/link-token',
  'debug/plaid-api-explorer',
  'debug/plaid-categories',
  'debug/plaid-limits',
  'debug/plaid-raw-data',
  'debug/plaid-status',
  'debug/plaid-transactions',
  'debug/regenerate-cycles',
  'debug/smart-fix-boa-cycles',
  'debug/sync-capital-one',
  'debug/test-link-token',
  'debug/transaction-sample',
  'debug/transactions',
  'debug/verify-refresh-pipeline',
  
  // Other debug endpoints
  'debug-amex-date',
  'debug-api-response',
  'debug-cap-one',
  'debug-cards',
  'debug-cycle-limits',
  'debug-cycles',
  'debug-final',
  
  // Test endpoints
  'test/transactions',
  'test-schema',
  'auth/test',
  'auth/test-email',
  
  // Fix endpoints
  'fix-cycles',
  
  // Admin operations
  'billing-cycles/regenerate',
  'billing-cycles/status',
];

// Endpoints already secured (skip these)
const ALREADY_SECURED = [
  'debug/database',
  'debug/user-stats',
  'debug-transactions',
];

const API_DIR = path.join(__dirname, '../src/app/api');

function addSecurityToEndpoint(endpointPath) {
  const filePath = path.join(API_DIR, endpointPath, 'route.ts');
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ File not found: ${filePath}`);
    return false;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if already secured
  if (content.includes('requireAdminAccess') || content.includes('requireAdminWithSession')) {
    console.log(`✅ Already secured: ${endpointPath}`);
    return true;
  }
  
  // Add import if not present
  if (!content.includes("from '@/lib/adminSecurity'")) {
    // Find the last import line
    const importMatch = content.match(/(import[\s\S]*?from\s+['"].*?['"];?\s*\n)+/);
    if (importMatch) {
      const lastImportEnd = importMatch.index + importMatch[0].length;
      content = content.slice(0, lastImportEnd) + 
                "import { requireAdminAccess } from '@/lib/adminSecurity';\n" +
                content.slice(lastImportEnd);
    }
  }
  
  // Add security check to GET function
  content = content.replace(
    /export\s+async\s+function\s+GET\s*\([^)]*\)\s*{(\s*try\s*{)?/,
    (match, tryBlock) => {
      const endpointName = endpointPath.replace(/\//g, '-');
      const securityCode = `
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: '${endpointName}',
    logAccess: true
  });
  if (securityError) return securityError;
`;
      
      if (tryBlock) {
        return match.replace(tryBlock, `{${securityCode}\n  try {`);
      } else {
        return match + securityCode;
      }
    }
  );
  
  // Add security check to POST function if exists
  if (content.includes('export async function POST')) {
    content = content.replace(
      /export\s+async\s+function\s+POST\s*\([^)]*\)\s*{(\s*try\s*{)?/,
      (match, tryBlock) => {
        const endpointName = endpointPath.replace(/\//g, '-');
        const securityCode = `
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: '${endpointName}',
    logAccess: true
  });
  if (securityError) return securityError;
`;
        
        if (tryBlock) {
          return match.replace(tryBlock, `{${securityCode}\n  try {`);
        } else {
          return match + securityCode;
        }
      }
    );
  }
  
  // Write the secured file
  fs.writeFileSync(filePath, content);
  console.log(`🔒 Secured: ${endpointPath}`);
  return true;
}

console.log('🔐 Starting to secure debug endpoints...\n');

let secured = 0;
let failed = 0;
let skipped = 0;

DEBUG_ENDPOINTS.forEach(endpoint => {
  if (ALREADY_SECURED.includes(endpoint)) {
    console.log(`⏭️  Skipping (already secured): ${endpoint}`);
    skipped++;
  } else {
    if (addSecurityToEndpoint(endpoint)) {
      secured++;
    } else {
      failed++;
    }
  }
});

console.log('\n📊 Summary:');
console.log(`✅ Secured: ${secured} endpoints`);
console.log(`⏭️  Skipped: ${skipped} endpoints`);
console.log(`❌ Failed: ${failed} endpoints`);
console.log('\n🎯 Total endpoints processed: ' + (secured + skipped + failed));