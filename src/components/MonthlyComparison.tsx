'use client';

import { formatCurrency } from '@/utils/format';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MonthlyComparisonProps {
  comparisons?: Array<{
    category: string;
    thisMonth: number;
    lastMonth: number;
    change: number;
  }>;
  isLoggedIn?: boolean;
}

export function MonthlyComparison({ comparisons, isLoggedIn = false }: MonthlyComparisonProps) {
  const mockComparisons = [
    { category: 'Dining', thisMonth: 1250, lastMonth: 1150, change: 8.7 },
    { category: 'Groceries', thisMonth: 850, lastMonth: 920, change: -7.6 },
    { category: 'Gas', thisMonth: 420, lastMonth: 380, change: 10.5 },
    { category: 'Shopping', thisMonth: 980, lastMonth: 1200, change: -18.3 },
    { category: 'Travel', thisMonth: 520, lastMonth: 200, change: 160 },
  ];

  const displayComparisons = isLoggedIn ? (comparisons || []) : mockComparisons;

  if (isLoggedIn && (!comparisons || comparisons.length === 0)) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p>No transaction data available for comparison.</p>
        <p className="text-sm">Connect a credit card to see monthly spending trends.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {displayComparisons.map((item) => (
        <div key={item.category} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div>
            <p className="font-medium text-gray-900">{item.category}</p>
            <p className="text-sm text-gray-600">
              {formatCurrency(item.thisMonth)} vs {formatCurrency(item.lastMonth)}
            </p>
          </div>
          <div className={`flex items-center ${item.change >= 0 ? 'text-red-600' : 'text-green-600'}`}>
            {item.change >= 0 ? (
              <TrendingUp className="h-4 w-4 mr-1" />
            ) : (
              <TrendingDown className="h-4 w-4 mr-1" />
            )}
            <span className="font-semibold">{Math.abs(item.change).toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}