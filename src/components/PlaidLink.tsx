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

  const { open, ready } = usePlaidLink({
    token: linkToken,
    env: process.env.NEXT_PUBLIC_PLAID_ENV as 'sandbox' | 'development' | 'production' || 'production',
    // Additional configurations for sandbox
    product: ['liabilities', 'transactions'],
    // Disable guest mode - force real authentication
    selectAccount: true,
    receivedRedirectUri: null,
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
          console.log('Token exchange successful');
          setLoadingMessage('Syncing your accounts');
          setLoadingSubMessage('Fetching credit card information...');
          
          // Sync data after successful connection
          try {
            setSyncInProgress(true);
            setLoadingMessage('Syncing your data');
            setLoadingSubMessage('This may take up to 30 seconds...');
            
            const syncResponse = await fetch('/api/sync', {
              method: 'POST',
            });
            
            if (!syncResponse.ok) {
              const syncError = await syncResponse.json();
              console.error('Sync failed:', syncError);
              setLoadingMessage('Connected with sync warnings');
              setLoadingSubMessage('Account connected, some data may sync later');
              
              // Still show success after brief delay since connection succeeded
              setTimeout(() => {
                setLoading(false);
                setSyncInProgress(false);
                onSuccess?.();
              }, 2000);
            } else {
              const syncData = await syncResponse.json();
              console.log('Sync successful:', syncData);
              setLoadingMessage('Success!');
              setLoadingSubMessage('Your accounts have been connected and synced');
              
              // Brief delay to show success message, then complete
              setTimeout(() => {
                setLoading(false);
                setSyncInProgress(false);
                
                // Give the sync process time to complete billing cycle generation
                // before triggering the refresh
                setTimeout(() => {
                  onSuccess?.();
                }, 500);
              }, 1500);
            }
          } catch (syncError) {
            console.error('Sync request failed:', syncError);
            setLoadingMessage('Connected with sync issues');
            setLoadingSubMessage('Account connected, sync will retry automatically');
            
            // Still complete the flow since connection succeeded
            setTimeout(() => {
              setLoading(false);
              setSyncInProgress(false);
              onSuccess?.();
            }, 2000);
          }
        } else {
          console.error('Token exchange failed:', data.error);
          alert('Failed to connect account. Please try again.');
          setLoading(false);
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
        className={`w-full font-medium py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center space-x-2 transform focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
          loading 
            ? 'bg-indigo-400 cursor-not-allowed opacity-75' 
            : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg hover:scale-[1.02]'
        }`}
      >
        <CreditCard className="h-4 w-4 text-white" />
        <span className="text-white">
          {loading ? 'Connecting...' : 'Connect Credit Card with Plaid'}
        </span>
      </button>
    </>
  );
}