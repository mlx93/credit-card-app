'use client';

import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
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

interface HorizontalCardColumnsProps {
  cards: CreditCardInfo[];
  cycles: BillingCycle[];
  onSync?: (itemId: string) => void;
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  initialCardOrder?: string[];
  onOrderChange?: (cardOrder: string[]) => void;
}

interface SortableCardColumnProps {
  card: CreditCardInfo;
  cycles: BillingCycle[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSync?: (itemId: string) => void;
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  colorIndex: number;
  billingCycleGradient: string;
}

function SortableCardColumn({ 
  card, 
  cycles, 
  isExpanded, 
  onToggleExpand, 
  onSync, 
  onReconnect, 
  onRemove, 
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
              onSync={onSync}
              onReconnect={onReconnect}
              onRemove={onRemove}
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
  onSync, 
  onReconnect, 
  onRemove, 
  initialCardOrder, 
  onOrderChange 
}: HorizontalCardColumnsProps) {
  const [cardOrder, setCardOrder] = useState<string[]>(initialCardOrder || []);
  // Initialize with all cards expanded by default
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => {
    // On initial render, expand all cards
    return new Set(cards.map(card => card.id));
  });
  
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
    console.log('🏁 HorizontalCardColumns useEffect triggered:', {
      cardsLength: cards.length,
      cardNames: cards.map(c => c.name),
      cyclesLength: cycles.length,
      currentCardOrderLength: cardOrder.length
    });
    
    const cardIds = cards.map(card => card.id);
    
    if (cardOrder.length === 0 && cardIds.length > 0) {
      console.log('📝 Initializing card order...');
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
      
      // Cards are already expanded by default in the initial state
      // No need to set them again here
    } else {
      console.log('⏭️ Skipping card order initialization:', {
        cardOrderLength: cardOrder.length,
        cardIdsLength: cardIds.length
      });
    }
  }, [cards, initialCardOrder, cardOrder.length, onOrderChange, cycles]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = cardOrder.indexOf(active.id as string);
      const newIndex = cardOrder.indexOf(over.id as string);
      
      const newOrder = arrayMove(cardOrder, oldIndex, newIndex);
      setCardOrder(newOrder);
      onOrderChange?.(newOrder);
    }
  };

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

  const orderedCards = cardOrder
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
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-premium min-h-[300px]">
              {orderedCards.map((card, index) => {
                const colorIndex = getCardColorIndex(card.name, card.id);
                return (
                  <SortableCardColumn
                    key={card.id}
                    card={card}
                    cycles={getCardCycles(card.id)}
                    isExpanded={expandedCards.has(card.id)}
                    onToggleExpand={() => toggleCardExpansion(card.id)}
                    onSync={onSync}
                    onReconnect={onReconnect}
                    onRemove={onRemove}
                    colorIndex={colorIndex}
                    billingCycleGradient={getBillingCycleGradient(colorIndex)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}