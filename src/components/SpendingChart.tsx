'use client';

import { formatCurrency } from '@/utils/format';

interface SpendingData {
  month: string;
  amount: number;
}

interface SpendingChartProps {
  data: SpendingData[];
}

export function SpendingChart({ data }: SpendingChartProps) {
  const maxAmount = Math.max(...data.map(d => d.amount));

  return (
    <div className="space-y-4">
      {data.map((item, index) => (
        <div key={index} className="flex items-center">
          <div className="w-16 text-sm font-medium text-gray-600">{item.month}</div>
          <div className="flex-1 mx-4">
            <div className="bg-gray-200 rounded-full h-4 relative">
              <div 
                className="bg-indigo-600 h-4 rounded-full transition-all duration-300"
                style={{ width: `${(item.amount / maxAmount) * 100}%` }}
              ></div>
            </div>
          </div>
          <div className="w-24 text-right text-sm font-semibold text-gray-900">
            {formatCurrency(item.amount)}
          </div>
        </div>
      ))}
    </div>
  );
}