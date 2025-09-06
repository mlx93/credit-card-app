'use client';

import { usePlaidLink } from 'react-plaid-link';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { LoadingOverlay } from './LoadingOverlay';

interface RobinhoodLinkProps {
  onSuccess?: (ctx?: { itemId?: string; newCardIds?: string[] }) => Promise<void> | void;
}

export function RobinhoodLink({ onSuccess }: RobinhoodLinkProps) {
  const { data: session } = useSession();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Connecting to Robinhood');
  const [loadingSubMessage, setLoadingSubMessage] = useState('This may take a few moments...');

  const { open, ready } = usePlaidLink({
    token: linkToken,
    env: process.env.NEXT_PUBLIC_PLAID_ENV as 'sandbox' | 'development' | 'production' || 'production',
    onSuccess: async (public_token, metadata) => {
      try {
        console.log('Robinhood Plaid Link success:', { public_token, metadata });
        setLoadingMessage('Exchanging tokens');
        setLoadingSubMessage('Securing your Robinhood connection...');
        
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        });

        const data = await response.json();
        
        if (data.success) {
          console.log('Token exchange successful for Robinhood, itemId:', data.itemId);
          setLoadingMessage('Loading Robinhood Gold Card');
          setLoadingSubMessage('Processing your credit card data...');
          
          // Sync the Robinhood account
          const syncResponse = await fetch('/api/plaid/instant-card-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: data.itemId }),
          });
          
          if (syncResponse.ok) {
            const syncData = await syncResponse.json();
            console.log('✅ Robinhood card setup completed:', syncData);
          }
          
          if (onSuccess) {
            await onSuccess({ itemId: data.itemId });
          }
          
          setLoading(false);
        } else {
          console.error('Token exchange failed:', data.error);
          setLoadingMessage('Connection failed');
          setLoadingSubMessage('Please try again');
          setTimeout(() => {
            setLoading(false);
          }, 2000);
        }
      } catch (error) {
        console.error('Error in Robinhood Link success handler:', error);
        alert('Connection error. Please try again.');
        setLoading(false);
      } finally {
        setLinkToken(null);
      }
    },
    onExit: (err, metadata) => {
      console.log('Robinhood Link exit:', { err, metadata });
      setLoading(false);
      setLinkToken(null);
    },
  });

  // Auto-open when token is ready
  useEffect(() => {
    if (linkToken && ready && open) {
      console.log('Opening Robinhood Plaid Link...');
      setTimeout(() => {
        open();
      }, 500);
    }
  }, [linkToken, ready, open]);

  const handleClick = async () => {
    if (!session?.user?.id) {
      console.error('User not authenticated');
      alert('Please sign in to connect your Robinhood Gold Card.');
      return;
    }

    try {
      setLoading(true);
      setLoadingMessage('Initializing Robinhood connection');
      setLoadingSubMessage('Preparing secure link...');
      
      console.log('Fetching Robinhood-specific link token...');
      
      // Request link token specifically for Robinhood (ins_54)
      const response = await fetch('/api/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutionId: 'ins_54' }),
      });

      const data = await response.json();
      console.log('Robinhood link token response:', data);
      
      if (data.link_token) {
        console.log('Robinhood link token received');
        setLoadingMessage('Opening Robinhood connection');
        setLoadingSubMessage('Redirecting to authentication...');
        setTimeout(() => {
          setLinkToken(data.link_token);
        }, 300);
      } else {
        console.error('Failed to get Robinhood link token:', data.error);
        alert('Failed to initialize Robinhood connection. Please try again.');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error getting Robinhood link token:', error);
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
        className={`font-medium py-3 px-4 rounded-lg transition-all duration-200 inline-flex items-center justify-center space-x-2 transform focus:outline-none focus:ring-2 focus:ring-green-500/50 ${
          loading 
            ? 'bg-green-400 cursor-not-allowed opacity-75' 
            : 'bg-green-600 hover:bg-green-700 hover:shadow-lg hover:scale-[1.02]'
        }`}
      >
        <span className="text-white font-bold">R</span>
        <span className="text-white text-sm sm:text-base">
          {loading ? 'Connecting...' : 'Connect Robinhood'}
        </span>
      </button>
    </>
  );
}