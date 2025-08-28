import { formatCurrency, formatDate, getDaysUntil, formatPercentage } from '@/utils/format';
import { AlertTriangle, CreditCard } from 'lucide-react';

interface CreditCardInfo {
  id: string;
  name: string;
  mask: string;
  balanceCurrent: number;
  balanceLimit: number;
  nextPaymentDueDate?: Date;
  minimumPaymentAmount?: number;
}

interface DueDateCardProps {
  card: CreditCardInfo;
}

export function DueDateCard({ card }: DueDateCardProps) {
  const daysUntilDue = card.nextPaymentDueDate ? getDaysUntil(card.nextPaymentDueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
  const utilization = Math.abs(card.balanceCurrent) / card.balanceLimit * 100;

  return (
    <div className={`bg-white p-6 rounded-lg shadow-sm border-l-4 ${
      isOverdue 
        ? 'border-red-500' 
        : isDueSoon 
          ? 'border-yellow-500' 
          : 'border-green-500'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center">
          <CreditCard className="h-5 w-5 text-gray-400 mr-2" />
          <div>
            <h3 className="font-semibold text-gray-900">{card.name}</h3>
            <p className="text-sm text-gray-600">•••• {card.mask}</p>
          </div>
        </div>
        {(isOverdue || isDueSoon) && (
          <AlertTriangle className={`h-5 w-5 ${isOverdue ? 'text-red-500' : 'text-yellow-500'}`} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-600">Current Balance</p>
          <p className="font-semibold text-lg text-gray-900">
            {formatCurrency(Math.abs(card.balanceCurrent))}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Minimum Payment</p>
          <p className="font-semibold text-lg text-gray-900">
            {card.minimumPaymentAmount ? formatCurrency(card.minimumPaymentAmount) : 'N/A'}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Credit Utilization</span>
          <span>{formatPercentage(utilization)}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full ${
              utilization > 90 ? 'bg-red-500' :
              utilization > 70 ? 'bg-yellow-500' :
              utilization > 30 ? 'bg-blue-500' :
              'bg-green-500'
            }`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          ></div>
        </div>
      </div>

      {card.nextPaymentDueDate && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Due Date:</span>
          <div className="text-right">
            <p className="font-medium text-gray-900">{formatDate(card.nextPaymentDueDate)}</p>
            {daysUntilDue !== null && (
              <p className={`${
                isOverdue 
                  ? 'text-red-600' 
                  : isDueSoon 
                    ? 'text-yellow-600' 
                    : 'text-green-600'
              }`}>
                {Math.abs(daysUntilDue)} days {isOverdue ? 'overdue' : 'remaining'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}