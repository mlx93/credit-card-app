'use client';

import { formatCurrency } from '@/utils/format';
import { TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus } from 'lucide-react';

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
    <div className="space-y-2">
      {displayComparisons.map((item, index) => {
        const roundedChange = Math.round(Math.abs(item.change));
        const isIncrease = item.change >= 0;
        const isZero = item.change === 0;
        
        return (
          <div 
            key={item.category} 
            className="group relative bg-white border border-gray-100 rounded-lg p-3 hover:shadow-sm hover:border-gray-200 transition-all duration-200"
          >
            <div className="flex items-center justify-between">
              {/* Left Side - Category with Circle */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Change Circle */}
                {isZero ? (
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 flex-shrink-0">
                    <span className="font-bold text-gray-500 text-xs">0%</span>
                  </div>
                ) : (
                  <div className={`relative flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 ${
                    isIncrease 
                      ? 'bg-gradient-to-br from-red-50 to-red-100 border border-red-200' 
                      : 'bg-gradient-to-br from-green-50 to-green-100 border border-green-200'
                  }`}>
                    <div className="flex flex-col items-center">
                      {isIncrease ? (
                        <ArrowUp className={`h-3 w-3 text-red-600`} />
                      ) : (
                        <ArrowDown className={`h-3 w-3 text-green-600`} />
                      )}
                      <span className={`font-bold text-xs leading-none ${
                        isIncrease ? 'text-red-700' : 'text-green-700'
                      }`}>
                        {roundedChange}%
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Category Title */}
                <h3 className="font-semibold text-gray-900 truncate">
                  {item.category}
                </h3>
              </div>
              
              {/* Right Side - Amount Comparison */}
              <div className="flex items-center gap-3 text-sm flex-shrink-0">
                <div className="text-right">
                  <div className="text-xs text-gray-500 uppercase tracking-wider">This Month</div>
                  <div className="font-bold text-gray-900">{formatCurrency(item.thisMonth)}</div>
                </div>
                <div className="w-px h-6 bg-gray-200" />
                <div className="text-right">
                  <div className="text-xs text-gray-500 uppercase tracking-wider">Last Month</div>
                  <div className="font-medium text-gray-600">{formatCurrency(item.lastMonth)}</div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      
      {displayComparisons.length === 0 && isLoggedIn && (
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
          <TrendingUp className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 font-medium text-sm">No comparison data available</p>
          <p className="text-gray-500 text-xs">Spend in different categories to see trends</p>
        </div>
      )}
    </div>
  );
}