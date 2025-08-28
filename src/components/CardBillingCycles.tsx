import { useState } from 'react';
import { formatCurrency, formatDate, getDaysUntil } from '@/utils/format';
import { Calendar, CreditCard, ChevronDown, ChevronRight, History } from 'lucide-react';

interface BillingCycle {
  id: string;
  creditCardName: string;
  startDate: Date;
  endDate: Date;
  totalSpend: number;
  transactionCount: number;
  dueDate?: Date;
  isCurrentCycle?: boolean;
}

interface CreditCardInfo {
  id: string;
  name: string;
  mask: string;
  balanceCurrent: number;
  balanceLimit: number;
  nextPaymentDueDate?: Date;
  minimumPaymentAmount?: number;
}

interface CardBillingCyclesProps {
  cycles: BillingCycle[];
  cards: CreditCardInfo[];
}

// Generate consistent colors for cards
const cardColors = [
  'bg-blue-50 border-blue-200',
  'bg-green-50 border-green-200', 
  'bg-purple-50 border-purple-200',
  'bg-orange-50 border-orange-200',
  'bg-pink-50 border-pink-200',
  'bg-indigo-50 border-indigo-200',
  'bg-teal-50 border-teal-200',
  'bg-red-50 border-red-200'
];

const cardBorderColors = [
  'border-l-blue-500',
  'border-l-green-500',
  'border-l-purple-500', 
  'border-l-orange-500',
  'border-l-pink-500',
  'border-l-indigo-500',
  'border-l-teal-500',
  'border-l-red-500'
];

export function CardBillingCycles({ cycles, cards }: CardBillingCyclesProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Group cycles by card and separate current/recent vs historical
  const cyclesByCard = cycles.reduce((acc, cycle) => {
    const cardName = cycle.creditCardName;
    if (!acc[cardName]) {
      acc[cardName] = [];
    }
    acc[cardName].push(cycle);
    return acc;
  }, {} as Record<string, BillingCycle[]>);

  // Sort cycles by date (newest first) and categorize them
  Object.keys(cyclesByCard).forEach(cardName => {
    cyclesByCard[cardName].sort((a, b) => 
      new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
    );
  });

  const toggleCardExpansion = (cardName: string) => {
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(cardName)) {
      newExpanded.delete(cardName);
    } else {
      newExpanded.add(cardName);
    }
    setExpandedCards(newExpanded);
  };

  const getCardColorIndex = (cardName: string) => {
    return Math.abs(cardName.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % cardColors.length;
  };

  const BillingCycleItem = ({ cycle, isHistorical = false }: { cycle: BillingCycle, isHistorical?: boolean }) => {
    const daysUntilDue = cycle.dueDate ? getDaysUntil(cycle.dueDate) : null;
    const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
    const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;

    return (
      <div className={`p-4 rounded-lg border ${isHistorical ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'} ${isHistorical ? 'opacity-75' : ''}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center">
            {isHistorical && <History className="h-4 w-4 text-gray-400 mr-1" />}
            <div>
              <p className="font-medium text-gray-900">
                {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
              </p>
              <p className="text-sm text-gray-600">{cycle.transactionCount} transactions</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-lg text-gray-900">{formatCurrency(cycle.totalSpend)}</p>
            {cycle.dueDate && (
              <p className={`text-sm ${
                isOverdue ? 'text-red-600' : isDueSoon ? 'text-yellow-600' : 'text-green-600'
              }`}>
                Due: {formatDate(cycle.dueDate)}
                {daysUntilDue !== null && (
                  <span className="block">
                    ({Math.abs(daysUntilDue)} days {isOverdue ? 'overdue' : 'remaining'})
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        
        {cycle.dueDate && (
          <div className="flex justify-end">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
              isOverdue 
                ? 'bg-red-100 text-red-800' 
                : isDueSoon 
                  ? 'bg-yellow-100 text-yellow-800' 
                  : 'bg-green-100 text-green-800'
            }`}>
              {isOverdue ? 'Overdue' : isDueSoon ? 'Due Soon' : 'On Track'}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Billing Cycles</h2>
        <p className="text-sm text-gray-600">Color-coded to match your credit cards</p>
      </div>

      {Object.entries(cyclesByCard).map(([cardName, cardCycles]) => {
        const colorIndex = getCardColorIndex(cardName);
        const currentAndRecent = cardCycles.slice(0, 2); // Current + most recent previous
        const historical = cardCycles.slice(2); // All others
        const isExpanded = expandedCards.has(cardName);
        const card = cards.find(c => c.name === cardName);

        return (
          <div key={cardName} className={`rounded-lg border-2 ${cardColors[colorIndex]} ${cardBorderColors[colorIndex]} border-l-4`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <CreditCard className="h-5 w-5 text-gray-600 mr-2" />
                  <div>
                    <h3 className="font-semibold text-gray-900">{cardName}</h3>
                    {card && <p className="text-sm text-gray-600">•••• {card.mask}</p>}
                  </div>
                </div>
                {historical.length > 0 && (
                  <button
                    onClick={() => toggleCardExpansion(cardName)}
                    className="flex items-center text-sm text-gray-600 hover:text-gray-800"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
                    {historical.length} older cycle{historical.length !== 1 ? 's' : ''}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {/* Current and recent cycles (always shown) */}
                {currentAndRecent.map((cycle, index) => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    isHistorical={false}
                  />
                ))}

                {/* Historical cycles (collapsible) */}
                {isExpanded && historical.length > 0 && (
                  <div className="border-t pt-3 mt-3">
                    <p className="text-sm font-medium text-gray-600 mb-3 flex items-center">
                      <History className="h-4 w-4 mr-1" />
                      Historical Cycles
                    </p>
                    <div className="space-y-2">
                      {historical.map(cycle => (
                        <BillingCycleItem 
                          key={cycle.id} 
                          cycle={cycle}
                          isHistorical={true}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {Object.keys(cyclesByCard).length === 0 && (
        <div className="text-center py-8">
          <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Billing Cycles</h3>
          <p className="text-gray-600">Connect your credit cards to see billing cycle information.</p>
        </div>
      )}
    </div>
  );
}