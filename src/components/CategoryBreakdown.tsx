'use client';

import { formatCurrency } from '@/utils/format';

interface Category {
  name: string;
  amount: number;
  percentage: number;
}

interface CategoryBreakdownProps {
  categories: Category[];
}

const categoryColors = [
  { bg: 'bg-blue-500', gradient: 'from-blue-50 to-blue-100', border: 'border-blue-200', text: 'text-blue-700' },
  { bg: 'bg-green-500', gradient: 'from-green-50 to-green-100', border: 'border-green-200', text: 'text-green-700' },
  { bg: 'bg-yellow-500', gradient: 'from-yellow-50 to-yellow-100', border: 'border-yellow-200', text: 'text-yellow-700' },
  { bg: 'bg-purple-500', gradient: 'from-purple-50 to-purple-100', border: 'border-purple-200', text: 'text-purple-700' },
  { bg: 'bg-pink-500', gradient: 'from-pink-50 to-pink-100', border: 'border-pink-200', text: 'text-pink-700' },
  { bg: 'bg-indigo-500', gradient: 'from-indigo-50 to-indigo-100', border: 'border-indigo-200', text: 'text-indigo-700' },
];

export function CategoryBreakdown({ categories }: CategoryBreakdownProps) {
  return (
    <div className="space-y-2">
      {categories.map((category, index) => {
        const colorScheme = categoryColors[index % categoryColors.length];
        
        return (
          <div 
            key={category.name} 
            className="group relative bg-white border border-gray-100 rounded-lg p-3 hover:shadow-sm hover:border-gray-200 transition-all duration-200"
          >
            <div className="flex items-center justify-between">
              {/* Left Side - Category with Percentage Circle */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Percentage Circle */}
                <div className={`relative flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br ${colorScheme.gradient} border ${colorScheme.border} flex-shrink-0`}>
                  <span className={`font-bold text-xs ${colorScheme.text}`}>
                    {category.percentage}%
                  </span>
                </div>
                
                {/* Category Title */}
                <h3 className="font-semibold text-gray-900 truncate">
                  {category.name}
                </h3>
              </div>
              
              {/* Right Side - Amount */}
              <div className="flex-shrink-0">
                <div className="text-right">
                  <div className="font-bold text-gray-900">
                    {formatCurrency(category.amount)}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="mt-2">
              <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={`h-1.5 rounded-full ${colorScheme.bg} transition-all duration-300 ease-out`}
                  style={{ width: `${category.percentage}%` }}
                ></div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}