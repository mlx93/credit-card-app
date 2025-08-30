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

// Helper function to detect Capital One cards
function isCapitalOneCard(cardName?: string): boolean {
  const capitalOneIndicators = ['capital one', 'quicksilver', 'venture', 'savor', 'spark'];
  return capitalOneIndicators.some(indicator => 
    cardName?.toLowerCase().includes(indicator)
  ) || false;
}

interface CardBillingCyclesProps {
  cycles: BillingCycle[];
  cards: CreditCardInfo[];
  cardOrder?: string[]; // Optional card order from parent (card IDs)
  onOrderChange?: (order: string[]) => void; // Callback to sync order changes with parent
  compactMode?: boolean; // For horizontal card columns display
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

// BillingCycleItem Component - Updated with compactMode support
const BillingCycleItem = ({ cycle, card, isHistorical = false, allCycles = [], compactMode = false }: { cycle: BillingCycle, card?: CreditCardInfo, isHistorical?: boolean, allCycles?: BillingCycle[], compactMode?: boolean }) => {
  const daysUntilDue = cycle.dueDate ? getDaysUntil(cycle.dueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
  
  // Smart payment status analysis using iterative approach
  let paymentStatus: 'paid' | 'outstanding' | 'current' | 'due' = 'current';
  let paymentAnalysis = '';
  
  
  // Only analyze cycles with statement balances when we have full data
  if (cycle.statementBalance && cycle.statementBalance > 0 && card && allCycles && allCycles.length > 0) {
    const currentBalance = Math.abs(card.balanceCurrent || 0);
    
    // Step 1: Find current open cycle (the one that includes today's date)
    const today = new Date();
    const openCycle = allCycles.find(c => {
      const cycleStart = new Date(c.startDate);
      const cycleEnd = new Date(c.endDate);
      return today >= cycleStart && today <= cycleEnd;
    });
    
    // Use the same balance-based calculation as billingCycles.ts for current cycle spend
    // This ensures we get the same $383 value that's displayed in the UI
    let openCycleSpend = 0;
    if (openCycle && new Date(openCycle.endDate) > today) {
      // Current cycle: committed charges = current balance - last statement balance
      // We need to find the most recent closed cycle to get the last statement balance
      const closedCycles = allCycles.filter(c => 
        c.statementBalance && c.statementBalance > 0
      ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
      
      const mostRecentClosedCycle = closedCycles[0];
      const lastStatementBalance = Math.abs(mostRecentClosedCycle?.statementBalance || 0);
      openCycleSpend = Math.max(0, currentBalance - lastStatementBalance);
      
    } else {
      // For completed cycles, use the stored totalSpend
      openCycleSpend = openCycle?.totalSpend || 0;
    }
    
    
    // Find ALL closed cycles (with statement balance), sorted by end date
    const allClosedCycles = allCycles.filter(c => 
      c.statementBalance && c.statementBalance > 0
    ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    
    // The most recent closed cycle is the first one in the sorted list
    const mostRecentClosedCycle = allClosedCycles[0];
    const mostRecentClosedBalance = mostRecentClosedCycle?.statementBalance || 0;
    
    // Step 2: Calculate what's accounted for by recent activity
    // Current Balance - Most Recent Statement - Current Cycle Spend = Amount from older cycles
    const accountedFor = mostRecentClosedBalance + openCycleSpend;
    const remainingFromOlderCycles = currentBalance - accountedFor;
    
    // Check if this cycle IS the most recent closed cycle (should show "Due By")
    
    if (mostRecentClosedCycle && cycle.id === mostRecentClosedCycle.id) {
      paymentStatus = 'due';
      paymentAnalysis = `Most recent closed cycle - Due By ${cycle.dueDate ? formatDate(cycle.dueDate) : 'NO DUE DATE'}`;
    }
    // Step 3: Check if older cycles are paid
    else {
      // If remaining is negative or zero, all older cycles are paid
      const allOlderCyclesPaid = remainingFromOlderCycles <= 0;
      
      
      if (allOlderCyclesPaid) {
        // All historical cycles (except most recent closed) are paid
        if (cycle.statementBalance && cycle.statementBalance > 0 && 
            new Date(cycle.endDate) < new Date(mostRecentClosedCycle?.endDate || new Date())) {
          paymentStatus = 'paid';
          paymentAnalysis = `Paid - all older cycles accounted for (remaining: ${formatCurrency(remainingFromOlderCycles)})`;
        } else if (!cycle.statementBalance || cycle.statementBalance === 0) {
          paymentStatus = 'current';
          paymentAnalysis = `Current cycle - no statement balance yet`;
        } else {
          paymentStatus = 'current';
          paymentAnalysis = `Current or future cycle`;
        }
      } else {
        // There's outstanding balance from older cycles - determine which cycles are outstanding
        // Start with the remaining balance and work through cycles from newest to oldest
        const historicalCycles = allCycles.filter(c => 
          c.statementBalance && c.statementBalance > 0 && 
          c.id !== mostRecentClosedCycle?.id && // Exclude most recent closed cycle
          c.id !== openCycle?.id && // Exclude open cycle
          new Date(c.endDate) < new Date(mostRecentClosedCycle?.endDate || new Date()) // Only older cycles
        ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()); // Newest to oldest
        
        let remainingUnpaid = remainingFromOlderCycles; // Start with the outstanding amount
        let foundThisCycle = false;
        
        
        // Work through historical cycles from newest to oldest
        for (const historicalCycle of historicalCycles) {
          if (historicalCycle.id === cycle.id) {
            foundThisCycle = true;
            if (remainingUnpaid > 0) {
              // There's still unpaid balance when we reach this cycle - it's outstanding
              const unpaidAmount = Math.min(remainingUnpaid, historicalCycle.statementBalance || 0);
              paymentStatus = 'outstanding';
              paymentAnalysis = `Outstanding - ${formatCurrency(unpaidAmount)} of ${formatCurrency(historicalCycle.statementBalance || 0)} unpaid`;
              
            } else {
              // No remaining unpaid balance - this cycle is paid
              paymentStatus = 'paid';
              paymentAnalysis = `Paid - covered by account balance`;
            }
            break;
          }
          
          // Subtract this cycle's balance from remaining unpaid amount
          remainingUnpaid -= historicalCycle.statementBalance || 0;
        }
        
        // If this cycle wasn't found in historical cycles, determine status
        if (!foundThisCycle) {
          if (cycle.statementBalance && cycle.statementBalance > 0 && 
              new Date(cycle.endDate) < new Date(mostRecentClosedCycle?.endDate || new Date())) {
            // This is a historical cycle - assume paid if we didn't find it in the iteration
            paymentStatus = 'paid';
            paymentAnalysis = `Historical cycle - not in outstanding calculation`;
          } else {
            paymentStatus = 'current';
            paymentAnalysis = `Current cycle`;
          }
        }
      }
    }
    
  } else {
    
    // For cycles without statement balances or incomplete data, determine status differently
    if (cycle.statementBalance && cycle.statementBalance > 0 && new Date(cycle.endDate) < new Date()) {
      // This is a historical cycle with statement balance but missing other data - likely paid
      paymentStatus = 'paid';
      paymentAnalysis = 'Historical cycle with statement balance - likely paid';
    }
  }
  
  // Hide due date info if total spend and statement balance are both $0
  const shouldShowDueDate = cycle.dueDate && (cycle.totalSpend > 0 || (cycle.statementBalance && cycle.statementBalance > 0));

  // Compact mode for horizontal card columns
  if (compactMode) {
    return (
      <div className="p-3 rounded-lg bg-white/60 backdrop-blur-sm border border-white/40 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-700 truncate">
              {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
            </p>
            <p className="text-xs text-gray-500">
              {cycle.transactionCount} transactions • {formatCurrency(cycle.totalSpend)}
            </p>
          </div>
          <div className="text-right ml-2">
            {cycle.statementBalance ? (
              <div className="flex items-center gap-1">
                <p className="text-sm font-semibold text-gray-900">
                  {formatCurrency(cycle.statementBalance)}
                </p>
                {paymentStatus === 'paid' && (
                  <div className="w-3 h-3 rounded-full bg-green-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {paymentStatus === 'outstanding' && (
                  <div className="w-3 h-3 rounded-full bg-red-100 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">{formatCurrency(cycle.totalSpend)}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full mode for the main billing cycles view
  return (
    <div 
      className={`
        relative p-4 rounded-2xl
        ${isHistorical 
          ? 'bg-gradient-to-b from-gray-50 to-gray-100/50 shadow-sm' 
          : 'bg-gradient-to-b from-white to-gray-50/30 shadow-md shadow-gray-200/50'
        }
        border border-gray-200/60
        backdrop-blur-xl
        transition-all duration-200
        hover:shadow-lg hover:shadow-gray-200/60
        hover:scale-[1.01]
        hover:border-gray-300/60
      `}
      style={{
        background: isHistorical 
          ? 'linear-gradient(135deg, rgba(249, 250, 251, 0.95) 0%, rgba(243, 244, 246, 0.85) 100%)'
          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.9) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isHistorical && <History className="h-3.5 w-3.5 text-gray-400" />}
            <p className="text-sm font-medium text-gray-700">
              {formatDate(cycle.startDate)} - {formatDate(cycle.endDate)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{cycle.transactionCount} transactions</span>
            {(cycle.creditCardMask || card?.mask) && <span className="text-gray-400">•••• {cycle.creditCardMask || card?.mask}</span>}
          </div>
        </div>
        
        <div className="text-right">
          {cycle.statementBalance ? (
            <div>
              {paymentStatus === 'paid' ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs font-medium text-gray-500">Paid</span>
                    <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(cycle.statementBalance)}</p>
                </div>
              ) : paymentStatus === 'due' ? (
                <div 
                  className="relative -m-2 p-3 rounded-xl border-2 border-orange-300 bg-gradient-to-b from-white to-gray-50/30 shadow-sm"
                  style={{
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                >
                  <div className="space-y-2">
                    {/* Line 1: DUE + Date */}
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-bold text-orange-700 uppercase tracking-wide">DUE</p>
                      <p className="text-sm font-bold text-gray-900">
                        {cycle.dueDate ? formatDate(cycle.dueDate) : 'Date Missing'}
                      </p>
                    </div>
                    {/* Line 2: Amount + Days Remaining */}
                    <div className="flex justify-between items-center gap-4">
                      <p className="text-xl font-black text-gray-900">{formatCurrency(cycle.statementBalance)}</p>
                      {daysUntilDue !== null && (
                        <p className="text-xs font-medium text-orange-600 flex-shrink-0">
                          {daysUntilDue > 0 ? `${daysUntilDue} Days Left` : 
                           daysUntilDue === 0 ? 'DUE TODAY' : 
                           `${Math.abs(daysUntilDue)} days overdue`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : paymentStatus === 'outstanding' ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-600">Outstanding</p>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(cycle.statementBalance)}</p>
                </div>
              ) : paymentStatus === 'current' ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Current</p>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(cycle.statementBalance)}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Balance</p>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(cycle.statementBalance)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Spent</p>
              <p className="text-lg font-semibold text-gray-800">{formatCurrency(cycle.totalSpend)}</p>
            </div>
          )}
        </div>
      </div>
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
  allCycles,
  compactMode = false
}: {
  cardName: string;
  cardCycles: BillingCycle[];
  card?: CreditCardInfo;
  colorIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  allCycles: BillingCycle[];
  compactMode?: boolean;
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
        compactMode={compactMode}
      />
    </div>
  );
}

export function CardBillingCycles({ cycles, cards, cardOrder: propCardOrder, onOrderChange, compactMode = false }: CardBillingCyclesProps) {
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
    console.log(`🔄 toggleCardExpansion called for ${cardName}:`, {
      cardName,
      currentExpanded: Array.from(expandedCards),
      wasExpanded: expandedCards.has(cardName)
    });
    
    const newExpanded = new Set(expandedCards);
    if (newExpanded.has(cardName)) {
      newExpanded.delete(cardName);
      console.log(`➖ Removing ${cardName} from expanded`);
    } else {
      newExpanded.add(cardName);
      console.log(`➕ Adding ${cardName} to expanded`);
    }
    
    console.log(`🔄 Setting new expanded cards:`, Array.from(newExpanded));
    setExpandedCards(newExpanded);
  };

  const getCardColorIndex = (cardName: string, cardId?: string) => {
    // Simple index-based assignment to guarantee different colors
    const cardNames = Object.keys(cyclesByCard).sort(); // Sort for consistency
    const cardIndex = cardNames.indexOf(cardName);
    const colorIndex = cardIndex >= 0 ? cardIndex % cardColors.length : 0;
    return colorIndex;
  };

  // Initialize card order only once when component mounts or when cards first become available
  useEffect(() => {
    const cardNames = Object.keys(cyclesByCard);
    
    // Only initialize if we don't have an order set yet and we have cards
    if (cardOrder.length === 0 && cardNames.length > 0) {
      if (propCardOrder && propCardOrder.length > 0) {
        // Use the initial order from parent - convert card IDs to card names
        const orderedCardNames = propCardOrder
          .map(cardId => {
            const card = cards.find(c => c.id === cardId);
            return card ? card.name : null;
          })
          .filter((name): name is string => name !== null && cardNames.includes(name));
        
        // Add any remaining cards not in the provided order
        const remainingCards = cardNames.filter(name => !orderedCardNames.includes(name));
        setCardOrder([...orderedCardNames, ...remainingCards]);
      } else {
        setCardOrder(cardNames);
      }
    }
    // Handle new cards being added (but don't re-sync existing order)
    else if (cardOrder.length > 0) {
      const newCards = cardNames.filter(name => !cardOrder.includes(name));
      if (newCards.length > 0) {
        setCardOrder(prev => [...prev, ...newCards]);
      }
    }
  }, [cyclesByCard, cards]); // Removed propCardOrder dependency to prevent re-syncing

  // Initialize expandedCards to be empty (historical cycles default to closed)
  // Only run this once on mount, not on every cyclesByCard change
  useEffect(() => {
    // Historical cycles default to closed, so keep expandedCards as empty Set
    setExpandedCards(new Set());
  }, []); // Empty dependency array - only run once on mount

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
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        // Independent drag and drop - no longer sync with other components
        
        return newOrder;
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
            const card = cards.find(c => c.name === cardName);
            const colorIndex = getCardColorIndex(cardName, card?.id);
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
                compactMode={compactMode}
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
  dragHandleProps,
  compactMode = false
}: {
  cardName: string;
  cardCycles: BillingCycle[];
  card?: CreditCardInfo;
  colorIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  allCycles: BillingCycle[];
  dragHandleProps?: any;
  compactMode?: boolean;
}) {
  // Sort cycles by end date (newest first) to properly identify recent cycles
  const sortedCycles = [...cardCycles].sort((a, b) => 
    new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
  );
  
  const today = new Date();
  
  // Find current ongoing cycle and most recently closed cycle
  let recentCycles = [];
  let historicalCycles = [];
  
  if (sortedCycles.length > 0) {
    
    // Find current ongoing cycle (cycle that includes today)
    const currentCycle = sortedCycles.find(c => {
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      const includesHEOday = today >= start && today <= end;
      
      
      return includesHEOday;
    });
    
    // Find most recently closed cycle (has statement balance and ended before today)
    const mostRecentClosedCycle = sortedCycles.find(c => {
      const end = new Date(c.endDate);
      const hasStatement = c.statementBalance && c.statementBalance > 0;
      const endedBeforeToday = end < today;
      const qualifies = hasStatement && endedBeforeToday;
      
      
      return qualifies;
    });
    
    // Show current cycle first (if it exists)
    if (currentCycle) {
      recentCycles.push(currentCycle);
    }
    
    // Show most recently closed cycle (if it exists and is different from current)
    if (mostRecentClosedCycle && (!currentCycle || mostRecentClosedCycle.id !== currentCycle.id)) {
      recentCycles.push(mostRecentClosedCycle);
    }
    
    // All other cycles are historical
    const shownCycleIds = new Set(recentCycles.map(c => c.id));
    historicalCycles = sortedCycles.filter(c => !shownCycleIds.has(c.id));
    
  }
  
  const allRecentCycles = recentCycles;
  const historical = historicalCycles;
  
  // For backward compatibility with existing code references
  const recentClosedCycle = recentCycles.filter(c => c.statementBalance && c.statementBalance > 0);
  const recentCurrentCycle = recentCycles.filter(c => !c.statementBalance || c.statementBalance <= 0);

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
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">{cardName}</h3>
                {isCapitalOneCard(cardName) && (
                  <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-md font-medium">
                    90d
                  </span>
                )}
              </div>
              {card && <p className="text-sm text-gray-600">•••• {card.mask}</p>}
            </div>
          </div>
          {historical.length > 0 && (
            <button
              onClick={() => {
                console.log(`🔘 Historical cycles button clicked for ${cardName}:`, {
                  cardName,
                  isExpanded,
                  historicalCount: historical.length,
                  onToggleExpand: typeof onToggleExpand
                });
                onToggleExpand();
              }}
              className="flex items-center text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-all duration-200 -mb-px"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
              {historical.length} older cycle{historical.length !== 1 ? 's' : ''}
            </button>
          )}
              </div>

              <div className="space-y-3">
                {/* Show recent current cycle first */}
                {recentCurrentCycle.map(cycle => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    card={card}
                    isHistorical={false}
                    allCycles={allCycles}
                    compactMode={compactMode}
                  />
                ))}
                
                {/* Show recent closed cycle with statement balance second */}
                {recentClosedCycle.map(cycle => (
                  <BillingCycleItem 
                    key={cycle.id} 
                    cycle={cycle}
                    card={card}
                    isHistorical={false}
                    allCycles={allCycles}
                    compactMode={compactMode}
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
                          compactMode={compactMode}
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