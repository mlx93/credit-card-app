'use client';

import { usePlaidLink } from 'react-plaid-link';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';

interface PlaidLinkProps {
  onSuccess?: () => void;
}

export function PlaidLink({ onSuccess }: PlaidLinkProps) {
  const { data: session } = useSession();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    env: process.env.NEXT_PUBLIC_PLAID_ENV as 'sandbox' | 'development' | 'production' || 'production',
    // Additional configurations for sandbox
    product: ['liabilities', 'transactions'],
    onSuccess: async (public_token, metadata) => {
      try {
        console.log('Plaid Link success:', { public_token, metadata });
        
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        });

        const data = await response.json();
        
        if (data.success) {
          console.log('Token exchange successful');
          
          // Sync data after successful connection
          await fetch('/api/sync', {
            method: 'POST',
          });
          
          onSuccess?.();
        } else {
          console.error('Token exchange failed:', data.error);
          alert('Failed to connect account. Please try again.');
        }
      } catch (error) {
        console.error('Error in Plaid Link success handler:', error);
        alert('Connection error. Please try again.');
      } finally {
        setLoading(false);
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
      open();
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
      console.log('Fetching link token...');
      
      const response = await fetch('/api/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();
      console.log('Link token response:', data);
      
      if (data.link_token) {
        console.log('Link token received, setting state...');
        setLinkToken(data.link_token);
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
    <button
      onClick={handleClick}
      disabled={loading || !session}
      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Connecting...</span>
        </>
      ) : (
        <>
          <CreditCard className="h-4 w-4" />
          <span>Connect Credit Card with Plaid</span>
        </>
      )}
    </button>
  );
}