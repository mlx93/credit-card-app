import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { encrypt, decrypt } from '@/lib/encryption';

import { requireAdminAccess } from '@/lib/adminSecurity';
export async function GET(request: NextRequest) {
  // Security check - admin only
  const securityError = await requireAdminAccess(request, {
    endpointName: 'debug-encryption',
    logAccess: true
  });
  if (securityError) return securityError;

  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('=== ENCRYPTION DEBUG ===');

    // Check if ENCRYPTION_KEY exists
    const hasEncryptionKey = !!process.env.ENCRYPTION_KEY;
    console.log('ENCRYPTION_KEY exists:', hasEncryptionKey);
    
    if (!hasEncryptionKey) {
      return NextResponse.json({
        success: false,
        error: 'ENCRYPTION_KEY environment variable is missing'
      });
    }

    // Test encryption/decryption with sample data
    try {
      const testString = 'test_access_token_12345';
      console.log('Testing encryption/decryption with sample data...');
      
      const encrypted = encrypt(testString);
      console.log('Encryption successful, encrypted length:', encrypted.length);
      
      const decrypted = decrypt(encrypted);
      console.log('Decryption successful, matches original:', decrypted === testString);
      
      if (decrypted !== testString) {
        throw new Error('Decrypted text does not match original');
      }
    } catch (testError) {
      console.error('Encryption test failed:', testError);
      return NextResponse.json({
        success: false,
        error: 'Encryption/decryption test failed',
        details: testError.message
      });
    }

    // Check actual stored access tokens
    const { data: plaidItems, error: plaidError } = await supabaseAdmin
      .from('plaid_items')
      .select('id, institutionName, accessToken')
      .eq('userId', session.user.id)
      .limit(1);

    if (plaidError) {
      throw new Error(`Failed to fetch plaid item: ${plaidError.message}`);
    }

    const plaidItem = plaidItems?.[0];

    if (!plaidItem) {
      return NextResponse.json({
        success: false,
        error: 'No Plaid items found for user'
      });
    }

    console.log(`Testing decryption of stored access token for ${plaidItem.institutionName}`);
    console.log('Stored access token length:', plaidItem.accessToken.length);
    console.log('Access token starts with:', plaidItem.accessToken.substring(0, 20) + '...');

    try {
      const decryptedToken = decrypt(plaidItem.accessToken);
      console.log('Successfully decrypted access token, length:', decryptedToken.length);
      
      // Don't log the actual token, just verify it looks like a Plaid token
      const looksLikePlaidToken = decryptedToken.startsWith('access-');
      console.log('Decrypted token looks like Plaid format:', looksLikePlaidToken);
      
      return NextResponse.json({
        success: true,
        encryptionTest: 'passed',
        hasEncryptionKey: true,
        tokenDecryption: 'successful',
        tokenFormat: looksLikePlaidToken ? 'valid_plaid_format' : 'unexpected_format',
        institutionName: plaidItem.institutionName
      });
      
    } catch (decryptError) {
      console.error('Failed to decrypt stored access token:', decryptError);
      return NextResponse.json({
        success: false,
        encryptionTest: 'passed',
        hasEncryptionKey: true,
        tokenDecryption: 'failed',
        error: decryptError.message,
        institutionName: plaidItem.institutionName
      });
    }

  } catch (error) {
    console.error('Encryption debug error:', error);
    return NextResponse.json({ 
      success: false,
      error: 'Debug endpoint failed',
      details: error.message 
    }, { status: 500 });
  }
}