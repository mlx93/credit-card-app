import { formatCurrency, formatDate, getDaysUntil, formatPercentage } from '@/utils/format';
import { AlertTriangle, CreditCard, WifiOff, RefreshCw, Trash2, ExternalLink, GripVertical, Edit3, Check, X } from 'lucide-react';
import { useState, useEffect } from 'react';
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

interface CreditCardInfo {
  id: string;
  name: string;
  mask: string;
  balanceCurrent: number;
  balanceLimit: number;
  lastStatementBalance?: number;
  nextPaymentDueDate?: Date;
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

interface DueDateCardProps {
  card: CreditCardInfo;
  colorIndex?: number;
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  onSync?: (itemId: string) => void;
}

// Darker shades for Due Date cards to distinguish from Billing Cycles
const cardColors = [
  'bg-blue-100 border-blue-300 border-l-blue-600',
  'bg-green-100 border-green-300 border-l-green-600',
  'bg-purple-100 border-purple-300 border-l-purple-600',
  'bg-orange-100 border-orange-300 border-l-orange-600',
  'bg-pink-100 border-pink-300 border-l-pink-600',
  'bg-indigo-100 border-indigo-300 border-l-indigo-600',
  'bg-teal-100 border-teal-300 border-l-teal-600',
  'bg-red-100 border-red-300 border-l-red-600'
];

// Sortable Due Date Card Component
function SortableDueDateCard({
  card,
  colorIndex = 0,
  onReconnect,
  onRemove,
  onSync
}: DueDateCardProps) {
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
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <DueDateCard 
        card={card}
        colorIndex={colorIndex}
        onReconnect={onReconnect}
        onRemove={onRemove}
        onSync={onSync}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// Main Due Date Cards Container with Drag and Drop
interface DueDateCardsProps {
  cards: CreditCardInfo[];
  onReconnect?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  onSync?: (itemId: string) => void;
  onOrderChange?: (cardOrder: string[]) => void;
  initialCardOrder?: string[];
}

export function DueDateCards({ cards, onReconnect, onRemove, onSync, onOrderChange, initialCardOrder }: DueDateCardsProps) {
  const [cardOrder, setCardOrder] = useState<string[]>(initialCardOrder || []);

  // Initialize card order only once when component mounts or when cards first become available
  useEffect(() => {
    const cardIds = cards.map(card => card.id);
    
    // Only initialize if we don't have an order set yet and we have cards
    if (cardOrder.length === 0 && cardIds.length > 0) {
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
    }
    // Handle new cards being added (but don't re-sync existing order)
    else if (cardOrder.length > 0) {
      const newCards = cardIds.filter(id => !cardOrder.includes(id));
      const removedCards = cardOrder.filter(id => !cardIds.includes(id));
      
      // Only update if there are actual changes
      if (newCards.length > 0 || removedCards.length > 0) {
        const validOrder = cardOrder.filter(id => cardIds.includes(id));
        const fullOrder = [...validOrder, ...newCards];
        setCardOrder(fullOrder);
        onOrderChange?.(fullOrder);
      }
    }
  }, [cards]); // Removed initialCardOrder dependency to prevent re-syncing

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

    console.log('🔄 Drag ended:', { activeId: active.id, overId: over?.id });

    if (over && active.id !== over.id) {
      setCardOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        
        console.log('📋 New card order:', newOrder);
        console.log('🔗 Calling onOrderChange with:', newOrder);
        onOrderChange?.(newOrder);
        return newOrder;
      });
    }
  };

  const getCardColorIndex = (cardName: string, cardId?: string) => {
    // Simple index-based assignment to guarantee different colors
    const cardNames = cards.map(c => c.name).sort(); // Sort for consistency
    const cardIndex = cardNames.indexOf(cardName);
    const colorIndex = cardIndex >= 0 ? cardIndex % cardColors.length : 0;
    console.log(`DueDate card color assignment: "${cardName}" (ID: ${cardId}) -> index ${colorIndex} (${cardColors[colorIndex]}) [position ${cardIndex}]`);
    return colorIndex;
  };

  // Filter and sort cards based on cardOrder
  const orderedCards = cardOrder
    .map(cardId => cards.find(card => card.id === cardId))
    .filter(Boolean) as CreditCardInfo[];

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
        <div className="space-y-4">
          {orderedCards.map((card) => {
            const colorIndex = getCardColorIndex(card.name, card.id);
            return (
              <SortableDueDateCard
                key={card.id}
                card={card}
                colorIndex={colorIndex}
                onReconnect={onReconnect}
                onRemove={onRemove}
                onSync={onSync}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export function DueDateCard({ 
  card, 
  colorIndex = 0, 
  onReconnect, 
  onRemove, 
  onSync,
  dragHandleProps 
}: DueDateCardProps & { dragHandleProps?: any }) {
  const [syncing, setSyncing] = useState(false);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const [updatingLimit, setUpdatingLimit] = useState(false);
  const daysUntilDue = card.nextPaymentDueDate ? getDaysUntil(card.nextPaymentDueDate) : null;
  const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
  const isDueSoon = daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue >= 0;
  
  // Handle cards with no limit or invalid limits - be more permissive with Capital One
  const hasValidLimit = card.balanceLimit && card.balanceLimit > 0 && isFinite(card.balanceLimit) && !isNaN(card.balanceLimit);
  const utilization = hasValidLimit ? Math.abs(card.balanceCurrent) / card.balanceLimit * 100 : 0;
  
  // Debug log for Capital One cards
  if (card.name?.toLowerCase().includes('capital one') || card.name?.toLowerCase().includes('quicksilver') || card.name?.toLowerCase().includes('venture')) {
    console.log('Capital One card limit debug:', {
      name: card.name,
      balanceLimit: card.balanceLimit,
      hasValidLimit,
      utilization
    });
  }

  // Check if card is paid off
  const currentBalance = Math.abs(card.balanceCurrent || 0);
  const minPayment = card.minimumPaymentAmount;
  const isPaidOff = (currentBalance === 0) || (minPayment === null || minPayment === undefined || minPayment === 0);

  const cardColorClass = cardColors[colorIndex % cardColors.length];
  
  // Connection status logic
  const connectionStatus = card.plaidItem?.status || 'unknown';
  const hasConnectionIssue = ['error', 'expired', 'disconnected'].includes(connectionStatus);
  const lastSyncDaysAgo = card.plaidItem?.lastSyncAt ? 
    Math.floor((new Date().getTime() - new Date(card.plaidItem.lastSyncAt).getTime()) / (1000 * 60 * 60 * 24)) : null;
  const isStale = lastSyncDaysAgo !== null && lastSyncDaysAgo > 14; // Consider stale if no sync in 14+ days (was 7 days)
  
  // Debug logging for staleness detection
  if (card.name.includes('Bank of America')) {
    console.log('Bank of America staleness check:', {
      cardName: card.name,
      lastSyncAt: card.plaidItem?.lastSyncAt,
      lastSyncDaysAgo,
      isStale,
      connectionStatus,
      hasConnectionIssue
    });
  }

  const handleSync = async () => {
    if (!card.plaidItem || !onSync) return;
    setSyncing(true);
    try {
      await onSync(card.plaidItem.itemId);
    } finally {
      setSyncing(false);
    }
  };

  const startEditingLimit = () => {
    setLimitInput(card.balanceLimit ? card.balanceLimit.toString() : '');
    setEditingLimit(true);
  };

  const cancelEditingLimit = () => {
    setEditingLimit(false);
    setLimitInput('');
  };

  const saveLimit = async () => {
    const limit = limitInput.trim() === '' ? null : parseFloat(limitInput.replace(/[,$]/g, ''));
    
    if (limit !== null && (isNaN(limit) || limit <= 0)) {
      alert('Please enter a valid positive number for the credit limit');
      return;
    }

    setUpdatingLimit(true);
    try {
      const response = await fetch('/api/user/credit-cards/update-limit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cardId: card.id, 
          creditLimit: limit 
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        // Force page refresh to update the card data
        window.location.reload();
      } else {
        console.error('Failed to update credit limit:', data.error);
        alert(data.error || 'Failed to update credit limit');
      }
    } catch (error) {
      console.error('Error updating credit limit:', error);
      alert('Network error while updating credit limit');
    } finally {
      setUpdatingLimit(false);
      setEditingLimit(false);
    }
  };
  
  return (
    <div className={`p-6 rounded-lg shadow-sm border-2 border-l-4 ${cardColorClass} ${hasConnectionIssue ? 'ring-2 ring-red-200' : ''}`}>
      <div className="mb-6">
        {/* Header Row with Due Date Box */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center flex-1 min-w-0 pr-4">
            {dragHandleProps && (
              <div {...dragHandleProps} className="cursor-move mr-2 flex-shrink-0">
                <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-600" />
              </div>
            )}
            <CreditCard className="h-5 w-5 text-gray-400 mr-2 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 
                  className="font-semibold text-gray-900 break-words leading-tight"
                  style={{ 
                    maxWidth: '280px',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    hyphens: 'auto'
                  }}
                  title={card.name}
                >
                  {card.name}
                </h3>
                {hasConnectionIssue && (
                  <WifiOff className="h-4 w-4 text-red-500 flex-shrink-0" title="Connection issue" />
                )}
                {isStale && !hasConnectionIssue && (
                  <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" title="Data may be outdated" />
                )}
              </div>
              <p className="text-sm text-gray-600">•••• {card.mask}</p>
              {card.plaidItem && (
                <p className="text-xs text-gray-500">
                  {hasConnectionIssue ? (
                    <span className="text-red-600">Connection: {connectionStatus}</span>
                  ) : lastSyncDaysAgo !== null ? (
                    <span>Last sync: {lastSyncDaysAgo === 0 ? 'Today' : `${lastSyncDaysAgo}d ago`}</span>
                  ) : (
                    <span>Never synced</span>
                  )}
                </p>
              )}
            </div>
          </div>
          
          {/* Due Date Box - Right Aligned */}
          <div className="flex-shrink-0">
            {isPaidOff ? (
              <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-medium">
                ✅ Paid Off
              </div>
            ) : card.nextPaymentDueDate ? (
              <div 
                className="relative px-3 py-2 rounded-xl border border-blue-200 bg-gradient-to-b from-blue-50 to-blue-100/50 shadow-sm text-center"
                style={{
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                  minWidth: '90px'
                }}
              >
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">DUE</p>
                  <p className="text-sm font-semibold text-gray-900">{formatDate(card.nextPaymentDueDate)}</p>
                  {daysUntilDue !== null && (
                    <p className={`text-xs font-medium ${
                      isOverdue 
                        ? 'text-red-600' 
                        : isDueSoon 
                          ? 'text-orange-600' 
                          : 'text-blue-600'
                    }`}>
                      {Math.abs(daysUntilDue)} days {isOverdue ? 'overdue' : 'left'}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        
        {/* Action Buttons Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!isPaidOff && (isOverdue || isDueSoon) && (
              <AlertTriangle className={`h-5 w-5 ${isOverdue ? 'text-red-500' : 'text-yellow-500'}`} />
            )}
          </div>
          
          {/* Connection management buttons - Right aligned */}
          {card.plaidItem && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              </button>
              
              {hasConnectionIssue && onReconnect && (
                <button
                  onClick={() => onReconnect(card.plaidItem!.itemId)}
                  className="p-1 rounded hover:bg-blue-100 text-blue-500 hover:text-blue-700"
                  title="Reconnect account"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              )}
              
              {onRemove && (
                <button
                  onClick={() => onRemove(card.plaidItem!.itemId)}
                  className="p-1 rounded hover:bg-red-100 text-red-500 hover:text-red-700"
                  title="Remove connection"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Balance Information - Show statement balance when there's a due date OR when balances differ */}
      {card.lastStatementBalance && (card.nextPaymentDueDate || card.lastStatementBalance !== card.balanceCurrent) ? (
        <div className="grid grid-cols-3 gap-3 mb-6">
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
          {!!(card.minimumPaymentAmount && card.minimumPaymentAmount > 0) && (
            <div>
              <p className="text-sm text-gray-600">Minimum Payment</p>
              <p className="font-semibold text-lg text-gray-900">
                {formatCurrency(card.minimumPaymentAmount)}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-600">Balance</p>
            <p className="font-semibold text-lg text-gray-900">
              {formatCurrency(Math.abs(card.balanceCurrent))}
            </p>
          </div>
          {!!(card.minimumPaymentAmount && card.minimumPaymentAmount > 0) && (
            <div>
              <p className="text-sm text-gray-600">Minimum Payment</p>
              <p className="font-semibold text-lg text-gray-900">
                {formatCurrency(card.minimumPaymentAmount)}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
          <span>Credit Utilization</span>
          <div className="flex items-center gap-2">
            {hasValidLimit && utilization > 0 ? (
              <span>{formatPercentage(utilization)}</span>
            ) : hasValidLimit && utilization === 0 ? (
              <span>0%</span>
            ) : (
              <>
                <span className="text-gray-500 italic">
                  {card.balanceLimit === null || card.balanceLimit === undefined ? 'Unknown Limit' : 
                   isNaN(card.balanceLimit) || !isFinite(card.balanceLimit) ? 'Invalid Limit' : 'No Limit'}
                </span>
                {!editingLimit && (
                  <button
                    onClick={startEditingLimit}
                    className="text-blue-500 hover:text-blue-700 p-1 rounded"
                    title="Set credit limit manually"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        
        {editingLimit && (
          <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                placeholder="Enter credit limit (e.g., 15000)"
                className="flex-1 px-3 py-1 border border-blue-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={updatingLimit}
              />
              <button
                onClick={saveLimit}
                disabled={updatingLimit}
                className="text-green-600 hover:text-green-800 p-1 disabled:opacity-50"
                title="Save credit limit"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={cancelEditingLimit}
                disabled={updatingLimit}
                className="text-red-600 hover:text-red-800 p-1 disabled:opacity-50"
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-blue-600">
              💡 Enter your credit limit manually for Capital One, Amex, or other cards where limits aren't automatically detected.
            </p>
          </div>
        )}

        {hasValidLimit && (
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
        )}
      </div>

    </div>
  );
}