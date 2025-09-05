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
  const [initialCardCount, setInitialCardCount] = useState<number>(0);

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
    // Try embedded mode to avoid OAuth configuration issues
    // receivedRedirectUri: 'https://www.cardcycle.app/api/plaid/callback',
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
          
          // Use instant card setup for immediate visibility
          console.log('⚡ Starting instant card setup for itemId:', data.itemId);
          setLoadingMessage('Setting up your card');
          setLoadingSubMessage('Creating card with Recent Billing Cycles...');
          
          try {
            // Add timeout to instant-card-setup request (60 seconds)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            
            const syncResponse = await fetch('/api/plaid/instant-card-setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId: data.itemId }),
              signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (syncResponse.ok) {
              const syncData = await syncResponse.json();
              console.log('✅ Instant card setup completed successfully:', syncData);
              
              // Check if instant setup found credit cards
              if (syncData.success && syncData.creditCardsFound > 0 && syncData.readyForDisplay) {
                console.log('✅ Verified: Cards are ready for immediate display with Recent Billing Cycles');
                
                if (syncData.recentCyclesCalculated > 0) {
                  setLoadingMessage('Card ready with Recent Billing Cycles!');
                } else {
                  setLoadingMessage('Card ready!');
                }
                if (syncData.recentCyclesCalculated > 0) {
                  setLoadingSubMessage('Your credit card is now available with Recent Billing Cycles! Full history loading in background.');
                } else {
                  setLoadingSubMessage('Your credit card is now available! Recent Billing Cycles will load shortly.');
                }
                
                // Poll the database until the new card AND Recent Billing Cycles are available  
                const pollForNewCardWithCycles = async () => {
                  let attempts = 0;
                  const maxAttempts = 30; // Extended to 30 seconds to wait for Recent Billing Cycles
                  
                  while (attempts < maxAttempts) {
                    try {
                      console.log(`🔍 Polling attempt ${attempts + 1} for new card with Recent Billing Cycles...`);
                      
                      const [cardResponse, cyclesResponse] = await Promise.all([
                        fetch('/api/user/credit-cards', {
                          cache: 'no-store',
                          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
                        }),
                        fetch('/api/user/billing-cycles', {
                          cache: 'no-store',
                          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
                        })
                      ]);
                      
                      if (cardResponse.ok && cyclesResponse.ok) {
                        const { creditCards } = await cardResponse.json();
                        const { billingCycles } = await cyclesResponse.json();
                        const currentCardCount = creditCards?.length || 0;
                        
                        console.log(`📊 Polling check: initial=${initialCardCount}, current=${currentCardCount}, cycles=${billingCycles?.length || 0}`);
                        
                        // Check if we have MORE cards than we started with
                        if (currentCardCount > initialCardCount) {
                          // Find the new cards
                          const newCards = creditCards.filter(card => 
                            !creditCards.slice(0, initialCardCount).some(existingCard => 
                              existingCard.id === card.id
                            )
                          );
                          
                          // Check if the new cards have Recent Billing Cycles
                          const newCardIds = newCards.map(c => c.id);
                          const cyclesForNewCards = (billingCycles || []).filter(cycle => 
                            newCardIds.includes(cycle.creditCardId)
                          );
                          
                          if (cyclesForNewCards.length > 0) {
                            console.log(`✅ New card with Recent Billing Cycles confirmed! ${newCards.length} cards, ${cyclesForNewCards.length} cycles`);
                          } else if (syncData.recentCyclesCalculated === 0) {
                            // If instant setup didn't calculate cycles, proceed anyway
                            console.log('✅ New card confirmed (no Recent Billing Cycles expected from instant setup)');
                          } else {
                            console.log(`⏳ New card found but waiting for Recent Billing Cycles... (expected ${syncData.recentCyclesCalculated}, found ${cyclesForNewCards.length})`);
                            attempts++;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                          }
                          setLoadingMessage('Card ready!');
                          setLoadingSubMessage('Your new credit card is available! Full transaction history will load in background.');
                          
                          // Immediately hide loading and call onSuccess - no artificial delay
                          console.log('🎯 PlaidLink: Database confirmed new card - calling onSuccess callback immediately');
                          setLoading(false);
                          setSyncInProgress(false);
                          
                          // Call the Dashboard's refresh function immediately
                          if (onSuccess) {
                            onSuccess();
                          }
                          return;
                        } else {
                          console.log(`⏳ Still waiting... need ${initialCardCount + 1} cards, have ${currentCardCount}`);
                        }
                      }
                      
                      attempts++;
                      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between polls
                      
                    } catch (error) {
                      console.error('Error polling for new card:', error);
                      attempts++;
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                  }
                  
                  // Fallback if polling times out - proceed immediately
                  console.warn('⚠️ Polling timeout - calling onSuccess immediately');
                  setLoadingMessage('Card should be ready...');
                  setLoadingSubMessage('Loading your dashboard');
                  setLoading(false);
                  setSyncInProgress(false);
                  if (onSuccess) {
                    onSuccess();
                  }
                };
                
                pollForNewCardWithCycles();
              } else if (syncData.error === 'OAUTH_INVALID_TOKEN' || syncData.requiresReauth) {
                console.warn('⚠️ OAuth authentication required');
                console.warn('⚠️ Instant setup response:', syncData);
                setLoadingMessage('Re-authentication Required');
                setLoadingSubMessage('Please reconnect your account to continue');
                
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  alert('Your bank requires re-authentication. The connection was successful, but you may need to reconnect for full functionality. Please refresh the page and try again.');
                }, 3000);
              } else {
                console.warn('⚠️ No credit cards found at connected institution');
                console.warn('⚠️ Instant setup response:', syncData);
                setLoadingMessage('No credit cards found');
                setLoadingSubMessage('This institution may not have credit card accounts available');
                
                setTimeout(() => {
                  setLoading(false);
                  setSyncInProgress(false);
                  alert('No credit cards were found at this institution. You may have connected a bank account instead of a credit card account, or this institution may not support credit card data through Plaid.');
                }, 2000);
              }
              
            } else {
              const syncError = await syncResponse.json();
              console.warn('⚠️ Instant setup had issues:', syncError);
              console.warn('⚠️ Response status:', syncResponse.status);
              
              setLoadingMessage('Connection established');
              setLoadingSubMessage('Card will appear shortly...');
              
              // Proceed immediately even if instant setup had issues
              setLoading(false);
              setSyncInProgress(false);
              
              // Call onSuccess to show what we have
              console.log('🎯 PlaidLink: Instant setup had issues, calling onSuccess to check results...');
              if (onSuccess) {
                onSuccess();
              }
            }
            
          } catch (syncError) {
            console.error('Sync request failed:', syncError);
            
            if (syncError.name === 'AbortError') {
              console.error('⏰ Instant card setup timed out after 60 seconds');
              setLoadingMessage('Setup taking longer than expected');
              setLoadingSubMessage('Card may appear shortly, or try refreshing...');
            } else {
              setLoadingMessage('Card connected');
              setLoadingSubMessage('Basic card info available, full sync will retry');
            }
            
            // Proceed immediately even if sync failed
            setLoading(false);
            setSyncInProgress(false);
            
            // Call onSuccess to show new card
            console.log('🎯 PlaidLink: Card connected (sync failed), calling onSuccess...');
            if (onSuccess) {
              onSuccess();
            }
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

  // Auto-open Plaid Link when token is ready (embedded mode)
  useEffect(() => {
    if (linkToken && ready && open) {
      console.log('Opening Plaid Link in embedded mode with token:', linkToken.substring(0, 20) + '...');
      
      // In embedded mode, this opens the Plaid modal/popup
      try {
        setTimeout(() => {
          console.log('Triggering Plaid Link embedded flow...');
          open();
        }, 500);
      } catch (error) {
        console.error('Error opening Plaid Link in embedded mode:', error);
        setLoading(false);
        alert('Failed to start connection flow. Please try again.');
      }
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
      
      // Capture initial card count before starting
      console.log('📊 Capturing initial card count...');
      try {
        const cardCountResponse = await fetch('/api/user/credit-cards', { cache: 'no-store' });
        if (cardCountResponse.ok) {
          const { creditCards } = await cardCountResponse.json();
          setInitialCardCount(creditCards?.length || 0);
          console.log('📊 Initial card count:', creditCards?.length || 0);
        }
      } catch (error) {
        console.warn('Could not fetch initial card count, defaulting to 0');
        setInitialCardCount(0);
      }
      
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
