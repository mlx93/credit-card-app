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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      
      const [creditCardsRes, billingCyclesRes] = await Promise.all([
        fetch('/api/user/credit-cards'),
        fetch('/api/user/billing-cycles'),
      ]);

      if (creditCardsRes.ok) {
        const { creditCards: cards } = await creditCardsRes.json();
        setCreditCards(cards);
      }

      if (billingCyclesRes.ok) {
        const { billingCycles: cycles } = await billingCyclesRes.json();
        setBillingCycles(cycles);
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
      const response = await fetch('/api/plaid/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      
      const data = await response.json();
      
      if (data.success && data.link_token) {
        // Use Plaid Link to handle the reconnection
        // For now, just alert the user - we'd need to integrate with PlaidLink component
        alert(`Reconnection link created for ${data.institution_name}. Feature coming soon!`);
      } else {
        console.error('Failed to create reconnection link:', data.error);
        alert('Failed to create reconnection link. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error creating reconnection link:', error);
      alert('Network error. Please try again.');
    }
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

  useEffect(() => {
    fetchUserData();
  }, [isLoggedIn]);

  const displayCards = isLoggedIn ? creditCards : mockCards;
  const displayCycles = isLoggedIn ? billingCycles : mockCycles;
  
  // Calculate actual current month spending from transactions
  const totalSpendThisMonth = (() => {
    if (!isLoggedIn) return displayCycles.reduce((sum, cycle) => sum + cycle.totalSpend, 0);
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    // Find current month cycle (cycle that includes current date)
    const currentCycle = displayCycles.find(cycle => {
      const cycleStart = new Date(cycle.startDate);
      const cycleEnd = new Date(cycle.endDate);
      const now = new Date();
      return now >= cycleStart && now <= cycleEnd;
    });
    
    return currentCycle ? currentCycle.totalSpend : 0;
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
                <button 
                  onClick={async () => {
                    console.log('Regenerate Cycles button clicked - starting...');
                    try {
                      const response = await fetch('/api/debug/regenerate-cycles', { method: 'POST' });
                      const result = await response.json();
                      
                      if (response.ok) {
                        console.log('Regenerate Cycles SUCCESS:', result);
                        await fetchUserData();
                        console.log('Historical cycles should be restored');
                      } else {
                        console.error('Regenerate Cycles FAILED:', response.status, result);
                      }
                    } catch (error) {
                      console.error('Regenerate Cycles ERROR:', error);
                    }
                  }}
                  className="bg-purple-100 hover:bg-purple-200 text-purple-900 font-medium py-2 px-4 rounded-lg transition-colors text-sm whitespace-nowrap"
                >
                  Rebuild Cycles
                </button>
                <button 
                  onClick={async () => {
                    console.log('Capital One Debug Sync button clicked - starting...');
                    try {
                      const response = await fetch('/api/debug/capital-one-sync', { method: 'POST' });
                      const result = await response.json();
                      
                      if (response.ok) {
                        console.log('Capital One Debug SUCCESS:', result);
                        await fetchUserData();
                        console.log('Check console for detailed Capital One sync process');
                      } else {
                        console.error('Capital One Debug FAILED:', response.status, result);
                      }
                    } catch (error) {
                      console.error('Capital One Debug ERROR:', error);
                    }
                  }}
                  className="bg-red-100 hover:bg-red-200 text-red-900 font-medium py-2 px-4 rounded-lg transition-colors text-sm whitespace-nowrap"
                >
                  Debug Capital One
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
              <CardBillingCycles cycles={displayCycles} cards={displayCards} />
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