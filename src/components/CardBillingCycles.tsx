import { useState, useEffect } from 'react';
import { formatCurrency, formatDate, getDaysUntil } from '@/utils/format';
import { normalizeCardDisplayName } from '@/utils/cardName';
import { Calendar, CreditCard, ChevronDown, ChevronRight, History } from 'lucide-react';
import CycleDateEditor from './CycleDateEditor';

// Helper function to format date ranges smartly
function formatDateRange(startDate: Date | string, endDate: Date | string): string {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  
  // Format start date without year if same year as end date
  const startFormatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(startYear !== endYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC'
  }).format(start);
  
  // Always include year in end date
  const endFormatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(end);
  
  return `${startFormatted} - ${endFormatted}`;
}

interface BillingCycle {
  id: string;
  creditCardName: string;
  creditCardMask?: string;
  startDate: Date;
  endDate: Date;
  totalSpend: number;
  transactioncount: number;
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
  lastStatementIssueDate?: string | null;
  nextPaymentDueDate?: string | null;
  minimumPaymentAmount?: number;
  manual_cycle_day?: number | null;
  manual_due_day?: number | null;
  manual_dates_configured?: boolean;
  cycle_date_type?: 'same_day' | 'days_before_end' | null;
  cycle_days_before_end?: number | null;
  due_date_type?: 'same_day' | 'days_before_end' | null;
  due_days_before_end?: number | null;
  plaidItem?: {
    institutionName?: string;
    institutionId?: string;
  };
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
  cardOrder?: string[]; // Card order from parent (card IDs or names)
  compactMode?: boolean; // For horizontal card columns display
  olderCyclesLoadingIds?: string[]; // Card IDs whose historical cycles are still loading
  fullCyclesLoading?: boolean; // Global loading state for when full cycles are being fetched
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
  
  // Check payment status indicators
  const hasZeroBalance = card && Math.abs(card.balanceCurrent || 0) < 0.01;
  const today = new Date();
  const cycleEnded = new Date(cycle.endDate) < today;
  
  // Debug logging for payment status detection
  console.log(`🔍 Payment status debug for ${cycle.creditCardName} ending ${cycle.endDate}:`, {
    minimumPayment: cycle.minimumPayment,
    statementBalance: cycle.statementBalance,
    totalSpend: cycle.totalSpend,
    currentBalance: card?.balanceCurrent,
    hasZeroBalance,
    cycleEnded
  });
  
  if (hasZeroBalance && cycleEnded) {
    paymentStatus = 'paid';
    paymentAnalysis = 'Paid - card has $0 balance';
  }
  // Analyze cycles when we have full data - use statementBalance if available, otherwise totalSpend
  else if ((cycle.statementBalance > 0 || cycle.totalSpend > 0) && card && allCycles && allCycles.length > 0) {
    const currentBalance = Math.abs(card.balanceCurrent || 0);
    
    // Step 1: Find current open cycle (the one that includes today's date)
    const today = new Date();
    const openCycle = allCycles.find(c => {
      const cycleStart = new Date(c.startDate);
      const cycleEnd = new Date(c.endDate);
      return today >= cycleStart && today <= cycleEnd;
    });
    
    // CRITICAL: If this cycle IS the current open cycle, it should always be marked as "current"
    if (openCycle && cycle.id === openCycle.id) {
      paymentStatus = 'current';
      paymentAnalysis = 'Current open cycle - ongoing spending';
      console.log(`✅ Marking cycle ${cycle.id} as CURRENT (open cycle)`);
    } else {
    
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
      // Use statementBalance if available, otherwise use totalSpend (for Robinhood, etc.)
      const lastStatementBalance = Math.abs(mostRecentClosedCycle?.statementBalance || mostRecentClosedCycle?.totalSpend || 0);
      openCycleSpend = Math.max(0, currentBalance - lastStatementBalance);
      
    } else {
      // For completed cycles, use the stored totalSpend
      openCycleSpend = openCycle?.totalSpend || 0;
    }
    
    
    // Find ALL closed cycles (with statement balance OR totalSpend), sorted by end date
    const allClosedCycles = allCycles.filter(c => 
      (c.statementBalance && c.statementBalance > 0) || c.totalSpend > 0
    ).sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
    
    // The most recent closed cycle is the first one in the sorted list
    const mostRecentClosedCycle = allClosedCycles[0];
    // Use statementBalance if available, otherwise use totalSpend
    const mostRecentClosedBalance = mostRecentClosedCycle?.statementBalance || mostRecentClosedCycle?.totalSpend || 0;
    
    // Step 2: Calculate what's accounted for by recent activity
    // Current Balance - Most Recent Statement - Current Cycle Spend = Amount from older cycles
    const accountedFor = mostRecentClosedBalance + openCycleSpend;
    const remainingFromOlderCycles = currentBalance - accountedFor;
    
    // Check if this cycle IS the most recent closed cycle (should show "Due By" or "Outstanding")
    
    if (mostRecentClosedCycle && cycle.id === mostRecentClosedCycle.id) {
      // For the most recent closed cycle, check payment status
      const cycleAmount = cycle.statementBalance || cycle.totalSpend || 0;
      
      // If current balance >= cycle amount, it hasn't been paid
      if (currentBalance >= cycleAmount && cycleAmount > 0) {
        // Check if the due date has passed (overdue)
        if (cycle.dueDate && new Date(cycle.dueDate) < new Date()) {
          paymentStatus = 'outstanding';
          const daysOverdue = Math.floor((new Date().getTime() - new Date(cycle.dueDate).getTime()) / (1000 * 60 * 60 * 24));
          paymentAnalysis = `Most recent closed cycle - OVERDUE by ${daysOverdue} days (balance: ${formatCurrency(currentBalance)}, statement: ${formatCurrency(cycleAmount)})`;
        } else {
          paymentStatus = 'due';
          paymentAnalysis = `Most recent closed cycle - Due By ${cycle.dueDate ? formatDate(cycle.dueDate) : 'NO DUE DATE'} (unpaid: ${formatCurrency(cycleAmount)})`;
        }
      } else {
        // Current balance < cycle amount means it's been at least partially paid
        paymentStatus = 'paid';
        paymentAnalysis = `Most recent closed cycle - Paid (current: ${formatCurrency(currentBalance)} < statement: ${formatCurrency(cycleAmount)})`;
      }
    }
    // Step 3: Check if older cycles are paid
    else {
      // If remaining is negative or zero, all older cycles are paid
      const allOlderCyclesPaid = remainingFromOlderCycles <= 0;
      
      
      if (allOlderCyclesPaid) {
        // All historical cycles (except most recent closed) are paid
        if ((cycle.statementBalance > 0 || cycle.totalSpend > 0) && 
            new Date(cycle.endDate) < new Date(mostRecentClosedCycle?.endDate || new Date())) {
          paymentStatus = 'paid';
          paymentAnalysis = `Paid - all older cycles accounted for (remaining: ${formatCurrency(remainingFromOlderCycles)})`;
        } else if (!cycle.statementBalance && !cycle.totalSpend) {
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
          ((c.statementBalance && c.statementBalance > 0) || c.totalSpend > 0) && 
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
              const cycleAmount = historicalCycle.statementBalance || historicalCycle.totalSpend || 0;
              const unpaidAmount = Math.min(remainingUnpaid, cycleAmount);
              paymentStatus = 'outstanding';
              paymentAnalysis = `Outstanding - ${formatCurrency(unpaidAmount)} of ${formatCurrency(cycleAmount)} unpaid`;
              
            } else {
              // No remaining unpaid balance - this cycle is paid
              paymentStatus = 'paid';
              paymentAnalysis = `Paid - covered by account balance`;
            }
            break;
          }
          
          // Subtract this cycle's balance from remaining unpaid amount (use statementBalance or totalSpend)
          const cycleAmount = historicalCycle.statementBalance || historicalCycle.totalSpend || 0;
          remainingUnpaid -= cycleAmount;
        }
        
        // If this cycle wasn't found in historical cycles, determine status
        if (!foundThisCycle) {
          if ((cycle.statementBalance > 0 || cycle.totalSpend > 0) && 
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
    
    } // Close the else block for open cycle check
    
  } else {
    
    // For cycles without statement balances or incomplete data, determine status differently
    if ((cycle.statementBalance > 0 || cycle.totalSpend > 0) && new Date(cycle.endDate) < new Date()) {
      // This is a historical cycle with spend - likely paid if old enough
      const monthsOld = Math.floor((new Date().getTime() - new Date(cycle.endDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (monthsOld > 2) {
        paymentStatus = 'paid';
        paymentAnalysis = `Historical cycle (${monthsOld} months old) - likely paid`;
      }
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
            <p className="text-xs font-medium text-gray-700">
              {formatDateRange(cycle.startDate, cycle.endDate)}
            </p>
            <p className="text-xs text-gray-500">
              {cycle.transactioncount} transactions
            </p>
          </div>
          <div className="text-right ml-2">
            {/* Always show totalSpend in Recent Billing Cycles (compact mode) */}
            <div className="flex items-center gap-1">
              <p className="text-sm font-semibold text-gray-900">
                {formatCurrency(cycle.totalSpend)}
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
              {formatDateRange(cycle.startDate, cycle.endDate)}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{cycle.transactioncount} transactions</span>
            {(cycle.creditCardMask || card?.mask) && <span className="text-gray-400">•••• {cycle.creditCardMask || card?.mask}</span>}
          </div>
        </div>
        
        <div className="text-right">
          {cycle.statementBalance ? (
            <div>
              {paymentStatus === 'paid' ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs font-medium text-green-600">Paid</span>
                    <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                  {/* Avoid showing the statement amount again when paid to prevent duplicate balances */}
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
                      <p className="text-xl font-black text-gray-900">{
                        (() => {
                          // For the most recent closed cycle, show totalSpend (non-payment spend)
                          const closed = (allCycles || [])
                            .filter(c => c.statementBalance && c.statementBalance > 0)
                            .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                          const mostRecentClosed = closed[0];
                          const useTotal = mostRecentClosed && cycle.id === mostRecentClosed.id;
                          const amount = useTotal ? (cycle.totalSpend || 0) : (cycle.statementBalance || 0);
                          return formatCurrency(amount);
                        })()
                      }</p>
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
                  <p className="text-lg font-semibold text-gray-800">{
                    (() => {
                      const closed = (allCycles || [])
                        .filter(c => c.statementBalance && c.statementBalance > 0)
                        .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                      const mostRecentClosed = closed[0];
                      const useTotal = mostRecentClosed && cycle.id === mostRecentClosed.id;
                      const amount = useTotal ? (cycle.totalSpend || 0) : (cycle.statementBalance || 0);
                      return formatCurrency(amount);
                    })()
                  }</p>
                </div>
              ) : paymentStatus === 'current' ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Current</p>
                  <p className="text-lg font-semibold text-gray-800">{
                    (() => {
                      const closed = (allCycles || [])
                        .filter(c => c.statementBalance && c.statementBalance > 0)
                        .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                      const mostRecentClosed = closed[0];
                      const useTotal = mostRecentClosed && cycle.id === mostRecentClosed.id;
                      const amount = useTotal ? (cycle.totalSpend || 0) : (cycle.statementBalance || 0);
                      return formatCurrency(amount);
                    })()
                  }</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500">Balance</p>
                  <p className="text-lg font-semibold text-gray-800">{
                    (() => {
                      const closed = (allCycles || [])
                        .filter(c => c.statementBalance && c.statementBalance > 0)
                        .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                      const mostRecentClosed = closed[0];
                      const useTotal = mostRecentClosed && cycle.id === mostRecentClosed.id;
                      const amount = useTotal ? (cycle.totalSpend || 0) : (cycle.statementBalance || 0);
                      return formatCurrency(amount);
                    })()
                  }</p>
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


export function CardBillingCycles({ cycles, cards, cardOrder, compactMode = false, olderCyclesLoadingIds = [], fullCyclesLoading = false }: CardBillingCyclesProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Group cycles by card and separate current/recent vs historical
  const cyclesByCard: Record<string, BillingCycle[]> = (() => {
    // When a single card prop is supplied (usage in HorizontalCardColumns),
    // group all incoming cycles under that single card name to avoid duplicates
    if (cards && cards.length === 1) {
      const singleName = cards[0]?.name ?? 'Card';
      return { [singleName]: cycles };
    }
    // Otherwise, fallback to grouping by creditCardId if present; else by creditCardName
    return (cycles as any[]).reduce((acc, cycle: any) => {
      const key = cycle.creditCardId || cycle.creditCardName;
      const group = String(key);
      if (!acc[group]) acc[group] = [] as any;
      (acc[group] as any).push(cycle as any);
      return acc;
    }, {} as Record<string, BillingCycle[]>);
  })();

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
    // Use all card names (including those without cycles) for consistent coloring
    const allCardNames = cards ? [...new Set([...Object.keys(cyclesByCard), ...cards.map(c => c.name)])].sort() : Object.keys(cyclesByCard).sort();
    const cardIndex = allCardNames.indexOf(cardName);
    const colorIndex = cardIndex >= 0 ? cardIndex % cardColors.length : 0;
    return colorIndex;
  };


  // Initialize expandedCards to be empty (historical cycles default to closed)
  // Only run this once on mount, not on every cyclesByCard change
  useEffect(() => {
    // Historical cycles default to closed, so keep expandedCards as empty Set
    setExpandedCards(new Set());
  }, []); // Empty dependency array - only run once on mount


  // Get card names in order from parent, or fallback to alphabetical
  const getOrderedCardNames = () => {
    // Include ALL cards (both those with cycles and those without)
    // This ensures Robinhood cards without manual configuration still appear
    const cardsWithCycles = Object.keys(cyclesByCard);
    const allCardNames = cards ? [...new Set([...cardsWithCycles, ...cards.map(c => c.name)])] : cardsWithCycles;
    
    if (cardOrder && cardOrder.length > 0) {
      // Convert card IDs to names if necessary
      const orderedNames = cardOrder
        .map(cardIdOrName => {
          // First try to find by ID
          const cardById = cards.find(c => c.id === cardIdOrName);
          if (cardById && allCardNames.includes(cardById.name)) {
            return cardById.name;
          }
          // Then try to find by name
          if (allCardNames.includes(cardIdOrName)) {
            return cardIdOrName;
          }
          return null;
        })
        .filter((name): name is string => name !== null);
      
      // Add any cards not in the provided order
      const remainingCards = allCardNames.filter(name => !orderedNames.includes(name));
      return [...orderedNames, ...remainingCards];
    }
    
    // Fallback to alphabetical
    return allCardNames.sort();
  };
  
  const cardNames = getOrderedCardNames();

  return (
    <div className="space-y-6">
      {cardNames.map((cardName) => {
        const cardCycles = cyclesByCard[cardName];
        const card = (cards && cards.length === 1) ? cards[0] : cards.find(c => c.name === cardName);
        const colorIndex = getCardColorIndex(cardName, card?.id);
        const isExpanded = expandedCards.has(cardName);
        const olderLoading = (card ? olderCyclesLoadingIds.includes(card.id) : false) || fullCyclesLoading;

        return (
          <CardContent
            key={cardName}
            cardName={cardName}
            cardCycles={cardCycles}
            card={card}
            colorIndex={colorIndex}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleCardExpansion(cardName)}
            allCycles={cycles}
            compactMode={compactMode}
            olderLoading={olderLoading}
          />
        );
      })}
    </div>
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
  compactMode = false,
  olderLoading = false
}: {
  cardName: string;
  cardCycles: BillingCycle[];
  card?: CreditCardInfo;
  colorIndex: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  allCycles: BillingCycle[];
  compactMode?: boolean;
  olderLoading?: boolean;
}) {
  // Sort cycles by end date (newest first) to properly identify recent cycles
  // Handle case where card has no cycles (e.g., Robinhood without manual configuration)
  let sortedCycles = cardCycles ? [...cardCycles].sort((a, b) => 
    new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
  ) : [];
  
  const today = new Date();
  
  // Filter out cycles that are too old for accurate data
  // Capital One: exclude cycles starting more than 90 days ago
  // Other cards: exclude cycles starting more than 12 months ago
  const isCapitalOne = cardName.toLowerCase().includes('capital one') || 
                       cardName.toLowerCase().includes('quicksilver') || 
                       cardName.toLowerCase().includes('venture') ||
                       cardName.toLowerCase().includes('savor');
  
  sortedCycles = sortedCycles.filter(cycle => {
    const cycleStartDate = new Date(cycle.startDate);
    const daysSinceStart = Math.floor((today.getTime() - cycleStartDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // Exclude future cycles (cycles that start in the future)
    if (daysSinceStart < 0) {
      console.log(`🚫 Excluding future cycle starting ${cycleStartDate.toDateString()} (${Math.abs(daysSinceStart)} days in the future)`);
      return false;
    }
    
    if (isCapitalOne) {
      // Capital One: exclude if start date is more than 90 days ago
      if (daysSinceStart > 90) {
        console.log(`🚫 Excluding old Capital One cycle starting ${cycleStartDate.toDateString()} (${daysSinceStart} days ago)`);
        return false;
      }
    } else {
      // Other cards: exclude if start date is more than 365 days ago
      if (daysSinceStart > 365) {
        console.log(`🚫 Excluding old cycle starting ${cycleStartDate.toDateString()} (${daysSinceStart} days ago)`);
        return false;
      }
    }
    
    return true;
  });
  
  // Find current ongoing cycle and most recently closed cycle
  const recentCycles = [];
  let historicalCycles = [];
  
  if (sortedCycles.length > 0) {
    
    // Debug for Amex card specifically
    if (cardName.includes('Platinum')) {
      console.log('🔍 AMEX FRONTEND CLASSIFICATION:', {
        cardName,
        totalCycles: sortedCycles.length,
        today: today.toDateString(),
        allCycles: sortedCycles.map(c => ({
          start: new Date(c.startDate).toDateString(),
          end: new Date(c.endDate).toDateString(),
          hasStatement: !!(c.statementBalance && c.statementBalance > 0),
          endedBeforeToday: new Date(c.endDate) < today,
          includesHEOday: today >= new Date(c.startDate) && today <= new Date(c.endDate)
        }))
      });
    }
    
    // Find current ongoing cycle (cycle that includes today)
    const currentCycle = sortedCycles.find(c => {
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      const includesHEOday = today >= start && today <= end;
      
      if (cardName.includes('Platinum') && includesHEOday) {
        console.log('✅ AMEX CURRENT CYCLE:', {
          start: start.toDateString(),
          end: end.toDateString()
        });
      }
      
      return includesHEOday;
    });
    
    // Find most recently closed cycle based on card's lastStatementIssueDate
    // The cycle ending on or just before the statement date is the most recent closed cycle
    const lastStatementDate = card?.lastStatementIssueDate ? new Date(card.lastStatementIssueDate) : null;
    
    let mostRecentClosedCycle = null;
    if (lastStatementDate) {
      // Find the cycle that ends on the statement date (most accurate method)
      mostRecentClosedCycle = sortedCycles.find(c => {
        const cycleEnd = new Date(c.endDate);
        const diffDays = Math.abs((cycleEnd.getTime() - lastStatementDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 1; // Allow 1-day difference for timezone/date precision
      });
      
      // Fallback: if no exact match, find the most recent cycle that ended before today
      if (!mostRecentClosedCycle) {
        mostRecentClosedCycle = sortedCycles.find(c => {
          const end = new Date(c.endDate);
          return end < today;
        });
      }
    } else {
      // Fallback for cards without statement date: look for cycles with statement balance
      const closedCyclesWithStatements = sortedCycles.filter(c => {
        const end = new Date(c.endDate);
        const hasStatement = c.statementBalance && c.statementBalance > 0;
        const endedBeforeToday = end < today;
        return hasStatement && endedBeforeToday;
      });
      mostRecentClosedCycle = closedCyclesWithStatements[0];
    }
    
    if (cardName.toLowerCase().includes('capital') && mostRecentClosedCycle) {
      console.log('✅ CAPITAL ONE MOST RECENT CLOSED:', {
        cycleId: mostRecentClosedCycle.id,
        end: new Date(mostRecentClosedCycle.endDate).toDateString(),
        statementBalance: mostRecentClosedCycle.statementBalance,
        cardBalance: card?.balanceCurrent
      });
    }
    
    // Show current cycle first (if it exists)
    if (currentCycle) {
      recentCycles.push(currentCycle);
    }
    
    // Show most recently closed cycle (if it exists and is different from current)
    if (mostRecentClosedCycle && (!currentCycle || mostRecentClosedCycle.id !== currentCycle.id)) {
      recentCycles.push(mostRecentClosedCycle);
    }
    
    // All other cycles are historical - ensure we exclude BOTH current and most recent closed
    const shownCycleIds = new Set(recentCycles.map(c => c.id));
    historicalCycles = sortedCycles.filter(c => !shownCycleIds.has(c.id));
    
    // Additional logging for Capital One to debug classification
    if (cardName.toLowerCase().includes('capital')) {
      console.log('🎯 CAPITAL ONE CYCLE CLASSIFICATION:', {
        cardName,
        totalCycles: sortedCycles.length,
        currentCycleId: currentCycle?.id,
        mostRecentClosedId: mostRecentClosedCycle?.id,
        recentCyclesCount: recentCycles.length,
        historicalCyclesCount: historicalCycles.length,
        cardBalance: card?.balanceCurrent,
        recentCycles: recentCycles.map(c => ({
          id: c.id,
          end: new Date(c.endDate).toDateString(),
          statementBalance: c.statementBalance,
          isCurrentCycle: c === currentCycle,
          isMostRecentClosed: c === mostRecentClosedCycle
        })),
        historicalCycles: historicalCycles.slice(0, 3).map(c => ({ // Only log first 3 for brevity
          id: c.id,
          end: new Date(c.endDate).toDateString(),
          statementBalance: c.statementBalance
        }))
      });
    }
    
    // Debug final classification for Amex
    if (cardName.includes('Platinum')) {
      console.log('🎯 AMEX FINAL CLASSIFICATION:', {
        currentCycleId: currentCycle?.id,
        mostRecentClosedId: mostRecentClosedCycle?.id,
        recentCyclesCount: recentCycles.length,
        historicalCyclesCount: historicalCycles.length,
        recentCycles: recentCycles.map(c => ({
          start: new Date(c.startDate).toDateString(),
          end: new Date(c.endDate).toDateString(),
          hasStatement: !!(c.statementBalance && c.statementBalance > 0)
        })),
        historicalCycles: historicalCycles.map(c => ({
          start: new Date(c.startDate).toDateString(),
          end: new Date(c.endDate).toDateString(),
          hasStatement: !!(c.statementBalance && c.statementBalance > 0)
        }))
      });
    }
    
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
            <CreditCard className="h-5 w-5 text-gray-600 mr-2" />
            <div>
              {(() => {
                const displayName = normalizeCardDisplayName(card?.name ?? cardName, card?.mask);
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900" title={displayName}>
                        {displayName}
                      </h3>
                    </div>
                    {card && <p className="text-sm text-gray-600">•••• {card.mask}</p>}
                  </>
                );
              })()}
            </div>
          </div>
          {(historical.length > 0 || olderLoading) && (
            olderLoading ? (
              // Simple non-animated loading label (no spinner)
              <div className="flex items-center justify-center py-2 mb-3 max-w-full">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100/80 backdrop-blur-sm max-w-full">
                  <span className="text-xs font-medium text-gray-600 whitespace-nowrap">Loading...</span>
                </div>
              </div>
            ) : (
              // Normal expandable button - responsive width
              <button
                onClick={() => {
                  if (!olderLoading) onToggleExpand();
                }}
                className="group relative inline-flex items-center text-sm px-3 py-2 rounded-lg border transition-all duration-300 mb-3 ml-2 mr-2 shadow-sm backdrop-blur-sm text-gray-500 hover:text-gray-700 bg-gradient-to-r from-gray-50/80 to-white/90 hover:from-gray-100/90 hover:to-gray-50/80 border-gray-200 hover:border-gray-300 hover:shadow-md max-w-full"
              >
                <div className={`flex items-center justify-center w-4 h-4 rounded-full mr-1.5 transition-all duration-300 bg-gradient-to-br from-gray-200 to-gray-300 group-hover:from-gray-300 group-hover:to-gray-400 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                  <ChevronRight className="h-2.5 w-2.5 text-gray-600 group-hover:text-gray-700" />
                </div>
                <span className="font-medium text-xs text-center leading-tight">
                  <div>{historical.length} older</div>
                  <div>cycles</div>
                </span>
              </button>
            )
          )}
              </div>

              {/* Manual cycle date configuration - positioned below header to not interfere with button */}
              {card && (() => {
                // Show manual configuration when:
                // - User has already configured manual dates, or
                // - No reliable historical statement data exists (no closed cycles with statementBalance)
                const hasPlaidDates = card.lastStatementIssueDate || card.nextPaymentDueDate;
                const hasManualDates = card.manual_dates_configured;
                const today = new Date();
                const closedWithStatements = (cardCycles || [])
                  .filter(c => (c.statementBalance && new Date(c.endDate) < today))
                  .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                // Consider "rich" historical statements only if there are statements beyond the most recent closed
                const hasRichHistoricalStatements = closedWithStatements.length > 1;
                const needsManualConfig = hasManualDates || (!hasRichHistoricalStatements);

                return needsManualConfig ? (
                  <div className="mb-4 -mt-2">
                    <CycleDateEditor
                      cardId={card.id}
                      cardName={normalizeCardDisplayName(card?.name ?? cardName, card?.mask)}
                      currentCycleDay={card.manual_cycle_day}
                      currentDueDay={card.manual_due_day}
                      currentCycleDateType={card.cycle_date_type}
                      currentCycleDaysBeforeEnd={card.cycle_days_before_end}
                      currentDueDateType={card.due_date_type}
                      currentDueDaysBeforeEnd={card.due_days_before_end}
                      isRobinhood={card.plaidItem?.institutionId === 'ins_54'}
                      onSave={async (data) => {
                        try {
                          const response = await fetch(`/api/credit-cards/${card.id}/cycle-dates`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(data),
                          });
                          
                          if (!response.ok) {
                            throw new Error('Failed to update cycle dates');
                          }
                          
                          // Notify app to refresh ONLY this card's cycles and data
                          try {
                            window.dispatchEvent(new CustomEvent('cardCycleDatesUpdated', { detail: { cardId: card.id } }));
                          } catch {}
                        } catch (error) {
                          console.error('Error updating cycle dates:', error);
                          throw error;
                        }
                      }}
                    />
                  </div>
                ) : null;
              })()}

              <div className="space-y-3">
                {/* Show message when no cycles are available (e.g., Robinhood without manual config) */}
                {allRecentCycles.length === 0 && historical.length === 0 && (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 bg-gradient-to-br from-gray-300 to-gray-400 rounded-full mx-auto mb-3 opacity-60 flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-gray-600 text-sm font-medium mb-2">No billing cycles available</p>
                    <p className="text-gray-500 text-xs">Configure billing dates above to generate cycles</p>
                  </div>
                )}
                
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

                {/* Historical cycles (collapsible with smooth animation) */}
                {historical.length > 0 && (
                  <div 
                    className={`overflow-hidden transition-all duration-300 ease-out ${
                      isExpanded 
                        ? 'max-h-[1500px] opacity-100 transform translate-y-0' 
                        : 'max-h-0 opacity-0 transform -translate-y-2'
                    }`}
                  >
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
                  </div>
                )}
              </div>
            </div>
          </div>
  );
}
