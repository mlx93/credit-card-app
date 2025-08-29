'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Calendar, DollarSign, TrendingUp, RefreshCw, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/utils/format';
import { CardBillingCycles } from '@/components/CardBillingCycles';
import { DueDateCard, DueDateCards } from '@/components/DueDateCard';
import { PlaidLink } from '@/components/PlaidLink';
import { LoadingOverlay } from '@/components/LoadingOverlay';

interface DashboardContentProps {
  isLoggedIn: boolean;
}

export function DashboardContent({ isLoggedIn }: DashboardContentProps) {
  const [creditCards, setCreditCards] = useState<any[]>([]);
  const [billingCycles, setBillingCycles] = useState<any[]>([]);
  const [currentMonthTransactions, setCurrentMonthTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sharedCardOrder, setSharedCardOrder] = useState<string[]>([]);

  // Create consistent default card ordering based on due dates and card names
  const getDefaultCardOrder = (cards: any[]): string[] => {
    return cards
      .slice() // Create a copy to avoid mutating original array
      .sort((a, b) => {
        // Primary sort: by next payment due date (earliest first)
        const aDate = a.nextPaymentDueDate ? new Date(a.nextPaymentDueDate) : new Date('2099-12-31');
        const bDate = b.nextPaymentDueDate ? new Date(b.nextPaymentDueDate) : new Date('2099-12-31');
        
        if (aDate.getTime() !== bDate.getTime()) {
          return aDate.getTime() - bDate.getTime();
        }
        
        // Secondary sort: by card name (alphabetical)
        return a.name.localeCompare(b.name);
      })
      .map(card => card.id);
  };

  const mockCards = [
    {
      id: '1',
      name: 'Chase Sapphire Preferred',
      mask: '1234',
      balanceCurrent: -2450.75,
      balanceLimit: 15000,
      nextPaymentDueDate: new Date('2024-02-15'),
      minimumPaymentAmount: 125.00,
    },
    {
      id: '2', 
      name: 'Capital One Venture',
      mask: '5678',
      balanceCurrent: -895.42,
      balanceLimit: 10000,
      nextPaymentDueDate: new Date('2024-02-20'),
      minimumPaymentAmount: 45.00,
    },
  ];

  const mockCycles = [
    {
      id: '1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: new Date('2024-01-16'),
      endDate: new Date('2024-02-15'),
      totalSpend: 1850.25,
      transactionCount: 23,
      dueDate: new Date('2024-03-05'),
    },
    {
      id: '2',
      creditCardName: 'Capital One Venture', 
      startDate: new Date('2024-01-20'),
      endDate: new Date('2024-02-20'),
      totalSpend: 642.18,
      transactionCount: 15,
      dueDate: new Date('2024-03-10'),
    },
  ];

  const fetchUserData = async () => {
    if (!isLoggedIn) return;
    
    try {
      setLoading(true);
      
      // Get current month date range
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      
      const [creditCardsRes, billingCyclesRes, transactionsRes] = await Promise.all([
        fetch('/api/user/credit-cards'),
        fetch('/api/user/billing-cycles'),
        fetch(`/api/user/transactions?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}&limit=1000`),
      ]);

      if (creditCardsRes.ok) {
        const { creditCards: cards } = await creditCardsRes.json();
        setCreditCards(cards);
        
        // Set default shared card order if it hasn't been set yet (first load)
        if (sharedCardOrder.length === 0 && cards.length > 0) {
          const defaultOrder = getDefaultCardOrder(cards);
          setSharedCardOrder(defaultOrder);
          console.log('Setting default card order:', {
            cardCount: cards.length,
            defaultOrder,
            cardNames: defaultOrder.map(id => cards.find(c => c.id === id)?.name)
          });
        }
      }

      if (billingCyclesRes.ok) {
        const { billingCycles: cycles } = await billingCyclesRes.json();
        setBillingCycles(cycles);
      }

      if (transactionsRes.ok) {
        const { transactions } = await transactionsRes.json();
        setCurrentMonthTransactions(transactions);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    console.log('=== HANDLEREFRESH CALLED ===');
    setRefreshing(true);
    try {
      console.log('=== FRONTEND: Starting refresh process ===');
      console.log('Calling /api/sync...');
      
      const syncResponse = await fetch('/api/sync', { method: 'POST' });
      console.log('Sync API response status:', syncResponse.status);
      
      if (!syncResponse.ok) {
        console.error('Sync API failed with status:', syncResponse.status);
        const errorText = await syncResponse.text();
        console.error('Sync API error response:', errorText);
        throw new Error(`Sync API failed: ${syncResponse.status}`);
      }
      
      const syncResult = await syncResponse.json();
      console.log('Sync API success result:', syncResult);
      
      // Check if any connections require reconnection
      const needsReconnection = syncResult.results?.some((result: any) => result.requiresReconnection);
      const autoReconnectAvailable = syncResult.results?.some((result: any) => result.canAutoReconnect);
      
      if (needsReconnection) {
        console.log('⚠️ Some connections need to be reconnected');
        
        if (autoReconnectAvailable) {
          console.log('🔄 Auto-reconnection available, triggering reconnect flow...');
          // Auto-trigger reconnection for expired cards
          const expiredResults = syncResult.results?.filter((result: any) => result.requiresReconnection) || [];
          
          for (const expiredResult of expiredResults) {
            console.log(`Auto-reconnecting ${expiredResult.itemId}...`);
            try {
              await handleCardReconnect(expiredResult.itemId);
            } catch (error) {
              console.error(`Auto-reconnection failed for ${expiredResult.itemId}:`, error);
            }
          }
        } else {
          alert('Some of your bank connections have expired and need to be reconnected. Please use the reconnect buttons on your cards or add them again with "Connect Credit Cards".');
        }
      }
      
      console.log('Fetching user data after sync...');
      await fetchUserData();
      console.log('=== FRONTEND: Refresh process completed ===');
    } catch (error) {
      console.error('=== FRONTEND: Error refreshing data ===', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleCardSync = async (itemId: string) => {
    try {
      const response = await fetch('/api/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      
      if (response.ok) {
        await fetchUserData(); // Refresh data after sync
        console.log('Card sync successful');
      } else {
        console.error('Card sync failed:', response.status);
        alert('Failed to sync card data. Please try again.');
      }
    } catch (error) {
      console.error('Error syncing card:', error);
      alert('Network error during sync. Please try again.');
    }
  };

  const handleCardReconnect = async (itemId: string) => {
    try {
      console.log(`🔄 Creating update link token for reconnection: ${itemId}`);
      
      const response = await fetch('/api/plaid/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      
      const data = await response.json();
      
      if (data.success && data.link_token) {
        console.log(`✅ Update link token created for ${data.institution_name}`);
        
        // Create a temporary PlaidLink for reconnection
        await openReconnectionFlow(data.link_token, data.institution_name, itemId);
      } else {
        console.error('Failed to create reconnection link:', data.error);
        alert('Failed to create reconnection link. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error creating reconnection link:', error);
      alert('Network error. Please try again.');
    }
  };

  // Function to handle reconnection flow with Plaid Link
  const openReconnectionFlow = async (updateLinkToken: string, institutionName: string, itemId: string) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        console.log(`🔗 Opening Plaid Link for ${institutionName} reconnection...`);
        console.log('🔗 Initializing Plaid Link update flow...');
        
        // Dynamically import Plaid Link for the update flow
        const { usePlaidLink } = await import('react-plaid-link');
        
        // For now, open in new window with proper callback handling
        const proceed = window.confirm(
          `Your ${institutionName} connection has expired and needs to be reconnected.\n\n` +
          `Click OK to open the secure reconnection flow.`
        );
        
        if (proceed) {
          console.log(`🚀 Opening Plaid Link update for ${institutionName}...`);
          
          // Open the Plaid Link update URL
          const updateUrl = `https://link.plaid.com/update?link_token=${updateLinkToken}`;
          
          const updateWindow = window.open(
            updateUrl,
            'plaid-update',
            'width=600,height=700,scrollbars=yes,resizable=yes'
          );
          
          if (!updateWindow) {
            alert('Please allow popups for this site to enable reconnection.');
            reject(new Error('Popup blocked'));
            return;
          }
          
          console.log('📱 Plaid update window opened, waiting for completion...');
          
          // Monitor for completion
          const checkComplete = setInterval(async () => {
            try {
              if (updateWindow.closed) {
                clearInterval(checkComplete);
                console.log('🔄 Update window closed, verifying connection...');
                
                // Wait a moment for Plaid to process, then test the connection
                setTimeout(async () => {
                  console.log('🧪 Testing connection after update...');
                  
                  try {
                    // Test if the connection now works by trying a simple API call
                    const testResponse = await fetch('/api/debug/plaid-status');
                    const testData = await testResponse.json();
                    
                    // Check if this specific item now has fewer errors
                    const updatedItem = testData.items?.find((item: any) => 
                      item.itemId === itemId || item.institutionName === institutionName
                    );
                    
                    if (updatedItem && updatedItem.status === 'active') {
                      console.log(`✅ ${institutionName} reconnection successful!`);
                      
                      // Trigger a full refresh to get fresh data
                      await handleRefresh();
                      
                      alert(`✅ ${institutionName} has been successfully reconnected!`);
                    } else {
                      console.log(`⚠️ ${institutionName} may still have connection issues`);
                      
                      // Still refresh to check
                      await handleRefresh();
                    }
                    
                    resolve();
                  } catch (testError) {
                    console.error('Error testing connection after update:', testError);
                    // Still refresh and resolve
                    await handleRefresh();
                    resolve();
                  }
                }, 3000); // Give Plaid 3 seconds to process
              }
            } catch (error) {
              console.error('Error checking update completion:', error);
            }
          }, 1000);
          
          // Timeout after 10 minutes
          setTimeout(() => {
            clearInterval(checkComplete);
            if (!updateWindow.closed) {
              updateWindow.close();
              console.log('🕐 Reconnection timed out after 10 minutes');
            }
            resolve(); // Don't reject on timeout, just resolve
          }, 600000);
        } else {
          console.log('❌ User cancelled reconnection');
          resolve();
        }
      } catch (error) {
        console.error('Error in reconnection flow:', error);
        reject(error);
      }
    });
  };

  const handleCardRemove = async (itemId: string) => {
    const confirmed = window.confirm(
      'Are you sure you want to remove this credit card connection? This will delete all associated data and cannot be undone.'
    );
    
    if (!confirmed) return;

    try {
      const response = await fetch('/api/plaid/remove-connection', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        await fetchUserData(); // Refresh data after removal
        alert(data.message);
      } else {
        console.error('Failed to remove connection:', data.error);
        alert('Failed to remove connection. Please try again.');
      }
    } catch (error) {
      console.error('Error removing connection:', error);
      alert('Network error. Please try again.');
    }
  };

  // Check connection health on initial load and auto-fix if possible
  const checkConnectionHealth = async () => {
    if (!isLoggedIn) return;

    try {
      const response = await fetch('/api/user/credit-cards');
      if (response.ok) {
        const { creditCards: cards } = await response.json();
        const expiredConnections = cards.filter((card: any) => 
          card.plaidItem && ['expired', 'error'].includes(card.plaidItem.status)
        );

        if (expiredConnections.length > 0) {
          console.log(`⚠️ ${expiredConnections.length} expired connections detected on page load`);
          
          // Auto-trigger refresh to try to reconnect expired connections
          console.log('🔄 Auto-triggering refresh to reconnect expired connections...');
          
          // Wait a moment for the page to fully load, then trigger refresh
          setTimeout(async () => {
            console.log('🔄 Starting auto-refresh for expired connections...');
            await handleRefresh();
          }, 2000); // 2 second delay to let page load complete
        }
      }
    } catch (error) {
      console.error('Error checking connection health:', error);
    }
  };

  useEffect(() => {
    fetchUserData();
    // Check connection health after initial data load
    setTimeout(checkConnectionHealth, 1000);
  }, [isLoggedIn]);

  // Set default order for mock cards when not logged in
  useEffect(() => {
    if (!isLoggedIn && sharedCardOrder.length === 0 && mockCards.length > 0) {
      const defaultOrder = getDefaultCardOrder(mockCards);
      setSharedCardOrder(defaultOrder);
      console.log('Setting default mock card order:', {
        cardCount: mockCards.length,
        defaultOrder,
        cardNames: defaultOrder.map(id => mockCards.find(c => c.id === id)?.name)
      });
    }
  }, [isLoggedIn]);

  const displayCards = isLoggedIn ? creditCards : mockCards;
  const displayCycles = isLoggedIn ? billingCycles : mockCycles;
  
  // Calculate actual current month spending from transactions
  const totalSpendThisMonth = (() => {
    if (!isLoggedIn) {
      // For mock data, show sum of all cycle spending
      return displayCycles.reduce((sum, cycle) => sum + cycle.totalSpend, 0);
    }
    
    // For real data, sum all transaction amounts from current month
    // Transaction amounts are positive for purchases/spending
    return currentMonthTransactions.reduce((sum, transaction) => {
      // Only include positive amounts (spending), exclude payments/credits
      return transaction.amount > 0 ? sum + transaction.amount : sum;
    }, 0);
  })();
  const totalBalance = displayCards.reduce((sum, card) => 
    sum + Math.abs(card.balanceCurrent || 0), 0
  );
  const averageUtilization = (() => {
    const cardsWithLimits = displayCards.filter(card => {
      const limit = card.balanceLimit;
      return limit && limit > 0 && isFinite(limit);
    });
    
    if (cardsWithLimits.length === 0) return 0;
    
    return cardsWithLimits.reduce((sum, card) => {
      const balance = Math.abs(card.balanceCurrent || 0);
      const limit = card.balanceLimit!;
      return sum + (balance / limit) * 100;
    }, 0) / cardsWithLimits.length;
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        {/* Header with title and Quick Actions side by side */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-1">Credit Card Dashboard</h1>
            <p className="text-gray-600 text-sm">
              {isLoggedIn 
                ? 'Track your spending, due dates, and credit utilization' 
                : 'Sign in to connect your credit cards and see real data'
              }
            </p>
          </div>
          
          {/* Quick Actions - horizontal on same line as title */}
          <div className="flex items-center space-x-3">
            {isLoggedIn ? (
              <>
                <PlaidLink onSuccess={fetchUserData} />
                <button 
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-900 font-medium py-2 px-4 rounded-lg transition-colors flex items-center space-x-2 text-sm whitespace-nowrap"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>{refreshing ? 'Refreshing...' : 'Refresh All Data'}</span>
                </button>
              </>
            ) : (
              <div className="text-center py-2">
                <p className="text-gray-600 text-xs">Sign in to connect cards</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Full-width Header Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <TrendingUp className="h-7 w-7 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">This Month's Spend</p>
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalSpendThisMonth)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <DollarSign className="h-7 w-7 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Balance</p>
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalBalance)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <CreditCard className="h-7 w-7 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active Cards</p>
                <p className="text-xl font-semibold text-gray-900">{displayCards.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <Calendar className="h-7 w-7 text-orange-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Utilization</p>
                <p className="text-xl font-semibold text-gray-900">{averageUtilization.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>

        {!isLoggedIn && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              <strong>Demo Mode:</strong> This is sample data. Sign in to connect your real credit cards.
            </p>
          </div>
        )}

        {isLoggedIn && loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Loading your credit card data...</h3>
              <p className="text-gray-600">Please wait while we fetch your latest information</p>
            </div>
          </div>
        )}

        {(!isLoggedIn || !loading) && (
          <>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Billing Cycles</h2>
            {loading ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500">Loading billing cycles...</p>
              </div>
            ) : displayCycles.length > 0 ? (
              <CardBillingCycles 
                cycles={displayCycles} 
                cards={displayCards} 
                cardOrder={sharedCardOrder} 
              />
            ) : isLoggedIn ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500 text-center">No billing cycles found. Connect a credit card to get started.</p>
              </div>
            ) : null}
          </div>

          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Upcoming Due Dates</h2>
            {loading ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500">Loading credit cards...</p>
              </div>
            ) : displayCards.length > 0 ? (
              <DueDateCards 
                cards={displayCards}
                onSync={handleCardSync}
                onReconnect={handleCardReconnect}
                onRemove={handleCardRemove}
                initialCardOrder={sharedCardOrder}
                onOrderChange={setSharedCardOrder}
              />
            ) : isLoggedIn ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500 text-center">No credit cards connected yet.</p>
              </div>
            ) : null}
          </div>
        </div>

          </>
        )}
      </div>
      
      {/* Full-page loading overlay during refresh */}
      <LoadingOverlay 
        isVisible={refreshing}
        message="Refreshing Your Data"
        subMessage="Syncing credit cards and transactions..."
      />
    </div>
  );
}