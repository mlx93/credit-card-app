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
  'bg-blue-500',
  'bg-green-500', 
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
];

export function CategoryBreakdown({ categories }: CategoryBreakdownProps) {
  return (
    <div className="space-y-4">
      {categories.map((category, index) => (
        <div key={category.name} className="flex items-center justify-between">
          <div className="flex items-center flex-1">
            <div className={`w-3 h-3 rounded-full ${categoryColors[index % categoryColors.length]} mr-3`}></div>
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-900">{category.name}</span>
                <span className="text-sm text-gray-600">{category.percentage}%</span>
              </div>
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${categoryColors[index % categoryColors.length]}`}
                  style={{ width: `${category.percentage}%` }}
                ></div>
              </div>
            </div>
            <div className="ml-4 text-sm font-semibold text-gray-900">
              {formatCurrency(category.amount)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}