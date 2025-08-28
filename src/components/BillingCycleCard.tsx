import { formatCurrency, formatDate, getDaysUntil } from '@/utils/format';
import { Calendar, CreditCard } from 'lucide-react';

interface BillingCycle {
  id: string;
  creditCardName: string;
  startDate: Date;
  endDate: Date;
  totalSpend: number;
  transactionCount: number;
  dueDate?: Date;
}

interface BillingCycleCardProps {
  cycle: BillingCycle;
}

export function BillingCycleCard({ cycle }: BillingCycleCardProps) {
  const daysUntilDue = cycle.dueDate ? getDaysUntil(cycle.dueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-indigo-600">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center">
          <CreditCard className="h-5 w-5 text-gray-400 mr-2" />
          <h3 className="font-semibold text-gray-900">{cycle.creditCardName}</h3>
        </div>
        {cycle.dueDate && (
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            isOverdue 
              ? 'bg-red-100 text-red-800' 
              : isDueSoon 
                ? 'bg-yellow-100 text-yellow-800' 
                : 'bg-green-100 text-green-800'
          }`}>
            {isOverdue ? 'Overdue' : isDueSoon ? 'Due Soon' : 'On Track'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-600">Cycle Period</p>
          <p className="font-medium text-gray-900">
            {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Total Spend</p>
          <p className="font-medium text-gray-900 text-lg">{formatCurrency(cycle.totalSpend)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center">
          <Calendar className="h-4 w-4 mr-1" />
          <span>{cycle.transactionCount} transactions</span>
        </div>
        {cycle.dueDate && (
          <div>
            Due: {formatDate(cycle.dueDate)}
            {daysUntilDue !== null && (
              <span className={`ml-2 ${isOverdue ? 'text-red-600' : isDueSoon ? 'text-yellow-600' : 'text-green-600'}`}>
                ({Math.abs(daysUntilDue)} days {isOverdue ? 'overdue' : 'remaining'})
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}