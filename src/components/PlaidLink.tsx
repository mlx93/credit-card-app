'use client';

import { usePlaidLink } from 'react-plaid-link';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { LoadingOverlay } from './LoadingOverlay';

interface PlaidLinkProps {
  onSuccess?: () => void;
}

export function PlaidLink({ onSuccess }: PlaidLinkProps) {
  const { data: session } = useSession();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Connecting to your bank');
  const [loadingSubMessage, setLoadingSubMessage] = useState('This may take a few moments...');
  const [syncInProgress, setSyncInProgress] = useState(false);

  // Check for OAuth resumption parameters on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const oauthStateId = urlParams.get('oauth_state_id');
      
      if (oauthStateId && !linkToken) {
        console.log('🔗 OAuth resumption detected, creating link token with oauth_state_id:', oauthStateId);
        handleOAuthResumption(oauthStateId);
        
        // Clean up URL parameters
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('oauth_state_id');
        cleanUrl.searchParams.delete('link_session_id');
        window.history.replaceState({}, document.title, cleanUrl.toString());
      }
    }
  }, [linkToken]);

  const handleOAuthResumption = async (oauthStateId: string) => {
    try {
      setLoading(true);
      setLoadingMessage('Resuming connection');
      setLoadingSubMessage('Continuing where you left off...');
      
      const response = await fetch('/api/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oauth_state_id: oauthStateId }),
      });

      const data = await response.json();
      
      if (data.link_token) {
        console.log('OAuth resumption link token received');
        setLinkToken(data.link_token);
      } else {
        console.error('Failed to get OAuth resumption link token:', data.error);
        setLoading(false);
        alert('Failed to resume connection. Please try again.');
      }
    } catch (error) {
      console.error('Error resuming OAuth:', error);
      setLoading(false);
      alert('Network error during OAuth resumption. Please try again.');
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    env: process.env.NEXT_PUBLIC_PLAID_ENV as 'sandbox' | 'development' | 'production' || 'production',
    // Only request credit card products
    product: ['liabilities', 'transactions'],
    // Enable account selection so users can pick specific credit cards
    selectAccount: true,
    // Filter to only show credit card accounts and enable account selection for Capital One
    accountFilters: {
      credit: {
        account_subtypes: ['credit card']
      }
    },
    // Capital One often requires OAuth redirect flow for multiple account selection
    receivedRedirectUri: 'https://cardcycle.app/plaid/callback',
    onSuccess: async (public_token, metadata) => {
      try {
        console.log('Plaid Link success:', { public_token, metadata });
        setLoadingMessage('Securing your connection');
        setLoadingSubMessage('Exchanging tokens...');
        
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        });

        const data = await response.json();
        
        if (data.success) {
          console.log('Token exchange successful, itemId:', data.itemId);
          setLoadingMessage('Preparing your new card');
          setLoadingSubMessage('Loading card details and recent transactions...');
          
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

              // Check if no credit cards were found across all results
              const noCreditCardsFound = syncData.results?.every((result: any) => 
                result.status === 'success' && result.creditCardsFound === 0
              );
              
              if (hasSuccessfulResults) {
                console.log('✅ Verified: Sync created credit card accounts');
                setLoadingMessage('Card ready!');
                setLoadingSubMessage('Your new credit card is now available');
                
                // Quick transition to showing the card  
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  
                  // Only call onSuccess if we have verified card creation
                  console.log('🎯 PlaidLink: Calling onSuccess with verified sync completion');
                  onSuccess?.();
                }, 800);
              } else if (noCreditCardsFound) {
                console.warn('⚠️ No credit cards found at connected institution');
                setLoadingMessage('No credit cards found');
                setLoadingSubMessage('This institution may not have credit card accounts available');
                
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  alert('No credit cards were found at this institution. You may have connected a bank account instead of a credit card account, or this institution may not support credit card data through Plaid.');
                }, 2000);
              } else {
                console.warn('⚠️ Sync completed but no cards were created, treating as partial success');
                setLoadingMessage('Connection established');
                setLoadingSubMessage('Card setup may take a moment to complete...');
                
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  onSuccess?.();
                }, 1200);
              }
              
            } else {
              const syncError = await syncResponse.json();
              console.warn('⚠️ Sync had issues but card is connected:', syncError);
              console.warn('⚠️ Sync response status:', syncResponse.status);
              console.warn('⚠️ Full sync error details:', JSON.stringify(syncError, null, 2));
              
              // Check if it's the orphaned item error
              if (syncError.message?.includes('not found') || syncError.message?.includes('Cannot coerce')) {
                console.error('🚨 ORPHANED ITEM ERROR - Database timing issue detected');
                setLoadingMessage('Finalizing card setup');
                setLoadingSubMessage('Card is ready, completing final steps...');
                
                // Even with sync error, the card should be created from syncAccounts
                // Just show the card without full transaction sync
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  onSuccess?.();
                }, 1000);
                return;
              }
              
              // Check if it's just rate limits vs real connection failure
              const hasRateLimit = syncError.results?.some((r: any) => 
                r.error?.toLowerCase().includes('rate limit')
              );
              
              if (hasRateLimit) {
                setLoadingMessage('Card connected with rate limits');
                setLoadingSubMessage('Card is ready, transaction history may be limited');
              } else {
                setLoadingMessage('Card connected with sync issues');
                setLoadingSubMessage('Card is available, some data may sync later');
              }
              
              setTimeout(() => {
                setLoading(false);
                setSyncInProgress(false);
                onSuccess?.();
              }, 800);
            }
            
          } catch (syncError) {
            console.error('Sync request failed:', syncError);
            setLoadingMessage('Card connected');
            setLoadingSubMessage('Basic card info available, full sync will retry');
            
            setTimeout(() => {
              setLoading(false);
              setSyncInProgress(false);
              onSuccess?.();
            }, 1500);
          }
        } else {
          console.error('Token exchange failed:', data.error);
          setLoadingMessage('Connection failed');
          setLoadingSubMessage('Please try again');
          setTimeout(() => {
            setLoading(false);
          }, 2000);
        }
      } catch (error) {
        console.error('Error in Plaid Link success handler:', error);
        alert('Connection error. Please try again.');
        setLoading(false);
      } finally {
        setLinkToken(null); // Reset token
      }
    },
    onExit: (err, metadata) => {
      console.log('Plaid Link exit:', { err, metadata });
      setLoading(false);
      setLinkToken(null); // Reset token
    },
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && ready && open) {
      console.log('Opening Plaid Link with token:', linkToken.substring(0, 20) + '...');
      // Small delay to ensure loading overlay is visible before Plaid modal opens
      setTimeout(() => {
        open();
      }, 500);
    }
  }, [linkToken, ready, open]);

  const handleClick = async () => {
    if (!session?.user?.id) {
      console.error('User not authenticated');
      alert('Please sign in to connect your credit card.');
      return;
    }

    try {
      setLoading(true);
      setLoadingMessage('Initializing secure connection');
      setLoadingSubMessage('Preparing Plaid Link...');
      console.log('Fetching link token...');
      
      const response = await fetch('/api/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();
      console.log('Link token response:', data);
      
      if (data.link_token) {
        console.log('Link token received, setting state...');
        setLoadingMessage('Opening Plaid');
        setLoadingSubMessage('Redirecting to secure banking portal...');
        // Brief delay to show the loading animation before opening
        setTimeout(() => {
          setLinkToken(data.link_token);
        }, 300);
        // The useEffect will handle opening the link
      } else {
        console.error('Failed to get link token:', data.error);
        alert('Failed to initialize Plaid connection. Please try again.');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error getting link token:', error);
      alert('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <>
      <LoadingOverlay 
        isVisible={loading} 
        message={loadingMessage}
        subMessage={loadingSubMessage}
      />
      <button
        onClick={handleClick}
        disabled={loading || !session}
        className={`font-medium py-3 px-4 rounded-lg transition-all duration-200 inline-flex items-center justify-center space-x-2 transform focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
          loading 
            ? 'bg-indigo-400 cursor-not-allowed opacity-75' 
            : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg hover:scale-[1.02]'
        }`}
      >
        <CreditCard className="h-4 w-4 text-white" />
        <span className="text-white text-sm sm:text-base">
          {loading ? 'Connecting...' : 'Connect Card'}
        </span>
      </button>
    </>
  );
}