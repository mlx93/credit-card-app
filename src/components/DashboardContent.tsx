'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Calendar, DollarSign, TrendingUp, RefreshCw } from 'lucide-react';
import { formatCurrency } from '@/utils/format';
import { BillingCycleCard } from '@/components/BillingCycleCard';
import { DueDateCard } from '@/components/DueDateCard';
import { APRCalculator } from '@/components/APRCalculator';
import { PlaidLink } from '@/components/PlaidLink';

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
    setRefreshing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await fetchUserData();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUserData();
  }, [isLoggedIn]);

  const displayCards = isLoggedIn ? creditCards : mockCards;
  const displayCycles = isLoggedIn ? billingCycles : mockCycles;
  
  const totalSpendThisMonth = displayCycles.reduce((sum, cycle) => sum + cycle.totalSpend, 0);
  const totalBalance = displayCards.reduce((sum, card) => 
    sum + Math.abs(card.balanceCurrent || 0), 0
  );
  const averageUtilization = displayCards.length > 0 
    ? displayCards.reduce((sum, card) => {
        const balance = Math.abs(card.balanceCurrent || 0);
        const limit = card.balanceLimit || 1;
        return sum + (balance / limit) * 100;
      }, 0) / displayCards.length
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Credit Card Dashboard</h1>
          <p className="text-gray-600 mt-2">
            {isLoggedIn 
              ? 'Track your spending, due dates, and credit utilization' 
              : 'Sign in to connect your credit cards and see real data'
            }
          </p>
        </div>

        {!isLoggedIn && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              <strong>Demo Mode:</strong> This is sample data. Sign in to connect your real credit cards.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">This Month&apos;s Spend</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpendThisMonth)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <DollarSign className="h-8 w-8 text-red-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Balance</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalBalance)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <CreditCard className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Utilization</p>
                <p className="text-2xl font-bold text-gray-900">{averageUtilization.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <Calendar className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Cards Connected</p>
                <p className="text-2xl font-bold text-gray-900">{displayCards.length}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Current Billing Cycles</h2>
            {loading ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500">Loading billing cycles...</p>
              </div>
            ) : displayCycles.length > 0 ? (
              <div className="space-y-4">
                {displayCycles.slice(0, 3).map((cycle, index) => (
                  <BillingCycleCard key={cycle.id || index} cycle={cycle} />
                ))}
              </div>
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
              <div className="space-y-4">
                {displayCards.map((card, index) => (
                  <DueDateCard key={card.id || index} card={card} />
                ))}
              </div>
            ) : isLoggedIn ? (
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <p className="text-gray-500 text-center">No credit cards connected yet.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">APR Cost Calculator</h2>
            <APRCalculator />
          </div>
          
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="space-y-4">
                {isLoggedIn ? (
                  <>
                    <PlaidLink onSuccess={fetchUserData} />
                    <button 
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className="w-full bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-900 font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                      <span>{refreshing ? 'Refreshing...' : 'Refresh All Data'}</span>
                    </button>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-gray-600 mb-4">Sign in to connect your credit cards</p>
                    <button 
                      className="bg-gray-300 text-gray-500 font-medium py-3 px-4 rounded-lg cursor-not-allowed"
                      disabled
                    >
                      Connect Credit Card (Sign in required)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}