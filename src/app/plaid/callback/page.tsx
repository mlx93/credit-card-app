'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

function PlaidCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing your connection...');

  useEffect(() => {
    const handlePlaidCallback = async () => {
      try {
        // Get parameters from URL
        const publicToken = searchParams.get('public_token');
        const linkSessionId = searchParams.get('link_session_id');
        const oauthStateId = searchParams.get('oauth_state_id');
        
        console.log('Callback page received params:', {
          publicToken: publicToken ? 'present' : 'missing',
          linkSessionId,
          oauthStateId
        });

        // If we have oauth_state_id but no public_token, this is an OAuth resumption
        if (oauthStateId && !publicToken) {
          console.log('🔗 OAuth resumption detected, redirecting to resume Link flow');
          setMessage('Resuming connection...');
          
          // Redirect back to dashboard to resume Link flow
          // The dashboard can detect the oauth_state_id and resume
          const dashboardUrl = new URL('/dashboard', window.location.origin);
          dashboardUrl.searchParams.set('oauth_state_id', oauthStateId);
          if (linkSessionId) {
            dashboardUrl.searchParams.set('link_session_id', linkSessionId);
          }
          
          window.location.href = dashboardUrl.toString();
          return;
        }
        
        if (!publicToken) {
          throw new Error('No public token received from Plaid');
        }

        console.log('PlaidCallback: Received public token, exchanging for access token...');
        setMessage('Securing your connection...');

        // Exchange the public token for an access token
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token: publicToken }),
        });

        const data = await response.json();

        if (data.success) {
          console.log('PlaidCallback: Token exchange successful, itemId:', data.itemId);
          setMessage('Preparing your new card...');
          
          // Small delay to ensure database transaction is committed before sync
          console.log('⏳ Waiting for database commit before targeted sync...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Target sync for ONLY the new card - not all cards
          try {
            console.log('🎯 Starting targeted sync for itemId:', data.itemId);
            const syncResponse = await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId: data.itemId })
            });
            
            if (syncResponse.ok) {
              const syncData = await syncResponse.json();
              console.log('✅ New card sync completed successfully:', syncData);
              
              // Verify sync actually created cards before claiming success
              const hasSuccessfulResults = syncData.results?.some((result: any) => 
                result.status === 'success' && result.creditCardsFound > 0
              );
              
              if (hasSuccessfulResults) {
                console.log('✅ Verified: Sync created credit card accounts');
                setMessage('Card ready! Your new credit card is now available');
                setStatus('success');
                
                // Wait a moment to show success, then redirect to dashboard
                setTimeout(() => {
                  router.push('/dashboard');
                }, 2000);
              } else {
                console.warn('⚠️ Sync completed but no cards were created');
                setMessage('Connection established - card setup completing...');
                setStatus('success');
                
                setTimeout(() => {
                  router.push('/dashboard');
                }, 2000);
              }
            } else {
              console.warn('⚠️ Sync had issues but card is connected');
              setMessage('Card connected - finalizing setup...');
              setStatus('success');
              
              setTimeout(() => {
                router.push('/dashboard');
              }, 2000);
            }
          } catch (syncError) {
            console.error('Sync request failed:', syncError);
            setMessage('Card connected - sync will complete shortly');
            setStatus('success');
            
            setTimeout(() => {
              router.push('/dashboard');
            }, 2000);
          }
        } else {
          throw new Error(data.error || 'Failed to establish connection');
        }
      } catch (error) {
        console.error('PlaidCallback error:', error);
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Failed to process connection');
        
        // Auto-redirect to dashboard after error
        setTimeout(() => {
          router.push('/dashboard');
        }, 5000);
      }
    };

    handlePlaidCallback();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
          {status === 'processing' && (
            <>
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
                <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-4">
                Connecting Your Card
              </h1>
              <p className="text-gray-600 mb-6">
                {message}
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse w-2/3"></div>
              </div>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-4">
                Connection Successful!
              </h1>
              <p className="text-gray-600 mb-6">
                {message}
              </p>
              <p className="text-sm text-gray-500">
                Redirecting to your dashboard...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-4">
                Connection Failed
              </h1>
              <p className="text-gray-600 mb-6">
                {message}
              </p>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors duration-200"
              >
                Return to Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlaidCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
              <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-4">
              Loading...
            </h1>
            <p className="text-gray-600">
              Processing your connection...
            </p>
          </div>
        </div>
      </div>
    }>
      <PlaidCallbackContent />
    </Suspense>
  );
}