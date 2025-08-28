import { useState, useEffect } from 'react';
import { formatCurrency, formatDate, getDaysUntil } from '@/utils/format';
import { Calendar, CreditCard, ChevronDown, ChevronRight, History, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

// BillingCycleItem Component
const BillingCycleItem = ({ cycle, card, isHistorical = false, allCycles = [] }: { cycle: BillingCycle, card?: CreditCardInfo, isHistorical?: boolean, allCycles?: BillingCycle[] }) => {
  const daysUntilDue = cycle.dueDate ? getDaysUntil(cycle.dueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
  
  // Smart payment status analysis using iterative approach
  let paymentStatus: 'paid' | 'outstanding' | 'current' | 'due' = 'current';
  let paymentAnalysis = '';
  
  // Only analyze cycles with statement balances when we have full data
  if (cycle.statementBalance && cycle.statementBalance > 0 && card && allCycles && allCycles.length > 0) {
    const currentBalance = Math.abs(card.balanceCurrent || 0);
    
    // Step 1: Find current open cycle and most recent closed cycle
    const openCycle = allCycles.find(c => !c.statementBalance || c.statementBalance === 0);
    const openCycleSpend = openCycle?.totalSpend || 0;
    
    // Find ALL closed cycles (with statement balance), sorted by end date
    const allClosedCycles = allCycles.filter(c => 
      c.statementBalance && c.statementBalance > 0
    ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    
    // The most recent closed cycle is the first one in the sorted list
    const mostRecentClosedCycle = allClosedCycles[0];
    const mostRecentClosedBalance = mostRecentClosedCycle?.statementBalance || 0;
    
    // Step 2: Calculate baseline (current open cycle + most recent closed cycle)
    const baseline = openCycleSpend + mostRecentClosedBalance;
    
    // Check if this cycle IS the most recent closed cycle (should show "Due By")
    if (mostRecentClosedCycle && cycle.id === mostRecentClosedCycle.id) {
      paymentStatus = 'due';
      paymentAnalysis = `Most recent closed cycle - Due By ${formatDate(cycle.dueDate)}`;
    }
    // Step 3: Calculate remaining balance after accounting for current activity
    // Remaining = Current Balance - Most Recent Closed - Open Cycle Spend
    else {
      const remainingAfterCurrent = currentBalance - baseline;
      
      if (remainingAfterCurrent <= 0) {
        // All historical cycles (except most recent closed) are paid
        paymentStatus = 'paid';
        paymentAnalysis = `Paid - remaining after current (${formatCurrency(remainingAfterCurrent)}) ≤ 0`;
      } else {
        // Step 4: Check historical cycles from newest to oldest
        const historicalCycles = allCycles.filter(c => 
          c.statementBalance && c.statementBalance > 0 && 
          c.id !== mostRecentClosedCycle?.id && // Exclude most recent closed cycle
          c.id !== openCycle?.id // Exclude open cycle
        ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()); // Newest to oldest
        
        let remainingBalance = remainingAfterCurrent;
        let foundThisCycle = false;
        
        for (const historicalCycle of historicalCycles) {
          if (historicalCycle.id === cycle.id) {
            foundThisCycle = true;
            if (remainingBalance > 0) {
              paymentStatus = 'outstanding';
              paymentAnalysis = `Outstanding - ${formatCurrency(remainingBalance)} still owed from older cycles`;
            } else {
              paymentStatus = 'paid';
              paymentAnalysis = `Paid - all newer cycles accounted for`;
            }
            break;
          }
          // Subtract this historical cycle from remaining balance
          remainingBalance -= historicalCycle.statementBalance || 0;
        }
        
        // If this cycle wasn't found in historical cycles, it might be current/future
        if (!foundThisCycle) {
          paymentStatus = 'current';
          paymentAnalysis = `Current or future cycle`;
        }
      }
    }
    
    console.log('Payment analysis for', cycle.creditCardName || card?.name, formatDate(cycle.endDate), {
      cycleId: cycle.id,
      currentBalance,
      openCycleSpend,
      mostRecentClosedBalance,
      baseline,
      remainingAfterBaseline: currentBalance - baseline,
      statementBalance: cycle.statementBalance,
      isMostRecentClosed: mostRecentClosedCycle?.id === cycle.id,
      paymentStatus,
      paymentAnalysis,
      cycleEndDate: formatDate(cycle.endDate)
    });
    }
  }
  
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
              {paymentStatus === 'paid' ? (
                <div>
                  <p className="font-semibold text-lg text-green-600">✅ Paid</p>
                  <p className="text-xs text-green-500">Was {formatCurrency(cycle.statementBalance)}</p>
                  <p className="text-sm text-gray-600">{formatCurrency(cycle.totalSpend)} spent this cycle</p>
                </div>
              ) : paymentStatus === 'due' ? (
                <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 -m-2">
                  <p className="font-bold text-lg text-yellow-800">DUE BY</p>
                  <p className="font-bold text-xl text-yellow-900">{formatDate(cycle.dueDate!)}</p>
                  <p className="font-semibold text-2xl text-yellow-900">{formatCurrency(cycle.statementBalance)}</p>
                  {daysUntilDue !== null && daysUntilDue > 0 && (
                    <p className="text-sm font-medium text-yellow-700">{daysUntilDue} days remaining</p>
                  )}
                  <p className="text-sm text-gray-600 mt-1">{formatCurrency(cycle.totalSpend)} spent this cycle</p>
                </div>
              ) : paymentStatus === 'outstanding' ? (
                <div>
                  <p className="font-semibold text-lg text-red-600">{formatCurrency(cycle.statementBalance)}</p>
                  <p className="text-xs text-red-500">Still Outstanding</p>
                  <p className="text-sm text-gray-600">{formatCurrency(cycle.totalSpend)} spent this cycle</p>
                  {paymentAnalysis && <p className="text-xs text-gray-500 mt-1">{paymentAnalysis}</p>}
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-lg text-blue-600">{formatCurrency(cycle.statementBalance)}</p>
                  <p className="text-xs text-blue-500">Statement Balance</p>
                  <p className="text-sm text-gray-600">{formatCurrency(cycle.totalSpend)} spent this cycle</p>
                </div>
              )}
            </div>
          ) : (
            <p className="font-semibold text-lg text-gray-900">{formatCurrency(cycle.totalSpend)}</p>
          )}
          {shouldShowDueDate && paymentStatus !== 'due' && (
            <p className={`text-sm ${
              paymentStatus === 'paid' ? 'text-green-600' : 
              isOverdue && paymentStatus !== 'paid' ? 'text-red-600' : 
              isDueSoon && paymentStatus !== 'paid' ? 'text-yellow-600' : 'text-green-600'
            }`}>
              {paymentStatus === 'paid' ? 'Paid by:' : 'Due:'} {formatDate(cycle.dueDate!)}
              {daysUntilDue !== null && paymentStatus !== 'paid' && (
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
            paymentStatus === 'paid'
              ? 'bg-green-100 text-green-800'
              : paymentStatus === 'due'
                ? 'bg-yellow-100 text-yellow-800'
              : paymentStatus === 'outstanding'
                ? 'bg-orange-100 text-orange-800'
              : isOverdue
                ? 'bg-red-100 text-red-800'
                : isDueSoon
                  ? 'bg-yellow-100 text-yellow-800' 
                  : 'bg-green-100 text-green-800'
          }`}>
{paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'due' ? 'Due' : paymentStatus === 'outstanding' ? 'Outstanding' : paymentStatus === 'current' ? (isDueSoon ? 'Due Soon' : 'Current') : isOverdue ? 'Overdue' : 'On Track'}
          </span>
        </div>
      )}
    </div>
  );
};

// Sortable Card Component
function SortableCard({ 
  cardName, 
  cardCycles, 
  card, 
  colorIndex, 
  isExpanded, 
  onToggleExpand,
  allCycles
}: {
  cardName: string;
  cardCycles: BillingCycle[];
  card?: CreditCardInfo;
  colorIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  allCycles: BillingCycle[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardName });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <CardContent 
        cardName={cardName}
        cardCycles={cardCycles}
        card={card}
        colorIndex={colorIndex}
        isExpanded={isExpanded}
        onToggleExpand={onToggleExpand}
        allCycles={allCycles}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

export function CardBillingCycles({ cycles, cards }: CardBillingCyclesProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [cardOrder, setCardOrder] = useState<string[]>([]);

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

  // Initialize card order when cycles change
  useEffect(() => {
    const cardNames = Object.keys(cyclesByCard);
    if (cardOrder.length === 0 && cardNames.length > 0) {
      setCardOrder(cardNames);
    } else if (cardOrder.length > 0) {
      // Add any new cards that aren't in the order
      const newCards = cardNames.filter(name => !cardOrder.includes(name));
      if (newCards.length > 0) {
        setCardOrder([...cardOrder, ...newCards]);
      }
    }
  }, [cyclesByCard]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCardOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Filter and sort cards based on cardOrder
  const orderedCards = cardOrder
    .filter(cardName => cyclesByCard[cardName])
    .map(cardName => ({
      cardName,
      cardCycles: cyclesByCard[cardName]
    }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={cardOrder}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-6">
          {orderedCards.map(({ cardName, cardCycles }) => {
            const colorIndex = getCardColorIndex(cardName);
            const card = cards.find(c => c.name === cardName);
            const isExpanded = expandedCards.has(cardName);

            return (
              <SortableCard
                key={cardName}
                cardName={cardName}
                cardCycles={cardCycles}
                card={card}
                colorIndex={colorIndex}
                isExpanded={isExpanded}
                onToggleExpand={() => toggleCardExpansion(cardName)}
                allCycles={cycles}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// Card Content Component (extracted from the original render)
function CardContent({
  cardName,
  cardCycles,
  card,
  colorIndex,
  isExpanded,
  onToggleExpand,
  allCycles,
  dragHandleProps
}: {
  cardName: string;
  cardCycles: BillingCycle[];
  card?: CreditCardInfo;
  colorIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  allCycles: BillingCycle[];
  dragHandleProps?: any;
}) {
  const closedCycles = cardCycles.filter(c => c.statementBalance && c.statementBalance > 0);
  const currentCycles = cardCycles.filter(c => !c.statementBalance || c.statementBalance <= 0);
  const allRecentCycles = [...closedCycles.slice(0, 1), ...currentCycles.slice(0, 1)];
  const historical = cardCycles.slice(2);

  return (
    <div className={`rounded-lg border-2 ${cardColors[colorIndex]} ${cardBorderColors[colorIndex]} border-l-4`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div {...dragHandleProps} className="cursor-move mr-2">
              <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-600" />
            </div>
            <CreditCard className="h-5 w-5 text-gray-600 mr-2" />
            <div>
              <h3 className="font-semibold text-gray-900">{cardName}</h3>
              {card && <p className="text-sm text-gray-600">•••• {card.mask}</p>}
            </div>
          </div>
          {historical.length > 0 && (
            <button
              onClick={onToggleExpand}
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
                    allCycles={allCycles}
                  />
                ))}
                
                {/* Show current cycle */}
                {currentCycles.slice(0, 1).map(cycle => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    card={card}
                    isHistorical={false}
                    allCycles={allCycles}
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
                          allCycles={allCycles}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
  );
}