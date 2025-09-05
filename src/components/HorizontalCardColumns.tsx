'use client';

import React, { useState, useEffect, useRef } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical, ChevronRight } from 'lucide-react';
import { DueDateCard } from './DueDateCard';
import { CardBillingCycles } from './CardBillingCycles';

interface CreditCardInfo {
  id: string;
  name: string;
  mask: string;
  balanceCurrent: number;
  balanceLimit?: number;
  nextPaymentDueDate?: string;
  minimumPaymentAmount?: number;
  plaidItem?: {
    id: string;
    itemId: string;
    institutionName: string;
    status: string;
    lastSyncAt?: Date;
    errorMessage?: string;
  };
}

interface BillingCycle {
  id: string;
  creditCardId: string;
  startDate: string;
  endDate: string;
  dueDate?: string;
  totalSpend: number;
  paymentStatus?: string;
  statementBalance?: number;
}

interface ConnectionHealthData {
  summary: {
    totalConnections: number;
    healthyConnections: number;
    requiresAuth: number;
    errorConnections: number;
    overallHealth: string;
  };
  connections: {
    plaidItemId: string;
    itemId: string;
    institutionName: string;
    status: 'healthy' | 'requires_auth' | 'error' | 'unknown';
    lastSuccessfulSync: string | null;
    errorDetails: any;
    apiConnectivity: {
      accounts: boolean;
      balances: boolean;
      transactions: boolean;
      liabilities: boolean;
    };
    recommendedAction: string;
  }[];
}

interface HorizontalCardColumnsProps {
  cards: CreditCardInfo[];
  cycles: BillingCycle[];
  connectionHealth?: ConnectionHealthData | null;
  onSync?: (itemId: string) => void;
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  onRequestDelete?: (card: any) => void;
  initialCardOrder?: string[];
  onOrderChange?: (cardOrder: string[]) => void;
  visualRefreshingIds?: string[];
  onCreditLimitUpdated?: (data: {
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  }) => void;
}

interface SortableCardColumnProps {
  card: CreditCardInfo;
  cycles: BillingCycle[];
  connectionHealth?: ConnectionHealthData | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSync?: (itemId: string) => void;
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  onRequestDelete?: (card: any) => void;
  onCreditLimitUpdated?: (data: {
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  }) => void;
  colorIndex: number;
  billingCycleGradient: string;
}

function SortableCardColumn({ 
  card, 
  cycles, 
  connectionHealth,
  isExpanded, 
  onToggleExpand, 
  onSync, 
  onReconnect, 
  onRemove, 
  onRequestDelete,
  onCreditLimitUpdated,
  colorIndex,
  billingCycleGradient
}: SortableCardColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex-shrink-0 w-80 ${isDragging ? 'z-50' : ''}`}
    >
      {/* iOS-Inspired Card Column */}
      <div className="relative">
        {/* Premium Due Date Card */}
        <div className="relative group">
          {/* Glass morphism background with iOS-style layers */}
          <div className="absolute inset-0 glass-morphism rounded-2xl ios-shadow group-hover:ios-shadow-hover spring-smooth"></div>
          
          {/* Subtle gradient overlay for depth */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-black/5 rounded-2xl"></div>
          
          {/* Inner light reflection */}
          <div className="absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-white/20 to-transparent rounded-t-2xl"></div>
          
          {/* Card content */}
          <div className="relative p-4 rounded-2xl spring-bounce group-hover:scale-[1.02]">
            {/* Drag handle */}
            <div 
              {...attributes}
              {...listeners}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 text-gray-400" />
            </div>

            <DueDateCard
              card={card}
              colorIndex={colorIndex}
              connectionHealth={connectionHealth}
              onSync={onSync}
              onReconnect={onReconnect}
              onRemove={onRemove}
              onRequestDelete={onRequestDelete}
              onCreditLimitUpdated={onCreditLimitUpdated}
            />

            {/* Expand/Collapse Button - iOS Style */}
            <button
              onClick={onToggleExpand}
              className="w-full mt-3 flex items-center justify-center py-2 px-3 bg-gradient-to-r from-white/60 to-white/40 backdrop-blur-lg rounded-lg border border-white/40 hover:from-white/80 hover:to-white/60 shadow-lg hover:shadow-xl spring-smooth group/btn active:scale-95"
            >
              <span className="text-sm font-semibold bg-gradient-to-r from-gray-700 to-gray-900 bg-clip-text text-transparent mr-2">
                {isExpanded ? 'Hide' : 'Show'} Billing Cycles
              </span>
              <div className="p-1 rounded-full bg-white/30 group-hover/btn:bg-white/50 spring-smooth">
                {isExpanded ? (
                  <ChevronUp className="h-3 w-3 text-gray-700 group-hover/btn:text-gray-900 spring-smooth" />
                ) : (
                  <ChevronDown className="h-3 w-3 text-gray-700 group-hover/btn:text-gray-900 spring-smooth" />
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Expandable Billing Cycles - iOS Style */}
        <div 
          className={`mt-4 overflow-hidden spring-smooth ${
            isExpanded ? 'max-h-[2000px] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-4'
          }`}
        >
          {cycles.length > 0 ? (
            <div className="glass-morphism rounded-xl ios-shadow">
              <div className="p-4">
                {/* Section Header */}
                <div className="flex items-center mb-4">
                  <div className={`w-1 h-4 bg-gradient-to-b ${billingCycleGradient} rounded-full mr-3`}></div>
                  <h3 className="text-sm font-semibold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                    Recent Billing Cycles
                  </h3>
                </div>
                
                <CardBillingCycles 
                  cycles={cycles}
                  cards={[card]}
                  cardOrder={[card.id]}
                  compactMode={true}
                />
              </div>
            </div>
          ) : (
            <div className="glass-morphism-dark rounded-xl p-6 text-center">
              <div className="w-8 h-8 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full mx-auto mb-2 opacity-40"></div>
              <p className="text-gray-600 text-sm font-medium">No billing cycles available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HorizontalCardColumns({ 
  cards, 
  cycles, 
  connectionHealth,
  onSync, 
  onReconnect, 
  onRemove, 
  onRequestDelete,
  initialCardOrder, 
  onOrderChange,
  visualRefreshingIds,
  onCreditLimitUpdated 
}: HorizontalCardColumnsProps) {
  const [cardOrder, setCardOrder] = useState<string[]>(initialCardOrder || []);
  const [userReordered, setUserReordered] = useState(false);
  // Initialize with all cards expanded by default
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => {
    // On initial render, expand all cards
    return new Set(cards.map(card => card.id));
  });
  
  // Scroll indicator state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  
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

  // Initialize card order and expand cards with current/recent cycles by default
  useEffect(() => {
    // Initialize or update ordering based on incoming props and newly added/removed cards
    const cardIds = cards.map(card => card.id);

    if (cardOrder.length === 0 && cardIds.length > 0) {
      // First-time initialize: use parent's preferred order, then append any missing
      if (initialCardOrder && initialCardOrder.length > 0) {
        const validOrder = initialCardOrder.filter(id => cardIds.includes(id));
        const newCards = cardIds.filter(id => !validOrder.includes(id));
        const fullOrder = [...validOrder, ...newCards];
        setCardOrder(fullOrder);
        onOrderChange?.(fullOrder);
      } else {
        setCardOrder(cardIds);
        onOrderChange?.(cardIds);
      }
      return;
    }

    // Merge newly added cards (prepend) and drop removed cards, but do NOT reorder existing
    if (cardOrder.length > 0) {
      const missing = cardIds.filter(id => !cardOrder.includes(id));
      const kept = cardOrder.filter(id => cardIds.includes(id));

      if (missing.length > 0 || kept.length !== cardOrder.length) {
        // Respect parent's order for the new cards only; keep existing order as-is
        const missingOrdered = initialCardOrder
          ? missing.sort((a, b) => initialCardOrder.indexOf(a) - initialCardOrder.indexOf(b))
          : missing;
        const updated = [...missingOrdered, ...kept];
        setCardOrder(updated);
        onOrderChange?.(updated);
      }
    }
  }, [cards, initialCardOrder]);

  // Auto-expand any newly added cards so that recent and current cycles are visible immediately
  useEffect(() => {
    const currentIds = new Set(cards.map(c => c.id));
    setExpandedCards(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of currentIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      
      const newOrder = arrayMove(cardOrder, oldIndex, newIndex);
      setCardOrder(newOrder);
      setUserReordered(true);
      onOrderChange?.(newOrder);
    }
  };

  // If parent provides a new authoritative order (e.g., loaded from DB at init),
  // and the user hasn't manually reordered yet in this session, adopt it.
  useEffect(() => {
    if (!initialCardOrder || initialCardOrder.length === 0) return;
    const sameLength = initialCardOrder.length === cardOrder.length;
    const sameOrder = sameLength && initialCardOrder.every((id, i) => id === cardOrder[i]);
    const sameSet = initialCardOrder.every(id => cardOrder.includes(id)) && cardOrder.every(id => initialCardOrder.includes(id));
    if (!userReordered && (!sameOrder || !sameLength) && sameSet) {
      setCardOrder(initialCardOrder);
      onOrderChange?.(initialCardOrder);
    }
  }, [JSON.stringify(initialCardOrder)]);

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  };

  // Check if there are more cards to scroll to
  const checkScrollIndicator = () => {
    if (!scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    const isScrollable = container.scrollWidth > container.clientWidth;
    const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 10; // 10px threshold
    
    setShowScrollIndicator(isScrollable && !isAtEnd && !hasInteracted);
  };

  // Handle scroll events
  const handleScroll = () => {
    setHasInteracted(true);
    checkScrollIndicator();
  };

  // Check scroll indicator when component mounts or cards change
  useEffect(() => {
    checkScrollIndicator();
    
    // Add resize observer to check when container size changes
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(checkScrollIndicator, 100); // Small delay to ensure layout is complete
    });
    
    if (scrollContainerRef.current) {
      resizeObserver.observe(scrollContainerRef.current);
    }
    
    return () => resizeObserver.disconnect();
  }, [cards, hasInteracted]);

  // Reset interaction state when cards change significantly
  useEffect(() => {
    if (cards.length > 1) {
      setHasInteracted(false);
    }
  }, [cards.length]);

  // Ensure any cards not yet in cardOrder still render (appended) to avoid missing new cards
  const fullDisplayOrder = [
    ...cardOrder,
    ...cards.map(c => c.id).filter(id => !cardOrder.includes(id)),
  ];
  const orderedCards = fullDisplayOrder
    .map(id => cards.find(card => card.id === id))
    .filter(Boolean) as CreditCardInfo[];

  const getCardCycles = (cardId: string) => {
    return cycles
      .filter(cycle => cycle.creditCardId === cardId)
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    // No artificial limit - let the API's sophisticated logic determine how many cycles to show
  };

  const getCardColorIndex = (cardName: string, cardId: string): number => {
    const combined = cardName + cardId;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 8;
  };

  const getBillingCycleGradient = (colorIndex: number): string => {
    // Lighter gradients that match the due date card colors
    const gradients = [
      'from-blue-200 to-blue-400',      // blue - matches due date card
      'from-green-200 to-green-400',    // green - matches due date card
      'from-purple-200 to-purple-400',  // purple - matches due date card
      'from-orange-200 to-orange-400',  // orange - matches due date card
      'from-pink-200 to-pink-400',      // pink - matches due date card
      'from-indigo-200 to-indigo-400',  // indigo - matches due date card
      'from-teal-200 to-teal-400',      // teal - matches due date card
      'from-red-200 to-red-400'         // red - matches due date card
    ];
    return gradients[colorIndex % gradients.length];
  };

  if (cards.length === 0) {
    return (
      <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-12 text-center">
        <p className="text-gray-600">No credit cards connected yet.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Premium gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-pink-50/50 rounded-3xl"></div>
      
      <div className="relative p-3">
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext 
            items={cardOrder}
            strategy={horizontalListSortingStrategy}
          >
            <div className="relative">
              <div 
                ref={scrollContainerRef}
                className="flex gap-4 overflow-x-auto pb-4 scrollbar-premium min-h-[300px]"
                onScroll={handleScroll}
              >
                {orderedCards.map((card, index) => {
                  const colorIndex = getCardColorIndex(card.name, card.id);
                  return (
                    <SortableCardColumn
                      key={card.id}
                      card={card}
                      cycles={getCardCycles(card.id)}
                      connectionHealth={connectionHealth}
                      isExpanded={expandedCards.has(card.id)}
                      onToggleExpand={() => toggleCardExpansion(card.id)}
                      onSync={onSync}
                      onReconnect={onReconnect}
                      onRemove={onRemove}
                      onRequestDelete={onRequestDelete}
                      onCreditLimitUpdated={onCreditLimitUpdated}
                      // Visual spinner for background historical load
                      forceRefreshing={visualRefreshingIds?.includes(card.id)}
                      colorIndex={colorIndex}
                      billingCycleGradient={getBillingCycleGradient(colorIndex)}
                    />
                  );
                })}
              </div>

              {/* Elegant Scroll Indicator - iOS-inspired */}
              {showScrollIndicator && (
                <div className="absolute top-0 right-0 bottom-4 w-16 pointer-events-none z-10">
                  {/* Fade-out gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-l from-white via-white/80 to-transparent"></div>
                  
                  {/* Subtle animated chevron hint */}
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center space-y-1">
                    <div className="animate-pulse">
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                    <div className="w-1 h-1 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.5s' }}></div>
                    <div className="w-1 h-1 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '1s' }}></div>
                  </div>
                  
                  {/* Subtle text hint that fades in after a delay */}
                  <div className="absolute bottom-8 right-3 opacity-0 animate-fade-in-delayed">
                    <div className="bg-black/80 text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap backdrop-blur-sm">
                      Scroll for more →
                    </div>
                  </div>
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
