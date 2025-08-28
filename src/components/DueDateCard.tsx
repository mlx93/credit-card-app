import { formatCurrency, formatDate, getDaysUntil, formatPercentage } from '@/utils/format';
import { AlertTriangle, CreditCard } from 'lucide-react';

interface CreditCardInfo {
  id: string;
  name: string;
  mask: string;
  balanceCurrent: number;
  balanceLimit: number;
  lastStatementBalance?: number;
  nextPaymentDueDate?: Date;
  minimumPaymentAmount?: number;
}

interface DueDateCardProps {
  card: CreditCardInfo;
  colorIndex?: number;
}

const cardColors = [
  'bg-blue-50 border-blue-200 border-l-blue-500',
  'bg-green-50 border-green-200 border-l-green-500',
  'bg-purple-50 border-purple-200 border-l-purple-500',
  'bg-orange-50 border-orange-200 border-l-orange-500',
  'bg-pink-50 border-pink-200 border-l-pink-500',
  'bg-indigo-50 border-indigo-200 border-l-indigo-500',
  'bg-teal-50 border-teal-200 border-l-teal-500',
  'bg-red-50 border-red-200 border-l-red-500'
];

export function DueDateCard({ card, colorIndex = 0 }: DueDateCardProps) {
  const daysUntilDue = card.nextPaymentDueDate ? getDaysUntil(card.nextPaymentDueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
  
  // Handle cards with no limit or invalid limits
  const hasValidLimit = card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit);
  const utilization = hasValidLimit ? Math.abs(card.balanceCurrent) / card.balanceLimit * 100 : 0;

  // Check if card is paid off
  const currentBalance = Math.abs(card.balanceCurrent || 0);
  const minPayment = card.minimumPaymentAmount;
  const isPaidOff = (currentBalance === 0) || (minPayment === null || minPayment === undefined || minPayment === 0);

  const cardColorClass = cardColors[colorIndex % cardColors.length];
  
  return (
    <div className={`p-6 rounded-lg shadow-sm border-2 border-l-4 ${cardColorClass}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center">
          <CreditCard className="h-5 w-5 text-gray-400 mr-2" />
          <div>
            <h3 className="font-semibold text-gray-900">{card.name}</h3>
            <p className="text-sm text-gray-600">•••• {card.mask}</p>
          </div>
        </div>
        {!isPaidOff && (isOverdue || isDueSoon) && (
          <AlertTriangle className={`h-5 w-5 ${isOverdue ? 'text-red-500' : 'text-yellow-500'}`} />
        )}
      </div>

      {/* Balance Information */}
      {card.lastStatementBalance && card.lastStatementBalance !== card.balanceCurrent ? (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <p className="text-sm text-gray-600">Statement Balance</p>
            <p className="font-semibold text-lg text-blue-600">
              {formatCurrency(Math.abs(card.lastStatementBalance))}
            </p>
            <p className="text-xs text-blue-500">Due on payment date</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Current Balance</p>
            <p className="font-semibold text-lg text-gray-900">
              {formatCurrency(Math.abs(card.balanceCurrent))}
            </p>
            <p className="text-xs text-gray-500">Includes new charges</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Minimum Payment</p>
            <p className="font-semibold text-lg text-gray-900">
              {card.minimumPaymentAmount ? formatCurrency(card.minimumPaymentAmount) : 'N/A'}
            </p>
          </div>
        </div>
      ) : (
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
      )}

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Credit Utilization</span>
          {hasValidLimit ? (
            <span>{formatPercentage(utilization)}</span>
          ) : (
            <span className="text-gray-500 italic">
              {card.balanceLimit === null || card.balanceLimit === undefined ? 'Unknown Limit' : 'No Limit'}
            </span>
          )}
        </div>
        {hasValidLimit ? (
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
        ) : (
          <div className="text-center py-2 text-sm text-gray-500 italic">
            {card.balanceLimit === null || card.balanceLimit === undefined ? 'Limit information not available' : 'Unlimited credit'}
          </div>
        )}
      </div>

      {/* Due Date or Paid Off Status */}
      {isPaidOff ? (
        <div className="flex justify-center items-center text-sm">
          <div className="bg-green-100 text-green-800 px-3 py-2 rounded-full font-medium">
            ✅ Card has been paid off!
          </div>
        </div>
      ) : card.nextPaymentDueDate ? (
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
      ) : (
        <div className="text-center text-sm text-gray-500">
          No payment due date available
        </div>
      )}
    </div>
  );
}