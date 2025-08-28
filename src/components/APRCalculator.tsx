'use client';

import { useState } from 'react';
import { formatCurrency } from '@/utils/format';
import { Calculator } from 'lucide-react';

export function APRCalculator() {
  const [balance, setBalance] = useState<number>(1000);
  const [apr, setApr] = useState<number>(24.99);
  const [days, setDays] = useState<number>(30);

  const calculateInterest = () => {
    const dailyRate = apr / 100 / 365;
    return balance * dailyRate * days;
  };

  const interestCost = calculateInterest();

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div className="flex items-center mb-4">
        <Calculator className="h-5 w-5 text-indigo-600 mr-2" />
        <h3 className="font-semibold text-gray-900">Interest Cost Calculator</h3>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <label htmlFor="balance" className="block text-sm font-medium text-gray-700 mb-1">
            Balance Amount
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">$</span>
            </div>
            <input
              type="number"
              id="balance"
              value={balance}
              onChange={(e) => setBalance(Number(e.target.value))}
              className="block w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="1000"
            />
          </div>
        </div>

        <div>
          <label htmlFor="apr" className="block text-sm font-medium text-gray-700 mb-1">
            APR (Annual Percentage Rate)
          </label>
          <div className="relative">
            <input
              type="number"
              id="apr"
              value={apr}
              onChange={(e) => setApr(Number(e.target.value))}
              step="0.01"
              className="block w-full pr-8 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="24.99"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-gray-500 sm:text-sm">%</span>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="days" className="block text-sm font-medium text-gray-700 mb-1">
            Days to Pay
          </label>
          <input
            type="number"
            id="days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="block w-full py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            placeholder="30"
          />
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-600">Interest Cost:</span>
          <span className="text-lg font-bold text-red-600">{formatCurrency(interestCost)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-600">Total Amount:</span>
          <span className="text-lg font-bold text-gray-900">{formatCurrency(balance + interestCost)}</span>
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>This calculation assumes a constant balance and daily compounding interest.</p>
      </div>
    </div>
  );
}