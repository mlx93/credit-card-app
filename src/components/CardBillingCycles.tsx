import { useState } from 'react';
import { formatCurrency, formatDate, getDaysUntil } from '@/utils/format';
import { Calendar, CreditCard, ChevronDown, ChevronRight, History } from 'lucide-react';

interface BillingCycle {
  id: string;
  creditCardName: string;
  creditCardMask?: string;
  startDate: Date;
  endDate: Date;
  totalSpend: number;
  transactionCount: number;
  dueDate?: Date;
  statementBalance?: number;
  minimumPayment?: number;
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

  const BillingCycleItem = ({ cycle, card, isHistorical = false }: { cycle: BillingCycle, card?: CreditCardInfo, isHistorical?: boolean }) => {
    const daysUntilDue = cycle.dueDate ? getDaysUntil(cycle.dueDate) : null;
    const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
    const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
    
    // Hide due date info if total spend and statement balance are both $0
    const shouldShowDueDate = cycle.dueDate && (cycle.totalSpend > 0 || (cycle.statementBalance && cycle.statementBalance > 0));

    return (
      <div className={`p-4 rounded-lg border ${isHistorical ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'} ${isHistorical ? 'opacity-75' : ''}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center">
            {isHistorical && <History className="h-4 w-4 text-gray-400 mr-1" />}
            <div>
              <p className="font-medium text-gray-900">
                {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
              </p>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>{cycle.transactionCount} transactions</span>
                {(cycle.creditCardMask || card?.mask) && <span>•••• {cycle.creditCardMask || card?.mask}</span>}
              </div>
            </div>
          </div>
          <div className="text-right">
            {cycle.statementBalance && cycle.statementBalance !== cycle.totalSpend ? (
              <div>
                <p className="font-semibold text-lg text-blue-600">{formatCurrency(cycle.statementBalance)}</p>
                <p className="text-xs text-blue-500">Statement Balance</p>
                <p className="text-sm text-gray-600">{formatCurrency(cycle.totalSpend)} spent this cycle</p>
              </div>
            ) : (
              <p className="font-semibold text-lg text-gray-900">{formatCurrency(cycle.totalSpend)}</p>
            )}
            {shouldShowDueDate && (
              <p className={`text-sm ${
                isOverdue ? 'text-red-600' : isDueSoon ? 'text-yellow-600' : 'text-green-600'
              }`}>
                Due: {formatDate(cycle.dueDate!)}
                {daysUntilDue !== null && (
                  <span className="block">
                    ({Math.abs(daysUntilDue)} days {isOverdue ? 'overdue' : 'remaining'})
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        
        {shouldShowDueDate && (
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
      {Object.entries(cyclesByCard).map(([cardName, cardCycles]) => {
        const colorIndex = getCardColorIndex(cardName);
        const card = cards.find(c => c.name === cardName);
        const isExpanded = expandedCards.has(cardName);
        
        // Separate cycles: those with statement balance (prior/closed) and current/recent ones
        console.log('=== BILLING CYCLE FILTERING DEBUG for', cardName, '===');
        console.log('Total cycles received:', cardCycles.length);
        console.log('All cycles:', cardCycles.map(c => ({
          id: c.id,
          startDate: c.startDate,
          endDate: c.endDate,
          statementBalance: c.statementBalance,
          totalSpend: c.totalSpend,
          transactionCount: c.transactionCount
        })));
        
        const closedCycles = cardCycles.filter(c => c.statementBalance && c.statementBalance > 0);
        const currentCycles = cardCycles.filter(c => !c.statementBalance || c.statementBalance <= 0);
        
        console.log('Closed cycles (with statement balance):', closedCycles.length);
        console.log('Current cycles (no statement balance):', currentCycles.length);
        console.log('=== END FILTERING DEBUG ===');
        
        const allRecentCycles = [...closedCycles.slice(0, 1), ...currentCycles.slice(0, 1)]; // Show 1 closed + 1 current
        const historical = cardCycles.slice(2); // All others beyond the first 2

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
                {/* Show closed cycle with statement balance first */}
                {closedCycles.slice(0, 1).map(cycle => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    card={card}
                    isHistorical={false}
                  />
                ))}
                
                {/* Show current cycle */}
                {currentCycles.slice(0, 1).map(cycle => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    card={card}
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
                          card={card}
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