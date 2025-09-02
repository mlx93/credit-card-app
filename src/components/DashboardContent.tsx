'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Calendar, DollarSign, TrendingUp, RefreshCw, Loader2, CheckCircle } from 'lucide-react';
import { formatCurrency, formatPercentage } from '@/utils/format';
import { CardBillingCycles } from '@/components/CardBillingCycles';
import { DueDateCard, DueDateCards } from '@/components/DueDateCard';
import { HorizontalCardColumns } from '@/components/HorizontalCardColumns';
import { PlaidLink } from '@/components/PlaidLink';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { PlaidUpdateLink } from '@/components/PlaidUpdateLink';

interface DashboardContentProps {
  isLoggedIn: boolean;
}

export function DashboardContent({ isLoggedIn }: DashboardContentProps) {
  const [creditCards, setCreditCards] = useState<any[]>([]);
  const [billingCycles, setBillingCycles] = useState<any[]>([]);
  const [currentMonthTransactions, setCurrentMonthTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [refreshStep, setRefreshStep] = useState('');
  const [sharedCardOrder, setSharedCardOrder] = useState<string[]>([]);
  const [updateFlow, setUpdateFlow] = useState<{
    linkToken: string;
    institutionName: string;
    itemId: string;
  } | null>(null);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [successPopupData, setSuccessPopupData] = useState<{
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  } | null>(null);

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
      id: 'mock-card-1',
      name: 'Chase Sapphire Preferred',
      mask: '1234',
      balanceCurrent: -2450.75,
      balanceLimit: 15000,
      nextPaymentDueDate: '2025-08-15', // Due in future
      minimumPaymentAmount: 125.00,
    },
    {
      id: 'mock-card-2', 
      name: 'Capital One Venture',
      mask: '5678',
      balanceCurrent: -895.42,
      balanceLimit: 10000,
      nextPaymentDueDate: '2025-09-20', // Due in future
      minimumPaymentAmount: 45.00,
    },
    {
      id: 'mock-card-3',
      name: 'American Express Gold',
      mask: '9012',
      balanceCurrent: -1245.89,
      balanceLimit: 8000,
      nextPaymentDueDate: '2025-08-10', // Overdue (past due from August - a few weeks late)
      minimumPaymentAmount: 85.00,
    },
  ];

  const mockCycles = [
    // Current/Recent Cycles - Chase Sapphire Preferred (Active statement balance, due in future)
    {
      id: 'cycle-1',
      creditCardId: 'mock-card-1',
      startDate: '2025-07-16',
      endDate: '2025-08-15',
      totalSpend: 1850.25,
      transactionCount: 23,
      dueDate: '2025-08-15',
      statementBalance: 1850.25,
      paymentStatus: 'due', // Active statement balance, no checkmark
    },
    {
      id: 'cycle-2',
      creditCardId: 'mock-card-1',
      startDate: '2025-06-16',
      endDate: '2025-07-15',
      totalSpend: 2134.67,
      transactionCount: 28,
      dueDate: '2025-07-05',
      statementBalance: 2134.67,
      paymentStatus: 'paid',
    },
    // Current/Recent Cycles - Capital One Venture (Active statement balance, due in future)
    {
      id: 'cycle-3',
      creditCardId: 'mock-card-2',
      startDate: '2025-08-20',
      endDate: '2025-09-20',
      totalSpend: 642.18,
      transactionCount: 15,
      dueDate: '2025-09-20',
      statementBalance: 642.18,
      paymentStatus: 'due', // Active statement balance, no checkmark
    },
    {
      id: 'cycle-4',
      creditCardId: 'mock-card-2',
      startDate: '2025-07-20',
      endDate: '2025-08-19',
      totalSpend: 891.34,
      transactionCount: 18,
      dueDate: '2025-08-10',
      statementBalance: 891.34,
      paymentStatus: 'paid',
    },
    // OVERDUE Cycle - American Express Gold (Outstanding from August 2025 - a few weeks late)
    {
      id: 'cycle-5',
      creditCardId: 'mock-card-3',
      startDate: '2025-07-10',
      endDate: '2025-08-10',
      totalSpend: 1245.89,
      transactionCount: 19,
      dueDate: '2025-08-10', // This is overdue (past due from August - a few weeks late)
      statementBalance: 1245.89,
      paymentStatus: 'outstanding', // This makes it overdue, NO checkmark
    },
    {
      id: 'cycle-6',
      creditCardId: 'mock-card-3',
      startDate: '2025-06-10',
      endDate: '2025-07-09',
      totalSpend: 987.45,
      transactionCount: 14,
      dueDate: '2025-07-10',
      statementBalance: 987.45,
      paymentStatus: 'paid',
    },
    // Historical Cycles - Chase Sapphire Preferred
    {
      id: 'cycle-7',
      creditCardId: 'mock-card-1',
      startDate: '2025-05-16',
      endDate: '2025-06-15',
      totalSpend: 3245.89,
      transactionCount: 35,
      dueDate: '2025-06-05',
      statementBalance: 3245.89,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-8',
      creditCardId: 'mock-card-1',
      startDate: '2025-04-16',
      endDate: '2025-05-15',
      totalSpend: 1789.45,
      transactionCount: 21,
      dueDate: '2025-05-05',
      statementBalance: 1789.45,
      paymentStatus: 'paid',
    },
    // Historical Cycles - Capital One Venture
    {
      id: 'cycle-9',
      creditCardId: 'mock-card-2',
      startDate: '2025-06-20',
      endDate: '2025-07-19',
      totalSpend: 1456.78,
      transactionCount: 24,
      dueDate: '2025-07-10',
      statementBalance: 1456.78,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-10',
      creditCardId: 'mock-card-2',
      startDate: '2025-05-20',
      endDate: '2025-06-19',
      totalSpend: 723.56,
      transactionCount: 12,
      dueDate: '2025-06-10',
      statementBalance: 723.56,
      paymentStatus: 'paid',
    },
    // Historical Cycles - American Express Gold
    {
      id: 'cycle-11',
      creditCardId: 'mock-card-3',
      startDate: '2025-05-10',
      endDate: '2025-06-09',
      totalSpend: 1124.89,
      transactionCount: 19,
      dueDate: '2025-06-10',
      statementBalance: 1124.89,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-12',
      creditCardId: 'mock-card-3',
      startDate: '2025-04-10',
      endDate: '2025-05-09',
      totalSpend: 834.45,
      transactionCount: 16,
      dueDate: '2025-05-10',
      statementBalance: 834.45,
      paymentStatus: 'paid',
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
        fetch('/api/user/credit-cards', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
        fetch('/api/user/billing-cycles', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
        fetch(`/api/user/transactions?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}&limit=1000`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
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
        
        // Debug: Log what we receive from API
        const amexCycles = cycles.filter((c: any) => 
          c.creditCardName?.toLowerCase().includes('platinum')
        );
        console.log('🔍 DASHBOARD RECEIVED FROM API:', {
          totalCycles: cycles.length,
          amexCycles: amexCycles.length,
          amexCycleIds: amexCycles.slice(0, 5).map((c: any) => ({
            id: c.id?.substring(0, 8),
            startDate: c.startDate,
            endDate: c.endDate
          }))
        });
        
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
    setRefreshProgress(0);
    setRefreshStep('Starting refresh...');
    
    try {
      console.log('=== FRONTEND: Starting refresh process ===');
      setRefreshStep('Connecting to your banks...');
      setRefreshProgress(20);
      
      console.log('Calling /api/sync...');
      const syncResponse = await fetch('/api/sync', { method: 'POST' });
      console.log('Sync API response status:', syncResponse.status);
      
      if (!syncResponse.ok) {
        console.error('Sync API failed with status:', syncResponse.status);
        const errorText = await syncResponse.text();
        console.error('Sync API error response:', errorText);
        throw new Error(`Sync API failed: ${syncResponse.status}`);
      }
      
      setRefreshStep('Syncing account data...');
      setRefreshProgress(50);
      
      const syncResult = await syncResponse.json();
      console.log('Sync API success result:', syncResult);
      
      setRefreshStep('Processing connections...');
      setRefreshProgress(70);
      
      // Check if any connections require reconnection
      const needsReconnection = syncResult.results?.some((result: any) => result.requiresReconnection);
      const autoReconnectAvailable = syncResult.results?.some((result: any) => result.canAutoReconnect);
      
      if (needsReconnection) {
        console.log('⚠️ Some connections need to be reconnected');
        setRefreshStep('Handling connection issues...');
        
        if (autoReconnectAvailable) {
          console.log('🔄 Auto-reconnection available, triggering reconnect flow...');
          setRefreshStep('Auto-reconnecting expired cards...');
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
      
      setRefreshStep('Finalizing updates...');
      setRefreshProgress(90);
      
      console.log('Fetching user data after sync...');
      await fetchUserData();
      
      setRefreshStep('Complete!');
      setRefreshProgress(100);
      console.log('=== FRONTEND: Refresh process completed ===');
    } catch (error) {
      console.error('=== FRONTEND: Error refreshing data ===', error);
      setRefreshStep('Error occurred during refresh');
    } finally {
      // Add a small delay to show completion state
      setTimeout(() => {
        setRefreshing(false);
        setRefreshProgress(0);
        setRefreshStep('');
      }, 1000);
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
        const syncData = await response.json();
        console.log('Sync response data:', syncData);
        
        // Check if sync was actually successful
        const hasErrors = syncData.results?.some((r: any) => r.status === 'error');
        const successCount = syncData.results?.filter((r: any) => r.status === 'success').length || 0;
        
        if (hasErrors) {
          console.warn(`Sync completed with ${successCount} successes and some errors`);
          alert(`Sync completed but some connections need attention. ${successCount} cards synced successfully.`);
        } else {
          console.log('Card sync fully successful');
        }
        
        await fetchUserData(); // Refresh data after sync
      } else {
        console.error('Card sync failed:', response.status);
        const errorText = await response.text();
        console.error('Sync error details:', errorText);
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
        
        // Use the proper Plaid Link update component
        setUpdateFlow({
          linkToken: data.link_token,
          institutionName: data.institution_name,
          itemId: itemId
        });
      } else {
        console.error('Failed to create reconnection link:', data.error);
        alert('Failed to create reconnection link. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error creating reconnection link:', error);
      alert('Network error. Please try again.');
    }
  };


  const handleCreditLimitUpdated = (data: {
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  }) => {
    setSuccessPopupData(data);
    setShowSuccessPopup(true);
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

  // Check connection health - be much more conservative about auto-sync
  const checkConnectionHealth = async () => {
    if (!isLoggedIn) return;

    try {
      const response = await fetch('/api/user/credit-cards', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (response.ok) {
        const { creditCards: cards } = await response.json();
        
        // Only consider connections truly broken if they have explicit error status
        // AND haven't been synced in over 24 hours (not just 14 days)
        const trulyBrokenConnections = cards.filter((card: any) => {
          if (!card.plaidItem) return false;
          
          const hasErrorStatus = ['expired', 'error'].includes(card.plaidItem.status);
          const lastSync = card.plaidItem.lastSyncAt ? new Date(card.plaidItem.lastSyncAt) : null;
          const hoursAgo = lastSync ? (Date.now() - lastSync.getTime()) / (1000 * 60 * 60) : Infinity;
          
          // Only auto-sync if connection has explicit error AND hasn't synced in 24+ hours
          return hasErrorStatus && hoursAgo > 24;
        });

        if (trulyBrokenConnections.length > 0) {
          console.log(`⚠️ ${trulyBrokenConnections.length} truly broken connections detected (error status + 24h+ since sync)`);
          console.log('ℹ️ Consider manually reconnecting these cards instead of auto-sync');
          
          // Don't auto-trigger sync - just log for user awareness
          // User can manually refresh if needed
        } else {
          console.log('✅ All connections appear healthy - no auto-sync needed');
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

  // Auto-close success popup after 5 seconds
  useEffect(() => {
    if (showSuccessPopup) {
      const timer = setTimeout(() => {
        setShowSuccessPopup(false);
        setSuccessPopupData(null);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [showSuccessPopup]);

  // Listen for credit limit updates
  useEffect(() => {
    const handleCreditLimitUpdate = (event: any) => {
      const { cardId, manualcreditlimit, ismanuallimit } = event.detail;
      console.log('📝 Credit limit updated event received:', { cardId, manualcreditlimit, ismanuallimit });
      
      // Update the credit card data in state
      setCreditCards(prevCards => 
        prevCards.map(card => 
          card.id === cardId 
            ? { ...card, manualcreditlimit, ismanuallimit }
            : card
        )
      );
    };

    window.addEventListener('creditLimitUpdated', handleCreditLimitUpdate);
    
    return () => {
      window.removeEventListener('creditLimitUpdated', handleCreditLimitUpdate);
    };
  }, []);

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
  
  // Debug: Log what we're actually passing to components
  if (isLoggedIn && billingCycles.length > 0) {
    const amexCycles = displayCycles.filter((c: any) => 
      c.creditCardName?.toLowerCase().includes('platinum')
    );
    console.log('🔍 DASHBOARD PASSING TO COMPONENT:', {
      totalCycles: displayCycles.length,
      amexCycles: amexCycles.length
    });
  }
  
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
      const effectiveLimit = card.ismanuallimit ? card.manualcreditlimit : card.balanceLimit;
      return effectiveLimit && effectiveLimit > 0 && isFinite(effectiveLimit);
    });
    
    if (cardsWithLimits.length === 0) return 0;
    
    return cardsWithLimits.reduce((sum, card) => {
      const balance = Math.abs(card.balanceCurrent || 0);
      const effectiveLimit = card.ismanuallimit ? card.manualcreditlimit! : card.balanceLimit!;
      return sum + (balance / effectiveLimit) * 100;
    }, 0) / cardsWithLimits.length;
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-none mx-auto px-9 py-4">
        {/* Header with title and Quick Actions */}
        <div className="mb-3 max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-1">Credit Card Dashboard</h1>
              <p className="text-gray-600 text-sm">
                {isLoggedIn 
                  ? 'Track your spending, due dates, and credit utilization' 
                  : 'Sign in to connect your credit cards and see real data'
                }
              </p>
            </div>
            
            {/* Quick Actions - ensure they stay visible */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              {isLoggedIn ? (
                <>
                  <button 
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`relative overflow-hidden font-medium py-3 px-6 rounded-2xl transition-all duration-200 flex items-center justify-center space-x-2 text-sm whitespace-nowrap transform focus:outline-none focus:ring-2 group border ${
                      refreshing 
                        ? 'bg-gray-100 border-gray-200 text-gray-600 cursor-not-allowed opacity-90 shadow-sm' 
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300 hover:shadow-md hover:scale-[1.02] focus:ring-gray-500/50 shadow-sm'
                    }`}
                  >
                    <RefreshCw className={`h-4 w-4 transition-transform duration-200 ${
                      refreshing ? 'animate-spin' : 'group-hover:rotate-45'
                    }`} />
                    <span className="font-medium">
                      {refreshing ? refreshStep || 'Refreshing...' : 'Refresh All'}
                    </span>
                    
                    {/* Progress bar - iOS style with grey theme */}
                    {refreshing && (
                      <div className="absolute inset-0 flex items-end">
                        <div 
                          className="h-1 bg-gradient-to-r from-gray-400 to-gray-600 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${refreshProgress}%` }}
                        />
                      </div>
                    )}
                    
                    {/* Shimmer effect when not refreshing */}
                    {!refreshing && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                    )}
                  </button>
                  <PlaidLink onSuccess={fetchUserData} />
                </>
              ) : (
                <div className="text-center py-2">
                  <p className="text-gray-600 text-xs">Sign in to connect cards</p>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Header Metrics - utilizing more horizontal space */}
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
        
        {/* Instruction text aligned with header metrics */}
        <div className="mb-4">
          <p className="text-gray-600 text-base">Swipe horizontally to see all your cards • Expand to view billing cycles</p>
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

        {/* Revolutionary Horizontal Card Layout */}
        <div className="mb-6">
          
          {loading ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-12 text-center">
              <div className="flex items-center justify-center mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <p className="text-gray-600">Loading your credit cards...</p>
            </div>
          ) : displayCards.length > 0 ? (
            <div className="relative -mx-7">
              <HorizontalCardColumns
                cards={displayCards}
                cycles={displayCycles}
                onSync={handleCardSync}
                onReconnect={handleCardReconnect}
                onRemove={handleCardRemove}
                onCreditLimitUpdated={handleCreditLimitUpdated}
                initialCardOrder={sharedCardOrder}
                onOrderChange={setSharedCardOrder}
              />
            </div>
          ) : isLoggedIn ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-12 text-center">
              <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No credit cards connected yet</p>
              <p className="text-gray-500 text-sm mt-2">Connect your first card to get started with tracking</p>
            </div>
          ) : null}
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
      
      {/* Plaid Update Flow */}
      {updateFlow && (
        <PlaidUpdateLink
          linkToken={updateFlow.linkToken}
          institutionName={updateFlow.institutionName}
          itemId={updateFlow.itemId}
          onSuccess={() => {
            console.log(`🎉 Successfully updated ${updateFlow.institutionName} connection`);
            setUpdateFlow(null);
            // Refresh data after successful update
            handleRefresh();
          }}
          onExit={() => {
            console.log(`🚪 Exited ${updateFlow.institutionName} update flow`);
            setUpdateFlow(null);
          }}
        />
      )}

      {/* Credit Limit Success Popup - Overlays entire Dashboard */}
      {showSuccessPopup && successPopupData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setShowSuccessPopup(false)}
          />
          
          {/* Popup */}
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-sm w-full mx-4 transform transition-all duration-200 scale-100">
            {/* Success Icon and Header */}
            <div className="text-center mb-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-1">Credit Limit Updated!</h3>
              <p className="text-sm text-gray-600">{successPopupData.cardName}</p>
            </div>
            
            {/* Main Info */}
            <div className="bg-green-50 rounded-xl p-4 mb-4 border border-green-100">
              <div className="text-center">
                <p className="text-sm text-green-700 font-medium mb-1">New Credit Limit</p>
                <p className="text-2xl font-bold text-green-800">{formatCurrency(successPopupData.newLimit)}</p>
                <p className="text-sm text-green-600 mt-1">
                  Utilization: {formatPercentage(successPopupData.newUtilization)}
                </p>
              </div>
            </div>
            
            {/* Previous Info */}
            {(successPopupData.previousLimit || successPopupData.plaidLimit) && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                {successPopupData.previousLimit && (
                  <p>Previous manual limit: {formatCurrency(successPopupData.previousLimit)}</p>
                )}
                {successPopupData.plaidLimit && (
                  <p>Plaid detected limit: {formatCurrency(successPopupData.plaidLimit)}</p>
                )}
                {!successPopupData.previousLimit && (
                  <p>First time setting manual limit</p>
                )}
              </div>
            )}
            
            {/* OK Button */}
            <button
              onClick={() => setShowSuccessPopup(false)}
              className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}