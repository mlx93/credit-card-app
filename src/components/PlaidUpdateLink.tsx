'use client';

import { usePlaidLink } from 'react-plaid-link';
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface PlaidUpdateLinkProps {
  linkToken: string;
  institutionName: string;
  itemId: string;
  onSuccess: () => void;
  onExit: () => void;
}

export function PlaidUpdateLink({ 
  linkToken, 
  institutionName, 
  itemId, 
  onSuccess, 
  onExit 
}: PlaidUpdateLinkProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  console.log(`🔗 PlaidUpdateLink initialized for ${institutionName} with token:`, linkToken?.substring(0, 20) + '...');

  const { open, ready, error: plaidError } = usePlaidLink({
    token: linkToken,
    env: process.env.NEXT_PUBLIC_PLAID_ENV as 'sandbox' | 'development' | 'production' || 'production',
    
    onSuccess: async (public_token, metadata) => {
      try {
        console.log(`✅ Plaid update success for ${institutionName}:`, { 
          public_token: public_token?.substring(0, 20) + '...',
          metadata 
        });
        
        setLoading(true);
        
        // Call our backend to handle the token update
        console.log('🔄 Exchanging updated public token for fresh access token...');
        
        const response = await fetch('/api/plaid/update-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            public_token,
            itemId,
            institutionName 
          }),
        });

        const data = await response.json();
        
        if (data.success) {
          console.log(`🎉 ${institutionName} connection successfully updated!`);
          onSuccess();
        } else {
          console.error(`❌ Failed to update ${institutionName} connection:`, data.error);
          setError(`Failed to update connection: ${data.error}`);
        }
        
      } catch (error) {
        console.error(`❌ Error updating ${institutionName} connection:`, error);
        setError(`Network error during connection update`);
      } finally {
        setLoading(false);
      }
    },
    
    onExit: (err, metadata) => {
      console.log(`🚪 User exited ${institutionName} update flow:`, { err, metadata });
      
      if (err != null) {
        console.error(`❌ Plaid update error for ${institutionName}:`, err);
        setError(`Connection update failed: ${err.error_message || err.display_message || 'Unknown error'}`);
      }
      
      onExit();
    },
    
    onEvent: (eventName, metadata) => {
      console.log(`📊 Plaid update event for ${institutionName}:`, eventName, metadata);
    },
  });

  // Auto-open when component mounts and is ready
  useEffect(() => {
    if (ready && !loading && !error) {
      console.log(`🚀 Auto-opening Plaid update for ${institutionName}...`);
      open();
    }
  }, [ready, open, loading, error, institutionName]);

  // Handle Plaid Link errors
  useEffect(() => {
    if (plaidError) {
      console.error(`❌ Plaid Link error for ${institutionName}:`, plaidError);
      setError(`Plaid Link error: ${plaidError.error_message}`);
    }
  }, [plaidError, institutionName]);

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Connection Update Failed</h3>
            <button 
              onClick={onExit}
              className="text-gray-400 hover:text-gray-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <p className="text-sm text-gray-600 mb-4">
            We couldn't update your {institutionName} connection:
          </p>
          
          <p className="text-sm text-red-600 mb-6 bg-red-50 p-3 rounded">
            {error}
          </p>
          
          <div className="flex space-x-3">
            <button
              onClick={() => {
                setError(null);
                if (ready) open();
              }}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700"
            >
              Try Again
            </button>
            <button
              onClick={onExit}
              className="flex-1 bg-gray-200 text-gray-900 py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Updating {institutionName} Connection
            </h3>
            <p className="text-sm text-gray-600">
              Securing your refreshed connection...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // The actual Plaid Link is invisible - it opens automatically when ready
  return null;
}