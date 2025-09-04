'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, PieChart, BarChart3, Calendar, ChevronDown, ChevronUp, Calculator, Loader2 } from 'lucide-react';
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
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [isMonthlySpendExpanded, setIsMonthlySpendExpanded] = useState(false);

  const mockData = {
    totalSpendThisMonth: 1353.74, // Sum of current open cycles: 800.50 + 253.24 + 300.00  
    monthlySpend: [
      { month: 'Jun 2025', amount: 3867 },
      { month: 'Jul 2025', amount: 4234 },
      { month: 'Aug 2025', amount: 4156 }, // Closed statements from Aug
      { month: 'Sep 2025', amount: 1354 }, // Current month - early Sep (partial)
    ],
    categories: [
      { name: 'Dining', amount: 550, percentage: 40.6 },
      { name: 'Shopping', amount: 340, percentage: 25.1 },
      { name: 'Groceries', amount: 250, percentage: 18.5 },
      { name: 'Gas', amount: 148, percentage: 10.9 },
      { name: 'Travel', amount: 60, percentage: 4.4 },
      { name: 'Other', amount: 5.74, percentage: 0.4 },
    ],
    cardSpending: [
      { name: 'Chase Sapphire Preferred', amount: 800.50, color: 'bg-blue-500' }, // Open cycle
      { name: 'Capital One Venture', amount: 253.24, color: 'bg-green-500' }, // Open cycle
      { name: 'American Express Gold', amount: 300.00, color: 'bg-orange-500' }, // Open cycle
    ],
    monthlyComparison: [
      { category: 'Dining', thisMonth: 550, lastMonth: 1456, change: -62.2 }, // Sep vs Aug
      { category: 'Shopping', thisMonth: 340, lastMonth: 1245, change: -72.7 }, // Sep vs Aug
      { category: 'Groceries', thisMonth: 250, lastMonth: 1089, change: -77.0 }, // Sep vs Aug  
      { category: 'Travel', thisMonth: 60, lastMonth: 245, change: -75.5 }, // Sep vs Aug
      { category: 'Gas', thisMonth: 148, lastMonth: 421, change: -64.8 }, // Sep vs Aug
    ],
    transactionCount: 27, // Sum of transaction counts from current open cycles (12 + 7 + 8)
  };

  const fetchAnalytics = async (month?: string) => {
    if (!isLoggedIn) return;
    
    const startTime = Date.now();
    
    try {
      setLoading(true);
      const url = month 
        ? `/api/user/analytics?month=${month}`
        : '/api/user/analytics';
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Analytics data received:', data);
        setAnalytics(data);
        
        // Update available months and selected month from API response
        if (data.availableMonths) {
          setAvailableMonths(data.availableMonths);
        }
        if (data.selectedMonth) {
          setSelectedMonth(data.selectedMonth);
        }
      } else {
        console.error('Analytics fetch failed:', response.status);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      // Ensure loading appears for at least 500ms
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(0, 500 - elapsed);
      
      setTimeout(() => {
        setLoading(false);
      }, remainingTime);
    }
  };

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    fetchAnalytics(month);
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
  const topCategory = displayData.categories?.[0]?.name || (isLoggedIn ? '' : 'Dining');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Spending Analytics</h1>
              <p className="text-gray-600 mt-2">
                {isLoggedIn 
                  ? 'Detailed insights into your credit card spending patterns'
                  : 'Sign in to see your real spending analytics'
                }
              </p>
            </div>
            {isLoggedIn && availableMonths.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  Viewing
                </span>
                <div className="relative">
                  <select
                    id="month-picker"
                    value={selectedMonth}
                    onChange={(e) => handleMonthChange(e.target.value)}
                    className="appearance-none pl-4 pr-10 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all duration-200 hover:from-blue-100 hover:to-indigo-100 cursor-pointer shadow-sm"
                    disabled={loading}
                  >
                    {availableMonths.map((month) => {
                      const [year, monthNum] = month.split('-');
                      const date = new Date(parseInt(year), parseInt(monthNum) - 1);
                      const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                      return (
                        <option key={month} value={month}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                    <ChevronDown className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fancy Loading Overlay */}
        {loading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-40 flex items-center justify-center transition-all duration-300">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 max-w-sm w-full mx-4 transform scale-100 transition-transform duration-300">
              <div className="text-center">
                {/* Animated Loading Icon */}
                <div className="relative mb-6">
                  <div className="w-20 h-20 mx-auto relative">
                    {/* Multiple spinning rings for depth */}
                    <div className="absolute inset-0 rounded-full border-4 border-blue-100"></div>
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 animate-spin"></div>
                    <div className="absolute inset-2 rounded-full border-2 border-transparent border-r-blue-300 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '3s' }}></div>
                    
                    {/* Inner pulsing dot */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-pulse"></div>
                    </div>
                  </div>
                </div>
                
                {/* Loading Text */}
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Loading Analytics</h3>
                <p className="text-gray-600 text-sm mb-4">Fetching your spending data...</p>
                
                {/* Modern Progress Bar */}
                <div className="relative w-full bg-gradient-to-r from-gray-100 to-gray-200 rounded-full h-2 mb-4 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 rounded-full transform -translate-x-full animate-pulse"></div>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full transform -translate-x-full animate-bounce" style={{ animationDuration: '2s' }}></div>
                </div>
                
                {/* Animated Status Text */}
                <div className="flex items-center justify-center space-x-2 text-blue-600 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="animate-pulse">Processing data</span>
                </div>
                
                {/* Decorative elements */}
                <div className="flex justify-center space-x-1 mt-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="w-1 h-6 bg-gradient-to-t from-blue-300 to-blue-500 rounded-full animate-pulse"
                      style={{ 
                        animationDelay: `${i * 0.15}s`,
                        animationDuration: '1.5s'
                      }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoggedIn && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              <strong>Demo Mode:</strong> This is sample analytics data. Sign in to see your real spending patterns.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
          <div className="relative bg-gradient-to-br from-green-50 to-emerald-50 p-4 md:p-6 rounded-xl shadow-sm border border-green-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-start sm:items-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mr-3 md:mr-4 shadow-lg flex-shrink-0">
                <TrendingUp className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold text-green-700 uppercase tracking-wider leading-tight">Total This Month</p>
                <p className="text-lg md:text-2xl font-bold text-gray-900 break-words">
                  {loading ? '...' : formatCurrency(displayData.totalSpendThisMonth)}
                </p>
              </div>
            </div>
          </div>

          <div className="relative bg-gradient-to-br from-blue-50 to-cyan-50 p-4 md:p-6 rounded-xl shadow-sm border border-blue-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-start sm:items-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center mr-3 md:mr-4 shadow-lg flex-shrink-0">
                <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold text-blue-700 uppercase tracking-wider leading-tight">Avg per Day</p>
                <p className="text-lg md:text-2xl font-bold text-gray-900 break-words">
                  {loading ? '...' : formatCurrency(avgPerDay)}
                </p>
              </div>
            </div>
          </div>

          <div className="relative bg-gradient-to-br from-purple-50 to-pink-50 p-4 md:p-6 rounded-xl shadow-sm border border-purple-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-start sm:items-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mr-3 md:mr-4 shadow-lg flex-shrink-0">
                <PieChart className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold text-purple-700 uppercase tracking-wider leading-tight">Top Category</p>
                <p className={`font-bold text-gray-900 break-words leading-tight ${
                  topCategory.length > 15 ? 'text-base md:text-lg' : 
                  topCategory.length > 10 ? 'text-lg md:text-xl' : 
                  'text-lg md:text-2xl'
                }`}
                  title={topCategory}
                >
                  {loading ? '...' : topCategory}
                </p>
              </div>
            </div>
          </div>

          <div className="relative bg-gradient-to-br from-indigo-50 to-violet-50 p-4 md:p-6 rounded-xl shadow-sm border border-indigo-100 hover:shadow-md transition-shadow duration-200">
            <div className="flex items-start sm:items-center">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mr-3 md:mr-4 shadow-lg flex-shrink-0">
                <Calendar className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold text-indigo-700 uppercase tracking-wider leading-tight">Transactions</p>
                <p className="text-lg md:text-2xl font-bold text-gray-900">
                  {loading ? '...' : displayData.transactionCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* First Row: Spending By Card + Monthly Spending Trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Monthly Spending Trend</h2>
              {!loading && displayData.monthlySpend?.length > (displayData.cardSpending?.length || 2) && (
                <button
                  onClick={() => setIsMonthlySpendExpanded(!isMonthlySpendExpanded)}
                  className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors duration-200"
                >
                  {isMonthlySpendExpanded ? (
                    <>
                      <span>Show Recent Months</span>
                      <ChevronUp className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      <span>Show Older Months</span>
                      <ChevronDown className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </div>
            {loading ? (
              <p className="text-gray-500">Loading chart data...</p>
            ) : (
              <SpendingChart 
                data={
                  isMonthlySpendExpanded 
                    ? displayData.monthlySpend 
                    : displayData.monthlySpend?.slice(0, displayData.cardSpending?.length || 2)
                } 
              />
            )}
          </div>
        </div>

        {/* Second Row: Category Breakdown + Monthly Comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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

          <div className="bg-white p-6 rounded-lg shadow-sm border-2 border-gray-200">
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