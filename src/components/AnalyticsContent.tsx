'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, PieChart, BarChart3, Calendar, ChevronDown, ChevronUp, Calculator } from 'lucide-react';
import { formatCurrency } from '@/utils/format';
import { SpendingChart } from '@/components/SpendingChart';
import { CategoryBreakdown } from '@/components/CategoryBreakdown';
import { MonthlyComparison } from '@/components/MonthlyComparison';
import { APRCalculator } from '@/components/APRCalculator';

interface AnalyticsContentProps {
  isLoggedIn: boolean;
}

export function AnalyticsContent({ isLoggedIn }: AnalyticsContentProps) {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isAPRCalculatorOpen, setIsAPRCalculatorOpen] = useState(false);

  const mockData = {
    totalSpendThisMonth: 4250.67,
    monthlySpend: [
      { month: 'Oct 2023', amount: 3200 },
      { month: 'Nov 2023', amount: 3850 },
      { month: 'Dec 2023', amount: 4100 },
      { month: 'Jan 2024', amount: 4250 },
    ],
    categories: [
      { name: 'Dining', amount: 1250, percentage: 29.4 },
      { name: 'Groceries', amount: 850, percentage: 20.0 },
      { name: 'Gas', amount: 420, percentage: 9.9 },
      { name: 'Shopping', amount: 980, percentage: 23.1 },
      { name: 'Travel', amount: 520, percentage: 12.2 },
      { name: 'Other', amount: 230, percentage: 5.4 },
    ],
    cardSpending: [
      { name: 'Chase Sapphire Preferred', amount: 2450, color: 'bg-blue-500' },
      { name: 'Capital One Venture', amount: 1800, color: 'bg-green-500' },
    ],
    monthlyComparison: [
      { category: 'Dining', thisMonth: 1250, lastMonth: 1150, change: 8.7 },
      { category: 'Groceries', thisMonth: 850, lastMonth: 920, change: -7.6 },
      { category: 'Gas', thisMonth: 420, lastMonth: 380, change: 10.5 },
      { category: 'Shopping', thisMonth: 980, lastMonth: 1200, change: -18.3 },
      { category: 'Travel', thisMonth: 520, lastMonth: 200, change: 160 },
    ],
    transactionCount: 65,
  };

  const fetchAnalytics = async () => {
    if (!isLoggedIn) return;
    
    try {
      setLoading(true);
      const response = await fetch('/api/user/analytics');
      
      if (response.ok) {
        const data = await response.json();
        console.log('Analytics data received:', data);
        setAnalytics(data);
      } else {
        console.error('Analytics fetch failed:', response.status);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [isLoggedIn]);

  const displayData = isLoggedIn ? (analytics || {
    totalSpendThisMonth: 0,
    monthlySpend: [],
    categories: [],
    cardSpending: [],
    monthlyComparison: [],
    transactionCount: 0,
  }) : mockData;
  const avgPerDay = displayData.totalSpendThisMonth ? displayData.totalSpendThisMonth / 30 : 0;
  const topCategory = displayData.categories?.[0]?.name || (isLoggedIn ? 'N/A' : 'Dining');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Spending Analytics</h1>
          <p className="text-gray-600 mt-2">
            {isLoggedIn 
              ? 'Detailed insights into your credit card spending patterns'
              : 'Sign in to see your real spending analytics'
            }
          </p>
        </div>

        {!isLoggedIn && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              <strong>Demo Mode:</strong> This is sample analytics data. Sign in to see your real spending patterns.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <TrendingUp className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total This Month</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : formatCurrency(displayData.totalSpendThisMonth)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <BarChart3 className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Avg per Day</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : formatCurrency(avgPerDay)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <PieChart className="h-8 w-8 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Top Category</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : topCategory}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex items-center">
              <Calendar className="h-8 w-8 text-indigo-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Transactions</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : displayData.transactionCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Monthly Spending Trend</h2>
            {loading ? (
              <p className="text-gray-500">Loading chart data...</p>
            ) : (
              <SpendingChart data={displayData.monthlySpend} />
            )}
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Category Breakdown</h2>
            {loading ? (
              <p className="text-gray-500">Loading category data...</p>
            ) : displayData.categories?.length > 0 ? (
              <CategoryBreakdown categories={displayData.categories} />
            ) : isLoggedIn ? (
              <p className="text-gray-500 text-center">No transaction data found. Connect a credit card to get started.</p>
            ) : (
              <CategoryBreakdown categories={displayData.categories} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Spending by Card</h2>
            {loading ? (
              <p className="text-gray-500">Loading card data...</p>
            ) : displayData.cardSpending?.length > 0 ? (
              <div className="space-y-4">
                {displayData.cardSpending.map((card: any, index: number) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-4 h-4 rounded-full ${card.color} mr-3`}></div>
                      <span className="font-medium text-gray-900">{card.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{formatCurrency(card.amount)}</span>
                  </div>
                ))}
              </div>
            ) : isLoggedIn ? (
              <p className="text-gray-500 text-center">No cards connected yet.</p>
            ) : (
              <div className="space-y-4">
                {displayData.cardSpending.map((card: any, index: number) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-4 h-4 rounded-full ${card.color} mr-3`}></div>
                      <span className="font-medium text-gray-900">{card.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{formatCurrency(card.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Monthly Comparison</h2>
            {loading ? (
              <p className="text-gray-500">Loading comparison data...</p>
            ) : (
              <MonthlyComparison 
                comparisons={displayData.monthlyComparison} 
                isLoggedIn={isLoggedIn} 
              />
            )}
          </div>
        </div>

        {/* APR Cost Calculator - Expandable Section */}
        <div className="mt-8">
          <div className="bg-white rounded-lg shadow-sm">
            <button
              onClick={() => setIsAPRCalculatorOpen(!isAPRCalculatorOpen)}
              className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center">
                <Calculator className="h-6 w-6 text-indigo-600 mr-3" />
                <h2 className="text-xl font-semibold text-gray-900">APR Cost Calculator</h2>
              </div>
              {isAPRCalculatorOpen ? (
                <ChevronUp className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              )}
            </button>
            {isAPRCalculatorOpen && (
              <div className="px-6 pb-6 border-t">
                <div className="pt-6">
                  <APRCalculator />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}