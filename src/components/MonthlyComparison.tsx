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
    <div className="space-y-3">
      {displayComparisons.map((item, index) => {
        const roundedChange = Math.round(Math.abs(item.change));
        const isIncrease = item.change >= 0;
        const isZero = item.change === 0;
        
        return (
          <div 
            key={item.category} 
            className="group relative overflow-hidden bg-gradient-to-r from-white to-gray-50/50 border border-gray-100 rounded-xl p-4 hover:shadow-md hover:border-gray-200 transition-all duration-200"
          >
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out opacity-50" />
            
            <div className="relative flex items-center justify-between">
              {/* Left Side - Category and Amounts */}
              <div className="flex-1 min-w-0">
                <div className="mb-2">
                  <h3 className="font-semibold text-gray-900 truncate mb-3">
                    {item.category}
                  </h3>
                </div>
                
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">This Month</span>
                    <span className="font-bold text-gray-900">{formatCurrency(item.thisMonth)}</span>
                  </div>
                  <div className="w-px h-8 bg-gray-200" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Last Month</span>
                    <span className="font-medium text-gray-600">{formatCurrency(item.lastMonth)}</span>
                  </div>
                </div>
              </div>
              
              {/* Right Side - Change Indicator */}
              <div className="flex-shrink-0 ml-4">
                {isZero ? (
                  <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gray-100">
                    <Minus className="h-5 w-5 text-gray-500" />
                    <span className="ml-1 font-bold text-gray-500 text-sm">0%</span>
                  </div>
                ) : (
                  <div className={`relative flex items-center justify-center w-16 h-16 rounded-full ${
                    isIncrease 
                      ? 'bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-200' 
                      : 'bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200'
                  } shadow-sm`}>
                    <div className="flex flex-col items-center">
                      {isIncrease ? (
                        <ArrowUp className={`h-4 w-4 text-red-600`} />
                      ) : (
                        <ArrowDown className={`h-4 w-4 text-green-600`} />
                      )}
                      <span className={`font-bold text-xs ${
                        isIncrease ? 'text-red-700' : 'text-green-700'
                      }`}>
                        {roundedChange}%
                      </span>
                    </div>
                    
                    {/* Subtle glow effect */}
                    <div className={`absolute inset-0 rounded-full ${
                      isIncrease ? 'bg-red-400' : 'bg-green-400'
                    } opacity-10 group-hover:opacity-20 transition-opacity duration-200`} />
                  </div>
                )}
              </div>
            </div>
            
            {/* Bottom accent line */}
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r ${
              isZero ? 'from-gray-200 to-gray-300' :
              isIncrease ? 'from-red-300 to-red-400' : 'from-green-300 to-green-400'
            } opacity-30`} />
          </div>
        );
      })}
      
      {displayComparisons.length === 0 && isLoggedIn && (
        <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
          <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">No comparison data available</p>
          <p className="text-gray-500 text-sm">Spend in different categories to see month-over-month trends</p>
        </div>
      )}
    </div>
  );
}