'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCard, Calendar, DollarSign, TrendingUp, RefreshCw, Loader2, CheckCircle, Settings, User } from 'lucide-react';
import { formatCurrency, formatPercentage } from '@/utils/format';
import { normalizeCardDisplayName } from '@/utils/cardName';
import { CardBillingCycles } from '@/components/CardBillingCycles';
import { DueDateCard, DueDateCards } from '@/components/DueDateCard';
import { HorizontalCardColumns } from '@/components/HorizontalCardColumns';
import { PlaidLink } from '@/components/PlaidLink';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { PlaidUpdateLink } from '@/components/PlaidUpdateLink';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { DeletionProgressDialog } from '@/components/DeletionProgressDialog';
import { SuccessNotification } from '@/components/SuccessNotification';
import { AccountSettings } from '@/components/AccountSettings';

interface DashboardContentProps {
  isLoggedIn: boolean;
  userEmail?: string;
}

export function DashboardContent({ isLoggedIn, userEmail }: DashboardContentProps) {
  // Initialize state from localStorage if available
  const [creditCards, setCreditCards] = useState<any[]>(() => {
    if (typeof window !== 'undefined' && isLoggedIn) {
      const cached = localStorage.getItem('cached_credit_cards');
      return cached ? JSON.parse(cached) : [];
    }
    return [];
  });
  const [billingCycles, setBillingCycles] = useState<any[]>(() => {
    if (typeof window !== 'undefined' && isLoggedIn) {
      const cached = localStorage.getItem('cached_billing_cycles');
      return cached ? JSON.parse(cached) : [];
    }
    return [];
  });
  
  // Save to localStorage whenever state changes
  useEffect(() => {
    if (typeof window !== 'undefined' && isLoggedIn && creditCards.length > 0) {
      localStorage.setItem('cached_credit_cards', JSON.stringify(creditCards));
    }
  }, [creditCards, isLoggedIn]);
  
  useEffect(() => {
    if (typeof window !== 'undefined' && isLoggedIn && billingCycles.length > 0) {
      localStorage.setItem('cached_billing_cycles', JSON.stringify(billingCycles));
    }
  }, [billingCycles, isLoggedIn]);
  
  const [currentMonthTransactions, setCurrentMonthTransactions] = useState<any[]>(() => {
    if (typeof window !== 'undefined' && isLoggedIn) {
      try {
        const cached = localStorage.getItem('cached_transactions_current_month');
        return cached ? JSON.parse(cached) : [];
      } catch {}
    }
    return [];
  });
  
  // Cache current month transactions for instant UI on next load
  useEffect(() => {
    if (typeof window !== 'undefined' && isLoggedIn && currentMonthTransactions.length > 0) {
      try {
        localStorage.setItem('cached_transactions_current_month', JSON.stringify(currentMonthTransactions));
      } catch {}
    }
  }, [currentMonthTransactions, isLoggedIn]);
  const [connectionHealth, setConnectionHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [refreshStep, setRefreshStep] = useState('');
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [lastBackgroundSync, setLastBackgroundSync] = useState<Date | null>(null);
  const [recentCardAddition, setRecentCardAddition] = useState(false);
  const [cardDeletionInProgress, setCardDeletionInProgress] = useState(false);
  const [sharedCardOrder, setSharedCardOrder] = useState<string[]>([]);
  // Pinned new cards: always placed at the front until the user reorders
  const [pinnedNewCardIds, setPinnedNewCardIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('pinned_new_card_ids');
        if (raw) return new Set(JSON.parse(raw));
      } catch {}
    }
    return new Set<string>();
  });
  const [hasUserOrdered, setHasUserOrdered] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('card_order_user_set') === '1';
    }
    return false;
  });
  // Track which cards have been explicitly positioned by the user at least once
  const [positionedCardIds, setPositionedCardIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('positioned_card_ids');
        if (raw) return new Set(JSON.parse(raw));
      } catch {}
    }
    return new Set<string>();
  });
  // Prevent saving order before we've loaded an initial preferred order (DB or default)
  const orderInitializedRef = typeof window === 'undefined' ? { current: false } as any : (window as any).__orderInitRef || { current: false };
  if (typeof window !== 'undefined') { (window as any).__orderInitRef = orderInitializedRef; }
  const [visualRefreshingIds, setVisualRefreshingIds] = useState<string[]>([]);
  const [historyRefreshingIds, setHistoryRefreshingIds] = useState<string[]>([]);
  // When true, we are fetching full billing history (beyond recent=1) in background
  const [fullCyclesLoading, setFullCyclesLoading] = useState(false);
  // Timer/guard to defer and dedupe full-history fetch
  const fullCyclesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedFullCyclesRef = useRef<boolean>(false);

  // De-duplicate cycles by (creditCardId, startDate, endDate), preferring richer records
  function dedupeCycles(list: any[]): any[] {
    if (!Array.isArray(list) || list.length === 0) return [];
    const byKey = new Map<string, any>();
    for (const c of list) {
      const cardId = c.creditCardId;
      const start = new Date(c.startDate).toISOString().split('T')[0];
      const end = new Date(c.endDate).toISOString().split('T')[0];
      const key = `${cardId}_${start}_${end}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, c);
        continue;
      }
      const existingHasStatement = !!(existing.statementBalance || existing.minimumPayment || existing.dueDate);
      const currentHasStatement = !!(c.statementBalance || c.minimumPayment || c.dueDate);
      if (currentHasStatement && !existingHasStatement) {
        byKey.set(key, c);
        continue;
      }
      const existingCount = typeof existing.transactionCount === 'number' ? existing.transactionCount : -1;
      const currentCount = typeof c.transactionCount === 'number' ? c.transactionCount : -1;
      if (currentCount > existingCount) {
        byKey.set(key, c);
        continue;
      }
      const existingSpend = typeof existing.totalSpend === 'number' ? Math.abs(existing.totalSpend) : -1;
      const currentSpend = typeof c.totalSpend === 'number' ? Math.abs(c.totalSpend) : -1;
      if (currentSpend > existingSpend) {
        byKey.set(key, c);
        continue;
      }
      // else keep existing
    }
    return Array.from(byKey.values()).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }

  // Merge helper: combine recent cycles with any existing historical cycles in state
  function mergeRecentCycles(prev: any[], recent: any[]) {
    if (!Array.isArray(prev) || prev.length === 0) return recent;
    if (!Array.isArray(recent) || recent.length === 0) return prev;
    const recentById = new Set(recent.map((c: any) => c.id));
    const preserved = prev.filter((c: any) => !recentById.has(c.id));
    const merged = [...recent, ...preserved];
    return dedupeCycles(merged);
  }

  // Compute an effective order that always pins new cards to the front until the user reorders
  const getEffectiveOrder = (baseOrder: string[], currentCards: any[]): string[] => {
    const cardIds = currentCards.map(c => c.id);
    const dedupBase = Array.from(new Set(baseOrder.filter(id => cardIds.includes(id))));
    const pinned = Array.from(pinnedNewCardIds).filter(id => cardIds.includes(id));
    const rest = dedupBase.filter(id => !pinned.includes(id));
    const missing = cardIds.filter(id => !dedupBase.includes(id) && !pinned.includes(id));
    // Pinned first, then existing order without pinned, then any brand-new not in base order
    return Array.from(new Set([...pinned, ...rest, ...missing]));
  };

  function scheduleFullCyclesFetch(logLabel: string = '') {
    // Avoid duplicate fetches
    if (hasLoadedFullCyclesRef.current || fullCyclesTimerRef.current) return;
    
    // Set loading state immediately when scheduling (don't wait for timeout)
    const allCardIds = creditCards.map(c => c.id);
    setHistoryRefreshingIds(allCardIds);
    setFullCyclesLoading(true);
    console.log(`📅 Setting Older Cycles loading state for ${allCardIds.length} cards${logLabel}`);
    
    fullCyclesTimerRef.current = setTimeout(async () => {
      fullCyclesTimerRef.current = null;
      if (hasLoadedFullCyclesRef.current) return;
      try {
        const fullRes = await fetch('/api/user/billing-cycles', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        if (fullRes.ok) {
          const { billingCycles: fullCycles } = await fullRes.json();
          setBillingCycles(prev => {
            const prevLen = Array.isArray(prev) ? prev.length : 0;
            if (Array.isArray(fullCycles) && fullCycles.length >= prevLen) {
              return dedupeCycles(fullCycles);
            }
            return prev;
          });
          hasLoadedFullCyclesRef.current = true;
          console.log(`✅ Full billing history loaded${logLabel}`);
        }
      } catch (e) {
        console.warn('Background full cycles fetch failed:', e);
      } finally {
        setFullCyclesLoading(false);
        // Clear all loading states
        setHistoryRefreshingIds([]);
      }
    }, 2500); // defer a few seconds post-paint
  }

  // Cleanup any pending deferred fetch timers on unmount
  useEffect(() => {
    return () => {
      if (fullCyclesTimerRef.current) {
        clearTimeout(fullCyclesTimerRef.current);
        fullCyclesTimerRef.current = null;
      }
    };
  }, []);
  const [updateFlow, setUpdateFlow] = useState<{
    linkToken: string;
    institutionName: string;
    itemId: string;
  } | null>(null);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [successPopupData, setSuccessPopupData] = useState<{
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  } | null>(null);
  
  // Deletion flow state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState(0);
  const [deletionStep, setDeletionStep] = useState('');
  const [showDeletionSuccess, setShowDeletionSuccess] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  // Create consistent default card ordering based on due dates and card names
  const getDefaultCardOrder = (cards: any[]): string[] => {
    return cards
      .slice() // Create a copy to avoid mutating original array
      .sort((a, b) => {
        // Primary sort: by next payment due date (earliest first)
        const aDate = a.nextPaymentDueDate ? new Date(a.nextPaymentDueDate) : new Date('2099-12-31');
        const bDate = b.nextPaymentDueDate ? new Date(b.nextPaymentDueDate) : new Date('2099-12-31');
        
        if (aDate.getTime() !== bDate.getTime()) {
          return aDate.getTime() - bDate.getTime();
        }
        
        // Secondary sort: by card name (alphabetical)
        return a.name.localeCompare(b.name);
      })
      .map(card => card.id);
  };

  const mockCards = [
    {
      id: 'mock-card-1',
      name: 'Chase Sapphire Preferred',
      mask: '1234',
      balanceCurrent: -1248.50, // Higher than statement balance (872) + current spending
      balanceLimit: 15000,
      lastStatementBalance: -872.00, // Statement balance from closed cycle (closed Aug 15)
      nextPaymentDueDate: '2025-09-09', // Due 25 days after statement close (Aug 15 + 25 days)
      minimumPaymentAmount: 59.00,
    },
    {
      id: 'mock-card-2', 
      name: 'Capital One Venture',
      mask: '5678',
      balanceCurrent: -422.00, // Matches current statement balance for this example
      balanceLimit: 10000,
      lastStatementBalance: -302.50, // Statement balance from closed cycle (closed Aug 20)
      nextPaymentDueDate: '2025-09-14', // Due 25 days after statement close (Aug 20 + 25 days)
      minimumPaymentAmount: 21.00,
    },
    {
      id: 'mock-card-3',
      name: 'American Express Gold',
      mask: '9012',
      balanceCurrent: -729.00, // Outstanding statement (587.50) + new spending (141.50)
      balanceLimit: 8000,
      lastStatementBalance: -587.50, // OVERDUE statement balance from July-Aug cycle
      nextPaymentDueDate: '2025-08-24', // Overdue - was due 9 days ago (July 30 + 25 days)
      minimumPaymentAmount: 40.00,
    },
  ];

  const mockCycles = [
    // OPEN/CURRENT Cycle - American Express Gold (ongoing, no statement balance yet) - TOP PRIORITY
    {
      id: 'cycle-current-3',
      creditCardId: 'mock-card-3',
      creditCardName: 'American Express Gold',
      startDate: '2025-08-07',
      endDate: '2025-09-06', // Currently open cycle - pushed forward a week
      totalSpend: 141.50, // New spending since overdue payment - component should handle this
      transactionCount: 8,
      // No dueDate yet - cycle not closed
      // No statementBalance yet - cycle still open
      paymentStatus: 'current',
    },
    // OPEN/CURRENT Cycle - Chase Sapphire Preferred (ongoing, no statement balance yet)
    {
      id: 'cycle-current-1',
      creditCardId: 'mock-card-1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: '2025-08-16',
      endDate: '2025-09-15', // Currently open cycle
      totalSpend: 376.50, // Current spending in open cycle
      transactionCount: 12,
      // No dueDate yet - cycle not closed
      // No statementBalance yet - cycle still open
      paymentStatus: 'current',
    },
    // OPEN/CURRENT Cycle - Capital One Venture (ongoing, no statement balance yet)
    {
      id: 'cycle-current-2',
      creditCardId: 'mock-card-2',
      creditCardName: 'Capital One Venture',
      startDate: '2025-08-21',
      endDate: '2025-09-20', // Currently open cycle
      totalSpend: 119.50, // Current spending in open cycle
      transactionCount: 7,
      // No dueDate yet - cycle not closed
      // No statementBalance yet - cycle still open
      paymentStatus: 'current',
    },
    // CLOSED Cycle - Chase Sapphire Preferred (Active statement balance, due in future)
    {
      id: 'cycle-1',
      creditCardId: 'mock-card-1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: '2025-07-16',
      endDate: '2025-08-15', // Statement closed Aug 15
      totalSpend: 872.00,
      transactionCount: 23,
      dueDate: '2025-09-09', // Due 25 days after close (Aug 15 + 25 days)
      statementBalance: 872.00,
      paymentStatus: 'due', // Active statement balance, no checkmark
    },
    {
      id: 'cycle-2',
      creditCardId: 'mock-card-1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: '2025-06-16',
      endDate: '2025-07-15',
      totalSpend: 1005.50,
      transactionCount: 28,
      dueDate: '2025-07-05',
      statementBalance: 1005.50,
      paymentStatus: 'paid',
    },
    // CLOSED Cycle - Capital One Venture (Active statement balance, due in future)
    {
      id: 'cycle-3',
      creditCardId: 'mock-card-2',
      creditCardName: 'Capital One Venture',
      startDate: '2025-07-21',
      endDate: '2025-08-20', // Statement closed Aug 20
      totalSpend: 302.50,
      transactionCount: 15,
      dueDate: '2025-09-14', // Due 25 days after close (Aug 20 + 25 days)
      statementBalance: 302.50,
      paymentStatus: 'due', // Active statement balance, no checkmark
    },
    // OVERDUE Cycle - American Express Gold (Outstanding from August 2025 - 9 days late)
    {
      id: 'cycle-5',
      creditCardId: 'mock-card-3',
      creditCardName: 'American Express Gold',
      startDate: '2025-06-30',
      endDate: '2025-07-30', // Statement closed July 30
      totalSpend: 587.50,
      transactionCount: 19,
      dueDate: '2025-08-24', // Due 25 days after close (July 30 + 25 days) - 9 days overdue
      statementBalance: 587.50,
      paymentStatus: 'outstanding', // Red dot
    },
    {
      id: 'cycle-6',
      creditCardId: 'mock-card-3',
      creditCardName: 'American Express Gold',
      startDate: '2025-06-10',
      endDate: '2025-07-09',
      totalSpend: 465.00,
      transactionCount: 14,
      dueDate: '2025-07-10',
      statementBalance: 465.00,
      paymentStatus: 'paid', // Checkmark
    },
    // Historical Cycles - Chase Sapphire Preferred
    {
      id: 'cycle-7',
      creditCardId: 'mock-card-1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: '2025-05-16',
      endDate: '2025-06-15',
      totalSpend: 1529.00,
      transactionCount: 35,
      dueDate: '2025-06-05',
      statementBalance: 1529.00,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-8',
      creditCardId: 'mock-card-1',
      creditCardName: 'Chase Sapphire Preferred',
      startDate: '2025-04-16',
      endDate: '2025-05-15',
      totalSpend: 843.00,
      transactionCount: 21,
      dueDate: '2025-05-05',
      statementBalance: 843.00,
      paymentStatus: 'paid',
    },
    // Historical Cycles - Capital One Venture
    {
      id: 'cycle-9',
      creditCardId: 'mock-card-2',
      creditCardName: 'Capital One Venture',
      startDate: '2025-06-20',
      endDate: '2025-07-19',
      totalSpend: 686.50,
      transactionCount: 24,
      dueDate: '2025-07-10',
      statementBalance: 686.50,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-10',
      creditCardId: 'mock-card-2',
      creditCardName: 'Capital One Venture',
      startDate: '2025-05-20',
      endDate: '2025-06-19',
      totalSpend: 341.00,
      transactionCount: 12,
      dueDate: '2025-06-10',
      statementBalance: 341.00,
      paymentStatus: 'paid',
    },
    // Historical Cycles - American Express Gold
    {
      id: 'cycle-11',
      creditCardId: 'mock-card-3',
      creditCardName: 'American Express Gold',
      startDate: '2025-05-10',
      endDate: '2025-06-09',
      totalSpend: 530.00,
      transactionCount: 19,
      dueDate: '2025-06-10',
      statementBalance: 530.00,
      paymentStatus: 'paid',
    },
    {
      id: 'cycle-12',
      creditCardId: 'mock-card-3',
      creditCardName: 'American Express Gold',
      startDate: '2025-04-10',
      endDate: '2025-05-09',
      totalSpend: 393.00,
      transactionCount: 16,
      dueDate: '2025-05-10',
      statementBalance: 393.00,
      paymentStatus: 'paid',
    },
  ];

  // Shared Plaid API sync function
  const syncWithPlaidAPI = async (logPrefix: string = '', forceSync: boolean = false) => {
    console.log(`🔄${logPrefix}: Starting Plaid API sync...`);
    const syncResponse = await fetch('/api/sync', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forceSync })
    });
    
    if (syncResponse.ok) {
      const syncResult = await syncResponse.json();
      console.log(`✅${logPrefix}: Plaid sync completed successfully`);
      return syncResult;
    } else {
      console.warn(`⚠️${logPrefix}: Plaid sync failed`);
      throw new Error(`Plaid sync failed: ${syncResponse.status}`);
    }
  };

  // NOTE: Removed automatic background sync for new cards
  // New cards will get their full data during the next daily sync (once per day)
  // This prevents excessive API calls and follows the "once per day" sync strategy

  // Perform daily sync check on first login of the day
  const performDailySyncCheck = async () => {
    // Skip daily sync check if card was recently added or if deletion is in progress
    if (recentCardAddition) {
      console.log('⏭️ Skipping daily sync check - recent card addition in progress');
      return;
    }
    
    if (cardDeletionInProgress) {
      console.log('⏭️ Skipping daily sync check - card deletion in progress');
      return;
    }
    
    try {
      console.log('🌅 Checking if daily sync needed for active user...');
      console.log('🌅 User activity validation: Currently logged in and has been on Dashboard for 2+ seconds');
      
      // Check if daily sync is needed (12-hour window, active users only)
      const syncCheckResponse = await fetch('/api/user/daily-sync-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (syncCheckResponse.ok) {
        const syncCheck = await syncCheckResponse.json();
        console.log('🌅 Daily sync check result:', syncCheck);
        
        if (syncCheck.needsSync) {
          console.log(`🌅 Sync needed for ${syncCheck.itemsNeedingSyncCount} items (not updated in 12+ hours)`);
          console.log('🌅 Starting background sync for active user...');
          
          // Perform sync in background (don't await - let it run async) 
          performBackgroundDailySync();
        } else {
          console.log('🌅 No sync needed - all items synced within past 12 hours');
        }
      } else {
        console.warn('⚠️ Daily sync check failed, skipping automatic sync');
      }
      
    } catch (error) {
      console.error('❌ Daily sync check error:', error);
    }
  };

  // Perform daily sync in background without blocking UI
  const performBackgroundDailySync = async () => {
    // Skip daily sync if card was recently added or if deletion is in progress
    if (recentCardAddition) {
      console.log('⏭️ Skipping background daily sync - recent card addition in progress');
      return;
    }
    
    if (cardDeletionInProgress) {
      console.log('⏭️ Skipping background daily sync - card deletion in progress');
      return;
    }
    
    try {
      console.log('🌅 Starting background daily sync...');
      
      const dailySyncResponse = await fetch('/api/user/daily-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (dailySyncResponse.ok) {
        const result = await dailySyncResponse.json();
        console.log('🌅 Background daily sync completed:', result);
        
        // Refresh data after sync completes
        if (result.itemsSynced > 0) {
          console.log('🌅 Refreshing data after daily sync...');
          await fetchDatabaseDataOnly('Post daily sync: ');
        }
      } else {
        console.warn('⚠️ Background daily sync failed');
      }
      
    } catch (error) {
      console.error('❌ Background daily sync error:', error);
    }
  };

  // Lightweight data fetch for new card additions (skips connection health to avoid rate limits)
  const fetchUserDataForNewCard = async (logPrefix: string = '') => {
    if (!isLoggedIn) return;
    console.log(`🚀 fetchUserDataForNewCard STARTED${logPrefix}`);
    
    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    // Skip connection health check during new card addition to avoid rate limits
    const [creditCardsRes, billingCyclesRes, transactionsRes] = await Promise.all([
      fetch('/api/user/credit-cards?light=1', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
      fetch('/api/user/billing-cycles?recent=1', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }),
      fetch(`/api/user/transactions?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}&limit=1000`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
    ]);

    if (creditCardsRes.ok) {
      const { creditCards: cards } = await creditCardsRes.json();
      const safeCards = Array.isArray(cards) ? cards : [];
      console.log(`🔄${logPrefix}Fetched ${safeCards.length} cards from API:`, safeCards.map(c => ({ id: c.id, name: c.name })));
      console.log(`🔄${logPrefix}About to setCreditCards - BEFORE state update, current cards:`, creditCards.length);
      setCreditCards(safeCards);
      console.log(`🔄${logPrefix}setCreditCards completed - AFTER setState called (may not be immediately visible)`);
      
      // Update shared card order to include new cards (pin truly-new to front)
      if (safeCards.length > 0) {
        const currentCardIds = new Set(sharedCardOrder);
        const newCards = safeCards.filter(card => !currentCardIds.has(card.id));
        console.log(`🔍${logPrefix}New card detection:`, {
          totalCards: safeCards.length,
          currentOrderIds: Array.from(currentCardIds),
          newCardsFound: newCards.length,
          newCardNames: newCards.map(c => c.name)
        });
        
        if (newCards.length > 0) {
          const newCardIds = newCards.map(card => card.id);
          // Pin these new cards until the user reorders
          setPinnedNewCardIds(prev => {
            const next = new Set(prev);
            newCardIds.forEach(id => next.add(id));
            try { localStorage.setItem('pinned_new_card_ids', JSON.stringify(Array.from(next))); } catch {}
            return next;
          });
          const updatedOrder = getEffectiveOrder(sharedCardOrder, safeCards);
          setSharedCardOrder(updatedOrder);
          console.log(`🆕 Adding ${newCards.length} new cards to front of order${logPrefix}:`, {
            newCardNames: newCards.map(c => c.name),
            updatedOrder: updatedOrder.map(id => safeCards.find(c => c.id === id)?.name)
          });
          
          // New cards will sync during next daily sync (once per day only)
          console.log('📝 New cards detected, will sync during next daily sync');
        } else if (sharedCardOrder.length === 0) {
          const defaultOrder = getDefaultCardOrder(safeCards);
          const effective = getEffectiveOrder(defaultOrder, safeCards);
          setSharedCardOrder(effective);
          console.log(`Setting default card order${logPrefix}:`, {
            cardCount: safeCards.length,
            defaultOrder,
            cardNames: defaultOrder.map(id => safeCards.find(c => c.id === id)?.name)
          });
        }
      }
    }

    if (billingCyclesRes.ok) {
      // Replace billing cycles with fresh data (don't merge to avoid duplicates)
      // while full historical billing cycles load in the background.
      const { billingCycles: cycles } = await billingCyclesRes.json();
      const safeCycles = Array.isArray(cycles) ? cycles : [];
      if (safeCycles.length > 0) {
        setBillingCycles(dedupeCycles(safeCycles));
        scheduleFullCyclesFetch(' (after fetchUserDataForNewCard)');
      }
    }

    if (transactionsRes.ok) {
      const { transactions } = await transactionsRes.json();
      const safeTransactions = Array.isArray(transactions) ? transactions : [];
      setCurrentMonthTransactions(safeTransactions);
    }
    
    console.log(`✅ ${logPrefix}Lightweight data loaded successfully (skipped connection health to avoid rate limits)`);
  };

  // Shared data fetching logic used by all sync functions
  const fetchAllUserData = async (logPrefix: string = '') => {
    if (!isLoggedIn) return;
    console.log(`🔄 fetchAllUserData called${logPrefix}`);
    
    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const [creditCardsRes, billingCyclesRes, transactionsRes, connectionHealthRes] = await Promise.all([
      fetch('/api/user/credit-cards', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }),
      fetch('/api/user/billing-cycles?recent=1', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }),
      fetch(`/api/user/transactions?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}&limit=1000`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }),
      fetch('/api/user/connection-health', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      })
    ]);

    if (creditCardsRes.ok) {
      const { creditCards: cards } = await creditCardsRes.json();
      // Ensure cards is always an array to prevent filter errors
      const safeCards = Array.isArray(cards) ? cards : [];
      console.log(`📊${logPrefix} fetchAllUserData - Setting ${safeCards.length} cards:`, safeCards.map(c => ({id: c.id, name: c.name, itemId: c.plaidItem?.itemId})));
      setCreditCards(safeCards);
      
      // Update shared card order to include new cards (pin truly-new to front)
      if (safeCards.length > 0) {
        const currentCardIds = new Set(sharedCardOrder);
        const newCards = safeCards.filter(card => !currentCardIds.has(card.id));
        
        if (newCards.length > 0) {
          // Pin cards that haven't been explicitly positioned by the user
          const unpositionedNew = newCards
            .map(c => c.id)
            .filter(id => !positionedCardIds.has(id));
          if (unpositionedNew.length > 0) {
            setPinnedNewCardIds(prev => {
              const next = new Set(prev);
              unpositionedNew.forEach(id => next.add(id));
              try { localStorage.setItem('pinned_new_card_ids', JSON.stringify(Array.from(next))); } catch {}
              return next;
            });
            const updatedOrder = getEffectiveOrder(sharedCardOrder, safeCards);
            setSharedCardOrder(updatedOrder);
            console.log(`🆕 Prepending ${unpositionedNew.length} truly-new cards${logPrefix}:`, { unpositionedNew });
          }
        } else if (sharedCardOrder.length === 0) {
          // No existing order - set default order
          const defaultOrder = getDefaultCardOrder(safeCards);
          const effective = getEffectiveOrder(defaultOrder, safeCards);
          setSharedCardOrder(effective);
          console.log(`Setting default card order${logPrefix}:`, {
            cardCount: safeCards.length,
            defaultOrder,
            cardNames: defaultOrder.map(id => safeCards.find(c => c.id === id)?.name)
          });
        }
      }
    }

    if (billingCyclesRes.ok) {
      const { billingCycles: cycles } = await billingCyclesRes.json();
      const safeCycles = Array.isArray(cycles) ? cycles : [];
      // Log only; do not update UI with partial data. We'll defer to the full-history fetch.
      const amexCycles = safeCycles.filter((c: any) => c.creditCardName?.toLowerCase().includes('platinum'));
      console.log(`🔍 DASHBOARD${logPrefix} RECEIVED FROM API (suppressed UI update):`, { totalCycles: safeCycles.length, amexCycles: amexCycles.length });
      if (safeCycles.length > 0) scheduleFullCyclesFetch(' (after fetchAllUserData)');
    }

    if (transactionsRes.ok) {
      const { transactions } = await transactionsRes.json();
      // Ensure transactions is always an array to prevent filter errors
      const safeTransactions = Array.isArray(transactions) ? transactions : [];
      setCurrentMonthTransactions(safeTransactions);
    }

    // Process connection health data
    if (connectionHealthRes.ok) {
      const healthData = await connectionHealthRes.json();
      console.log(`📊 Connection health data received${logPrefix}:`, healthData);
      setConnectionHealth(healthData);
    } else {
      const errorText = await connectionHealthRes.text();
      console.warn(`Failed to fetch connection health data${logPrefix}:`, connectionHealthRes.status, errorText);
      setConnectionHealth(null);
    }
  };

  const fetchUserData = async () => {
    if (!isLoggedIn) return;
    
    try {
      setLoading(true);
      await fetchAllUserData('');
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Lightweight refresh for new card addition - only fetches data, no syncing
  const refreshDataOnly = async () => {
    if (!isLoggedIn) return;
    
    try {
      console.log('🔄 Refreshing data after new card addition (no syncing)');
      
      // Set flag to prevent automatic background sync
      setRecentCardAddition(true);
      
      await fetchAllUserData('NEW_CARD_REFRESH: ');
      
      console.log('✅ New card data refresh completed');
      
      // Clear the flag after 10 seconds to allow normal background syncing to resume
      setTimeout(() => {
        console.log('🔄 Clearing recent card addition flag - background sync can resume');
        setRecentCardAddition(false);
      }, 10000);
      
    } catch (error) {
      console.error('Error refreshing data after card addition:', error);
      // Clear flag even on error to prevent permanently blocking background sync
      setRecentCardAddition(false);
    }
  };

  // Hybrid refresh for new card addition - uses cache for existing cards, fetches new card data only
  const refreshWithNewCard = async () => {
    if (!isLoggedIn) return;
    
    try {
      console.log('🔄 Hybrid refresh: Using cache for existing cards, fetching new card data');
      
      // Set flag to prevent automatic background sync
      setRecentCardAddition(true);
      
      // Get current cached cards count for comparison
      const currentCardCount = creditCards.length;
      console.log(`📊 Current card count: ${currentCardCount}`);
      
      // Fetch only credit cards to check for new ones (lightweight API call)
      const cardsResponse = await fetch('/api/user/credit-cards', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      
      if (cardsResponse.ok) {
        const { creditCards: freshCards } = await cardsResponse.json();
        const safeCards = Array.isArray(freshCards) ? freshCards : [];
        
        console.log(`📊 Fresh card count: ${safeCards.length}`);
        
        if (safeCards.length > currentCardCount) {
          // New card(s) detected - update state with fresh data
          console.log('🆕 New card(s) detected, updating card state');
          setCreditCards(safeCards);
          
          // Update card order to put new cards at front
          const currentCardIds = new Set(creditCards.map(c => c.id));
          const newCards = safeCards.filter(card => !currentCardIds.has(card.id));
          
          if (newCards.length > 0) {
            const newCardIds = newCards.map(card => card.id);
            const updatedOrder = [...newCardIds, ...sharedCardOrder];
            setSharedCardOrder(updatedOrder);
            console.log(`🆕 Added ${newCards.length} new cards to front of order:`, {
              newCardNames: newCards.map(c => c.name),
              updatedOrder: updatedOrder.map(id => safeCards.find(c => c.id === id)?.name)
            });
          }
          
          // Fetch billing cycles for completeness (but keep it lightweight)
          const cyclesResponse = await fetch('/api/user/billing-cycles?recent=1', {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' }
          });
          
          if (cyclesResponse.ok) {
            // Suppress partial UI update; wait for full-history later
            const { billingCycles: cycles } = await cyclesResponse.json();
            const safeCycles = Array.isArray(cycles) ? cycles : [];
            console.log(`ℹ️ Recent cycles fetched (UI unchanged): ${safeCycles.length}`);
          }
          
          console.log('✅ Hybrid refresh completed - new card visible');
        } else {
          console.log('⏳ No new cards detected yet, keeping current state');
        }
      }
      
      // Clear the flag after 10 seconds to allow normal background syncing to resume
      setTimeout(() => {
        console.log('🔄 Clearing recent card addition flag - background sync can resume');
        setRecentCardAddition(false);
      }, 10000);
      
    } catch (error) {
      console.error('Error in hybrid refresh after card addition:', error);
      // Clear flag even on error to prevent permanently blocking background sync
      setRecentCardAddition(false);
    }
  };

  // Background sync function - syncs with Plaid API silently, same as Refresh All but without blocking UI
  const backgroundSync = async () => {
    if (!isLoggedIn) return;
    
    // Skip background sync if card was recently added or if deletion is in progress
    if (recentCardAddition) {
      console.log('⏭️ Skipping background sync - recent card addition in progress');
      return;
    }
    
    if (cardDeletionInProgress) {
      console.log('⏭️ Skipping background sync - card deletion in progress');
      return;
    }
    
    try {
      setBackgroundSyncing(true);
      
      // Sync with Plaid API using shared function
      try {
        const syncResult = await syncWithPlaidAPI(' Background sync');
        
        // Handle any reconnection needs silently (don't auto-trigger for background sync)
        const needsReconnection = syncResult.results?.some((result: any) => result.requiresReconnection);
        if (needsReconnection) {
          console.log('⚠️ Background sync: Some connections need reconnection (user can use Refresh All for auto-reconnect)');
        }
      } catch (error) {
        console.warn('⚠️ Background sync: Plaid sync failed, falling back to database fetch');
      }
      
      // Always fetch the latest data from database after sync attempt
      await fetchAllUserData(' (background sync)');
      setLastBackgroundSync(new Date());
    } catch (error) {
      console.error('Background sync error:', error);
      // Fallback to database fetch if sync fails
      try {
        await fetchAllUserData(' (background sync fallback)');
      } catch (fallbackError) {
        console.error('Background sync fallback error:', fallbackError);
      }
    } finally {
      setBackgroundSyncing(false);
    }
  };

  const handleRefresh = async () => {
    console.log('=== HANDLEREFRESH CALLED ===');
    setRefreshing(true);
    setRefreshProgress(0);
    setRefreshStep('Starting refresh...');
    
    try {
      console.log('=== FRONTEND: Starting refresh process ===');
      setRefreshStep('Connecting to your banks...');
      setRefreshProgress(20);
      
      setRefreshStep('Syncing account data...');
      setRefreshProgress(50);
      
      const syncResult = await syncWithPlaidAPI(' Refresh All', true); // Force sync regardless of recent sync
      console.log('Sync API success result:', syncResult);
      
      setRefreshStep('Processing connections...');
      setRefreshProgress(70);
      
      // Check if any connections require reconnection
      const needsReconnection = syncResult.results?.some((result: any) => result.requiresReconnection);
      const autoReconnectAvailable = syncResult.results?.some((result: any) => result.canAutoReconnect);
      
      if (needsReconnection) {
        console.log('⚠️ Some connections need to be reconnected');
        setRefreshStep('Handling connection issues...');
        
        if (autoReconnectAvailable) {
          console.log('🔄 Auto-reconnection available, triggering reconnect flow...');
          setRefreshStep('Auto-reconnecting expired cards...');
          // Auto-trigger reconnection for expired cards
          const expiredResults = syncResult.results?.filter((result: any) => result.requiresReconnection) || [];
          
          for (const expiredResult of expiredResults) {
            console.log(`Auto-reconnecting ${expiredResult.itemId}...`);
            try {
              await handleCardReconnect(expiredResult.itemId);
            } catch (error) {
              console.error(`Auto-reconnection failed for ${expiredResult.itemId}:`, error);
            }
          }
        } else {
          alert('Some of your bank connections have expired and need to be reconnected. Please use the reconnect buttons on your cards or add them again with "Connect Credit Cards".');
        }
      }
      
      setRefreshStep('Finalizing updates...');
      setRefreshProgress(90);
      
      console.log('Fetching user data after sync...');
      await fetchAllUserData(' (refresh all)');
      
      setRefreshStep('Complete!');
      setRefreshProgress(100);
      console.log('=== FRONTEND: Refresh process completed ===');
    } catch (error) {
      console.error('=== FRONTEND: Error refreshing data ===', error);
      setRefreshStep('Error occurred during refresh');
    } finally {
      // Add a small delay to show completion state
      setTimeout(() => {
        setRefreshing(false);
        setRefreshProgress(0);
        setRefreshStep('');
      }, 1000);
    }
  };


  const handleCardSync = async (itemId: string) => {
    console.log(`🎯 handleCardSync called with itemId: ${itemId}`);
    try {
      const response = await fetch('/api/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, forceSync: true }) // Force sync to bypass any caching
      });
      
      if (response.ok) {
        const syncData = await response.json();
        console.log('Sync response data:', syncData);
        console.log('Sync results detailed:', syncData.results?.map((r: any) => ({
          itemId: r.itemId,
          status: r.status,
          requiresReconnection: r.requiresReconnection,
          error: r.error,
          canAutoReconnect: r.canAutoReconnect
        })));
        
        // Check if sync was actually successful
        const hasErrors = syncData.results?.some((r: any) => r.status === 'error');
        const successCount = syncData.results?.filter((r: any) => r.status === 'success').length || 0;
        const reconnectionRequired = syncData.results?.some((r: any) => r.requiresReconnection);
        
        if (hasErrors) {
          console.warn(`Sync completed with ${successCount} successes and some errors`);
          
          if (reconnectionRequired) {
            // Find the specific itemId that requires reconnection
            const errorResult = syncData.results?.find((r: any) => r.requiresReconnection);
            if (errorResult?.itemId) {
              console.log(`🔄 Auto-triggering reconnection for itemId: ${errorResult.itemId}`);
              
              // Show brief message then auto-trigger reconnection
              if (successCount > 0) {
                console.log(`✅ ${successCount} cards synced successfully. Opening reconnection for expired connection...`);
                // Don't use alert here as it might interrupt the Plaid flow
              } else {
                console.log(`🔄 Opening reconnection for expired connection...`);
              }
              
              // Auto-trigger reconnection flow
              await handleCardReconnect(errorResult.itemId);
              return; // Exit early, don't refresh data yet (reconnection will handle that)
            } else {
              alert(`Connection expired - please use the "Reconnect" button. ${successCount > 0 ? `${successCount} other cards synced successfully.` : ''}`);
            }
          } else {
            alert(`Sync completed but some connections need attention. ${successCount} cards synced successfully.`);
          }
        } else {
          console.log('Card sync fully successful');
        }
        
        // Add small delay to ensure database updates are complete before refreshing
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Only refresh the specific card's data, not all cards
        console.log('🔄 Refreshing synced card data from database...');
        
        // Fetch only the updated billing cycles for this specific card
        try {
          const res = await fetch('/api/user/credit-cards', { cache: 'no-store' });
          if (res.ok) {
            const { creditCards: latest } = await res.json();
            const syncedCards = (latest || []).filter((c: any) => c.plaidItem?.itemId === itemId);
            
            if (syncedCards.length > 0) {
              // Update only the synced cards in state
              setCreditCards(prev => {
                const updated = [...prev];
                for (const syncedCard of syncedCards) {
                  const index = updated.findIndex(c => c.id === syncedCard.id);
                  if (index >= 0) {
                    updated[index] = syncedCard;
                  }
                }
                return updated;
              });
              
              // Fetch billing cycles for just the synced cards
              const syncedCardIds = syncedCards.map((c: any) => c.id);
              const cyclesRes = await fetch('/api/user/billing-cycles', { cache: 'no-store' });
              if (cyclesRes.ok) {
                const { billingCycles: allCycles } = await cyclesRes.json();
                const syncedCycles = (allCycles || []).filter((c: any) => syncedCardIds.includes(c.creditCardId));
                
                // Update only the cycles for synced cards
                setBillingCycles(prev => {
                  // Remove old cycles for synced cards and add new ones
                  const otherCycles = prev.filter(c => !syncedCardIds.includes(c.creditCardId));
                  return dedupeCycles([...otherCycles, ...syncedCycles]);
                });
              }
            }
          }
        } catch (error) {
          console.error('Error refreshing synced card data:', error);
        }
        
        // Mark only the synced item's cards as loading historical cycles (spinner, disabled button)
        try {
          const res = await fetch('/api/user/credit-cards', { cache: 'no-store' });
          if (res.ok) {
            const { creditCards: latest } = await res.json();
            const syncedCardIds = (latest || [])
              .filter((c: any) => c.plaidItem?.itemId === itemId)
              .map((c: any) => c.id);
            if (syncedCardIds.length > 0) {
              // Show visual spinner for up to 30 seconds
              setVisualRefreshingIds(prev => Array.from(new Set([...prev, ...syncedCardIds])));
              setTimeout(() => {
                setVisualRefreshingIds(prev => prev.filter(id => !syncedCardIds.includes(id)));
              }, 30000);

              // Show Older Cycles button as loading (unclickable) for just these cards
              setHistoryRefreshingIds(prev => Array.from(new Set([...prev, ...syncedCardIds])));

              // Lightweight polling until historical cycles show signs of completion
              const start = Date.now();
              const poll = async () => {
                try {
                  const cyclesRes = await fetch('/api/user/billing-cycles?recent=1', { cache: 'no-store' });
                  if (cyclesRes.ok) {
                    const { billingCycles } = await cyclesRes.json();
                    const doneIds: string[] = [];
                    for (const cardId of syncedCardIds) {
                      const cardCycles = (billingCycles || [])
                        .filter((bc: any) => bc.creditCardId === cardId)
                        .sort((a: any, b: any) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
                      const historical = cardCycles.slice(2);
                      // Consider done if no historical cycles expected (new card) or all are loaded
                      const allHistoricalLoaded = historical.length === 0 || historical.every((c: any) =>
                        (typeof c.transactionCount === 'number') ||
                        (typeof c.statementBalance === 'number' && c.statementBalance >= 0)
                      );
                      if (allHistoricalLoaded || cardCycles.length >= 2) doneIds.push(cardId);
                    }
                                    if (doneIds.length > 0) {
                                      setHistoryRefreshingIds(prev => prev.filter(id => !doneIds.includes(id)));
                                      // Fetch full history and overwrite cycles for a unified view
                                      try {
                                        const full = await fetch('/api/user/billing-cycles', { cache: 'no-store' });
                                        if (full.ok) {
                                          const { billingCycles: all } = await full.json();
                                          if (Array.isArray(all)) {
                                            setBillingCycles(dedupeCycles(all));
                                          }
                                        }
                                      } catch {}
                                    }
                    if (Date.now() - start < 120000 && doneIds.length < syncedCardIds.length) {
                      setTimeout(poll, 5000);
                    } else if (doneIds.length < syncedCardIds.length) {
                      // Timeout reached but some cards still loading - clear their loading state
                      console.log('⏱️ Polling timeout reached, clearing loading state for remaining cards');
                      setHistoryRefreshingIds(prev => prev.filter(id => !syncedCardIds.includes(id)));
                    }
                  }
                } catch {}
              };
              setTimeout(poll, 5000);
            }
          }
        } catch {}
        
        // Individual card sync completed successfully - no need to check connection health with API calls
        // If sync was successful, we know the connection is working
        console.log('✅ Individual card sync completed successfully - connection is healthy');
      } else {
        console.error('Card sync failed:', response.status);
        const errorText = await response.text();
        console.error('Sync error details:', errorText);
        alert('Failed to sync card data. Please try again.');
      }
    } catch (error) {
      console.error('Error syncing card:', error);
      alert('Network error during sync. Please try again.');
    }
  };

  const handleCardReconnect = async (itemId: string) => {
    try {
      console.log(`🔄 Creating update link token for reconnection: ${itemId}`);
      
      const response = await fetch('/api/plaid/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
      
      const data = await response.json();
      
      if (data.success && data.link_token) {
        console.log(`✅ Update link token created for ${data.institution_name}`);
        
        // Use the proper Plaid Link update component
        setUpdateFlow({
          linkToken: data.link_token,
          institutionName: data.institution_name,
          itemId: itemId
        });
      } else {
        console.error('Failed to create reconnection link:', data.error);
        alert('Failed to create reconnection link. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error creating reconnection link:', error);
      alert('Network error. Please try again.');
    }
  };


  const handleCreditLimitUpdated = (data: {
    newLimit: number;
    previousLimit: number | null;
    plaidLimit: number | null;
    newUtilization: number;
    cardName: string;
  }) => {
    setSuccessPopupData(data);
    setShowSuccessPopup(true);
  };

  const handleRequestDelete = (card: any) => {
    console.log('🗑️ handleRequestDelete called with card:', {
      cardId: card.id,
      cardName: card.name,
      plaidItem: card.plaidItem,
      plaidItemId: card.plaidItemId
    });
    setCardToDelete(card);
    setShowDeleteConfirm(true);
  };
  
  // Helper function to get all cards that share the same plaidItemId
  const getCardsToBeDeleted = (card: any): any[] => {
    if (!card?.plaidItem?.itemId) return [card];
    
    return creditCards.filter(c => c.plaidItem?.itemId === card.plaidItem.itemId);
  };

  const handleConfirmDelete = async () => {
    if (!cardToDelete) return;
    
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    setDeletionProgress(20);
    
    const cardsToDelete = getCardsToBeDeleted(cardToDelete);
    const bankName = cardToDelete.plaidItem?.institutionName || 'bank';
    
    if (cardsToDelete.length > 1) {
      setDeletionStep(`Disconnecting from ${bankName}...`);
    } else {
      setDeletionStep('Disconnecting from bank...');
    }
    
    try {
      // Start deletion process
      setDeletionProgress(50);
      if (cardsToDelete.length > 1) {
        setDeletionStep(`Removing ${cardsToDelete.length} cards from ${bankName}...`);
      } else {
        setDeletionStep('Removing card data...');
      }
      
      if (cardToDelete.plaidItem?.itemId) {
        console.log('🗑️ Calling handleCardRemove with itemId:', cardToDelete.plaidItem.itemId);
        await handleCardRemove(cardToDelete.plaidItem.itemId);
      } else {
        console.error('🗑️ ERROR: cardToDelete.plaidItem is missing!', {
          cardToDelete,
          plaidItem: cardToDelete.plaidItem
        });
        throw new Error('Cannot delete card: Missing Plaid connection information');
      }
      
      setDeletionProgress(100);
      setDeletionStep('Complete!');
      
      // Verify deletion by fetching fresh data before closing dialog
      try {
        await fetchDatabaseDataOnly(' Post delete verify: ');
      } finally {
        // Brief pause to show completion
        setTimeout(() => {
          setIsDeleting(false);
          setDeletionProgress(0);
          setDeletionStep('');
          setShowDeletionSuccess(true);
          setCardToDelete(null);
        }, 500);
      }
    } catch (error) {
      console.error('Error removing card:', error);
      setIsDeleting(false);
      setDeletionProgress(0);
      setDeletionStep('');
      
      // Show specific error message in the deletion dialog instead of browser alert
      setDeletionStep(error instanceof Error ? error.message : 'Failed to remove card');
      
      // Auto-close error message after 3 seconds (reduced from 5)
      setTimeout(() => {
        setDeletionStep('');
        setCardToDelete(null);
      }, 3000);
    }
  };

  // Delete only the selected card (not the whole connection)
  const handleConfirmDeleteSingle = async () => {
    if (!cardToDelete) return;

    setShowDeleteConfirm(false);
    setIsDeleting(true);
    setDeletionProgress(20);
    setDeletionStep('Removing this card...');

    try {
      // Optimistic UI updates for a single card
      const removedCardId = cardToDelete.id;
      setCreditCards(prev => prev.filter(c => c.id !== removedCardId));
      setBillingCycles(prev => prev.filter(cycle => cycle.creditCardId !== removedCardId));
      setSharedCardOrder(prev => prev.filter(id => id !== removedCardId));
      setPinnedNewCardIds(prev => {
        const next = new Set(prev);
        next.delete(removedCardId);
        try { localStorage.setItem('pinned_new_card_ids', JSON.stringify(Array.from(next))); } catch {}
        return next;
      });

      setDeletionProgress(50);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`/api/cards/${removedCardId}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('Single-card delete failed with status', response.status);
        await fetchUserData(); // revert optimistic
        throw new Error('Failed to delete card');
      }

      setDeletionProgress(100);
      setDeletionStep('Complete!');

      await fetchDatabaseDataOnly(' Post single delete verify: ');
      setTimeout(() => {
        setIsDeleting(false);
        setDeletionProgress(0);
        setDeletionStep('');
        setShowDeletionSuccess(true);
        setCardToDelete(null);
      }, 500);
    } catch (error) {
      console.error('Error removing single card:', error);
      setIsDeleting(false);
      setDeletionProgress(0);
      setDeletionStep('');
      setTimeout(() => {
        setCardToDelete(null);
      }, 3000);
    }
  };

  const handleCardRemove = async (itemId: string) => {
    try {
      const cardToRemove = creditCards.find(card => card.plaidItem?.itemId === itemId);
      console.log(`🗑️ Starting card removal for itemId: ${itemId}`, cardToRemove?.name);
      console.log(`🗑️ Current cards before removal:`, creditCards.map(c => ({id: c.id, name: c.name, itemId: c.plaidItem?.itemId})));
      
      // Set flag to prevent background syncs during deletion
      setCardDeletionInProgress(true);
      console.log(`🗑️ Set cardDeletionInProgress = true to prevent background syncs`);
      
      // Immediately update UI - optimistic update
      setCreditCards(prevCards => {
        const filtered = prevCards.filter(card => card.plaidItem?.itemId !== itemId);
        console.log(`🗑️ Optimistic UI update: Removed ${prevCards.length - filtered.length} cards from UI`);
        return filtered;
      });
      
      // Also update billing cycles to remove cycles for ALL deleted cards
      setBillingCycles(prevCycles => {
        const removedCards = creditCards.filter(card => card.plaidItem?.itemId === itemId);
        if (removedCards.length > 0) {
          const removedCardIds = removedCards.map(c => c.id);
          const filtered = prevCycles.filter(cycle => !removedCardIds.includes(cycle.creditCardId));
          console.log(`🗑️ Optimistic UI update: Removed ${prevCycles.length - filtered.length} billing cycles from UI`);
          return filtered;
        }
        return prevCycles;
      });
      
      // Update card order to remove ALL deleted cards for this itemId
      const removedCards = creditCards.filter(card => card.plaidItem?.itemId === itemId);
      if (removedCards.length > 0) {
        const removedCardIds = removedCards.map(c => c.id);
        setSharedCardOrder(prevOrder => {
          const filtered = prevOrder.filter(id => !removedCardIds.includes(id));
          console.log(`🗑️ Updated card order: Removed ${removedCards.length} cards from order`);
          return filtered;
        });
      }
      
      // Make API call to remove from backend with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        console.log(`🗑️ Starting removal request for itemId: ${itemId}`);
        
        const response = await fetch('/api/plaid/remove-connection', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log(`✅ Removal request completed with status: ${response.status}`);
      
        // Check if the response is ok before trying to parse JSON
        if (!response.ok) {
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
            console.error('Error response data:', errorData);
          } catch (parseError) {
            // If JSON parsing fails, use the HTTP status message
            console.warn('Failed to parse error response:', parseError);
          }
          
          console.error('API request failed:', errorMessage);
          // Revert the optimistic update on failure
          console.log('🗑️ Deletion failed - reverting optimistic UI updates...');
          await fetchUserData();
          throw new Error(errorMessage);
        }
        
        let data;
        try {
          data = await response.json();
          console.log('✅ Parsed success response:', data);
        } catch (jsonError) {
          console.error('Failed to parse success response JSON:', jsonError);
          // If we can't parse the response but the status is ok, assume success
          console.log('⚠️ Assuming success due to OK status despite JSON parse failure');
          data = { success: true, message: 'Card deleted successfully' };
        }
        
        if (!data.success) {
          console.error('Failed to remove connection:', data.error);
          // Revert the optimistic update on failure  
          console.log('🗑️ Deletion not successful - reverting optimistic UI updates...');
          await fetchUserData();
          throw new Error(data.error || 'Failed to remove connection');
        }
        
        console.log('🎉 Card deletion completed successfully - no need to revert optimistic updates');
        
        // Clear the deletion in progress flag
        setCardDeletionInProgress(false);
        console.log(`🗑️ Set cardDeletionInProgress = false - deletion complete`);
        
        // Clear from localStorage cache as well
        if (typeof window !== 'undefined') {
          const cachedCards = localStorage.getItem('cached_credit_cards');
          if (cachedCards) {
            const cards = JSON.parse(cachedCards);
            const updatedCards = cards.filter((card: any) => card.plaidItem?.itemId !== itemId);
            localStorage.setItem('cached_credit_cards', JSON.stringify(updatedCards));
          }
        }
        
        console.log(`Successfully removed card connection: ${data.message}`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error('🚨 Fetch error during deletion:', fetchError);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timed out. Please check your connection and try again.');
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Error removing connection:', error);
      // Clear the deletion in progress flag on error
      setCardDeletionInProgress(false);
      console.log(`🗑️ Set cardDeletionInProgress = false - deletion API call failed`);
      // The error will be handled by the calling component
      throw error;
    }
  };

  // Check if it's time for scheduled sync (9:30 AM or 9:30 PM EST)
  const isScheduledSyncTime = (): boolean => {
    const now = new Date();
    
    // Convert to EST
    const estOffset = -5; // EST is UTC-5 (or UTC-4 in DST, but keeping it simple)
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const est = new Date(utc + (estOffset * 3600000));
    
    const hours = est.getHours();
    const minutes = est.getMinutes();
    
    // Check if it's 9:30 AM or 9:30 PM EST (within a 30-minute window)
    const isTargetTime = (hours === 9 || hours === 21) && minutes >= 30 && minutes < 60;
    
    if (isTargetTime) {
      // Check if we've already synced in the last hour to avoid multiple syncs
      const lastSync = localStorage.getItem('lastScheduledSync');
      if (lastSync) {
        const lastSyncTime = new Date(lastSync);
        const hoursSinceLastSync = (now.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceLastSync < 1) {
          console.log('⏭️ Scheduled sync already performed in the last hour, skipping');
          return false;
        }
      }
      
      console.log(`⏰ It's scheduled sync time (${hours === 9 ? '9:30 AM' : '9:30 PM'} EST)`);
      return true;
    }
    
    return false;
  };

  // Database-only data fetch for initial load (no API calls)
  const fetchDatabaseDataOnly = async (logPrefix: string = '', preferredOrder?: string[]) => {
    if (!isLoggedIn) return;
    
    console.log(`📀 ${logPrefix}Loading data from database only (no API calls)`);
    
    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    try {
      const [creditCardsRes, billingCyclesRes, transactionsRes] = await Promise.all([
        fetch('/api/user/credit-cards', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
        fetch('/api/user/billing-cycles?recent=1', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }),
        fetch(`/api/user/transactions?startDate=${startOfMonth.toISOString()}&endDate=${endOfMonth.toISOString()}&limit=1000`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        })
      ]);

      if (creditCardsRes.ok) {
        const { creditCards: cards } = await creditCardsRes.json();
        const safeCards = Array.isArray(cards) ? cards : [];
        setCreditCards(safeCards);
        
        // Update shared card order to include new cards
        if (safeCards.length > 0) {
          const baseOrder = (preferredOrder && preferredOrder.length > 0) ? preferredOrder : sharedCardOrder;
          const currentCardIds = new Set(baseOrder);
          const newCards = safeCards.filter(card => !currentCardIds.has(card.id));
          
          if (newCards.length > 0) {
            const unpositionedNew = newCards
              .map(c => c.id)
              .filter(id => !positionedCardIds.has(id));
            if (unpositionedNew.length > 0) {
              const updatedOrder = [...unpositionedNew, ...baseOrder];
              setSharedCardOrder(updatedOrder);
              console.log(`🆕 Adding ${unpositionedNew.length} new cards to front of order${logPrefix}:`, {
                unpositionedNew,
                updatedOrder: updatedOrder.map(id => safeCards.find(c => c.id === id)?.name)
              });
            }
          } else if (baseOrder.length === 0) {
            const defaultOrder = getDefaultCardOrder(safeCards);
            setSharedCardOrder(defaultOrder);
            orderInitializedRef.current = true; // default has been chosen
            console.log(`Setting default card order${logPrefix}:`, {
              cardCount: safeCards.length,
              defaultOrder,
              cardNames: defaultOrder.map(id => safeCards.find(c => c.id === id)?.name)
            });
          }
        }
      }

      if (billingCyclesRes.ok) {
        const { billingCycles: cycles } = await billingCyclesRes.json();
        const safeCycles = Array.isArray(cycles) ? cycles : [];
        // Replace entirely with fresh data to avoid duplicates
        setBillingCycles(dedupeCycles(safeCycles));
        // Defer full-history fetch by a few seconds post-paint
        if (safeCycles.length > 0) scheduleFullCyclesFetch(' (after fetchDatabaseDataOnly)');
      }

      if (transactionsRes.ok) {
        const { transactions } = await transactionsRes.json();
        const safeTransactions = Array.isArray(transactions) ? transactions : [];
        setCurrentMonthTransactions(safeTransactions);
      }

      // Intentionally skip live Plaid connection-health checks on initial load to avoid unnecessary API calls
      // We'll only fetch connection health during explicit user actions (e.g., Refresh All) to control costs.
      
      console.log(`✅ ${logPrefix}Database data loaded successfully`);
    } catch (error) {
      console.error(`❌ ${logPrefix}Error loading database data:`, error);
    }
  };

  // Check connection health and perform scheduled sync if needed
  const checkConnectionHealthAndScheduledSync = async () => {
    if (!isLoggedIn) return;

    try {
      // Note: Scheduled sync is now handled by performDailySyncCheck() with 12-hour protection
      // This old time-based sync logic has been removed to prevent duplicate syncs

      // For initial load, just load from database - no health checking that might trigger syncs
      console.log('✅ Initial load complete - database data available. Use "Refresh All" for latest API data.');
    } catch (error) {
      console.error('Error during initial data check:', error);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;

    const loadInitialData = async () => {
      try {
        console.log('🚀 Starting initial data load on sign-in...');
        setInitialLoading(true);
        
        // Step 1: Load cached data immediately for instant UI
        console.log('📦 Step 1: Loading cached data for instant UI...');
        // Load cached card order first to avoid visual reordering on first paint
        let cachedOrderApplied = false;
        try {
          const cachedOrder = localStorage.getItem('cached_card_order');
          if (cachedOrder) {
            const order = JSON.parse(cachedOrder);
            if (Array.isArray(order) && order.length > 0) {
              setSharedCardOrder(order);
              console.log('✅ Loaded card order from local cache');
              cachedOrderApplied = true;
            }
          }
        } catch (e) {
          console.warn('Failed to read cached card order:', e);
        }
        const cachedCards = localStorage.getItem('cached_credit_cards');
        const cachedCycles = localStorage.getItem('cached_billing_cycles');
        const cachedTxns = localStorage.getItem('cached_transactions_current_month');
        
        let hasCachedData = false;
        
        if (cachedCards) {
          const cards = JSON.parse(cachedCards);
          if (Array.isArray(cards) && cards.length > 0) {
            setCreditCards(cards);
            console.log(`✅ Loaded ${cards.length} cards from cache instantly`);
            hasCachedData = true;
            
            // Don't set order here - wait for DB order to load first
            // Only set default order if DB doesn't have one
          }
        }
        
        if (cachedCycles) {
          const cycles = JSON.parse(cachedCycles);
          if (Array.isArray(cycles) && cycles.length > 0) {
            const deduped = dedupeCycles(cycles);
            setBillingCycles(deduped);
            console.log(`✅ Loaded ${deduped.length} billing cycles from cache instantly (deduped)`);
          }
        }
        
        if (cachedTxns) {
          try {
            const txns = JSON.parse(cachedTxns);
            if (Array.isArray(txns) && txns.length > 0) {
              setCurrentMonthTransactions(txns);
              console.log(`✅ Loaded ${txns.length} transactions from cache instantly`);
            }
          } catch {}
        }
        
        // Step 2a: Load saved card order from DB (only if user hasn't manually set order)
        let loadedOrder: string[] | undefined = undefined;
        try {
          const orderRes = await fetch('/api/user/credit-cards/order', { cache: 'no-store' });
          if (orderRes.ok) {
            const { order } = await orderRes.json();
            if (!hasUserOrdered && !cachedOrderApplied && Array.isArray(order) && order.length > 0) {
              loadedOrder = order;
              setSharedCardOrder(order);
              orderInitializedRef.current = true;
              console.log('✅ Loaded saved card order from DB:', order);
              // Mirror to cache for faster next paint
              try { localStorage.setItem('cached_card_order', JSON.stringify(order)); } catch {}
            }
          }
        } catch (e) {
          console.warn('Failed to load saved card order (will use default):', e);
        }

        // Step 2b: Load fresh database data (no API calls)
        console.log('📀 Step 2: Loading fresh data from database (no API calls)...');
        await fetchDatabaseDataOnly('Initial load: ', loadedOrder);
        
        // Step 3: Check if daily sync needed (12-hour window, for active users only)
        // Delay the sync check to avoid immediate API calls on page load
        console.log('🌅 Step 3: Checking if daily sync needed (12-hour window for active users)...');
        setTimeout(() => {
          performDailySyncCheck();
        }, 2000); // Increased delay to 2 seconds to ensure user is actively using the app
        
        console.log('✅ Initial data load complete - showing most recent database data');
        setInitialLoading(false);
        
      } catch (error) {
        console.error('❌ Failed to load initial data:', error);
        setInitialLoading(false);
        // Even on error, try to load from cache as fallback
        const cachedCards = localStorage.getItem('cached_credit_cards');
        if (cachedCards) {
          try {
            const cards = JSON.parse(cachedCards);
            if (Array.isArray(cards) && cards.length > 0) {
              setCreditCards(cards);
              console.log(`🔄 Fallback: Loaded ${cards.length} cards from cache`);
            }
          } catch (cacheError) {
            console.warn('Failed to load cached data as fallback:', cacheError);
          }
        }
      }
    };
    
    loadInitialData();
  }, [isLoggedIn]);

  // Persist card order to DB when it changes
  useEffect(() => {
    if (!isLoggedIn || !Array.isArray(sharedCardOrder) || sharedCardOrder.length === 0) return;
    if (!orderInitializedRef.current) {
      // If we have cards and an order, mark as initialized
      if (creditCards.length > 0 && sharedCardOrder.length > 0) {
        orderInitializedRef.current = true;
        console.log('📝 Order initialized due to manual change');
      } else {
        return; // don't save until initial order decided
      }
    }
    (async () => {
      try {
        await fetch('/api/user/credit-cards/order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: sharedCardOrder })
        });
        console.log('💾 Saved card order to DB:', sharedCardOrder);
        try { localStorage.setItem('cached_card_order', JSON.stringify(sharedCardOrder)); } catch {}
      } catch (e) {
        console.warn('Failed to save card order:', e);
      }
    })();
  }, [JSON.stringify(sharedCardOrder), isLoggedIn]);

  // Auto-close success popup after 5 seconds
  useEffect(() => {
    if (showSuccessPopup) {
      const timer = setTimeout(() => {
        setShowSuccessPopup(false);
        setSuccessPopupData(null);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [showSuccessPopup]);

  // Debug: Monitor credit card state changes
  useEffect(() => {
    console.log('🔍 DASHBOARD STATE CHANGE - Credit Cards:', {
      count: creditCards.length,
      cardNames: creditCards.map(c => c.name),
      cardIds: creditCards.map(c => c.id)
    });
  }, [creditCards]);

  useEffect(() => {
    console.log('🔍 DASHBOARD STATE CHANGE - Shared Card Order:', {
      orderLength: sharedCardOrder.length,
      orderIds: sharedCardOrder
    });
  }, [sharedCardOrder]);

  // Listen for credit limit updates
  useEffect(() => {
    const handleCreditLimitUpdate = (event: any) => {
      const { cardId, manualcreditlimit, ismanuallimit } = event.detail;
      console.log('📝 Credit limit updated event received:', { cardId, manualcreditlimit, ismanuallimit });
      
      // Update the credit card data in state
      setCreditCards(prevCards => 
        prevCards.map(card => 
          card.id === cardId 
            ? { ...card, manualcreditlimit, ismanuallimit }
            : card
        )
      );
    };

    window.addEventListener('creditLimitUpdated', handleCreditLimitUpdate);
    
    return () => {
      window.removeEventListener('creditLimitUpdated', handleCreditLimitUpdate);
    };
  }, []);

  // Set default order for mock cards when not logged in
  useEffect(() => {
    if (!isLoggedIn && sharedCardOrder.length === 0 && mockCards.length > 0) {
      const defaultOrder = getDefaultCardOrder(mockCards);
      setSharedCardOrder(defaultOrder);
      console.log('Setting default mock card order:', {
        cardCount: mockCards.length,
        defaultOrder,
        cardNames: defaultOrder.map(id => mockCards.find(c => c.id === id)?.name)
      });
    }
  }, [isLoggedIn]);

  const displayCardsRaw = isLoggedIn ? (Array.isArray(creditCards) ? creditCards : []) : mockCards;
  // Deduplicate cards visually by a stable identity key: normalized name + mask
  const displayCards = (() => {
    const byKey = new Map<string, any>();
    for (const c of displayCardsRaw) {
      const key = `${normalizeCardDisplayName(c.name || '', c.mask || '')}|${c.mask || ''}`.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, c);
    }
    return Array.from(byKey.values());
  })();
  const displayCycles = isLoggedIn ? (Array.isArray(billingCycles) ? billingCycles : []) : mockCycles.map(cycle => ({
    ...cycle,
    startDate: new Date(cycle.startDate),
    endDate: new Date(cycle.endDate),
    dueDate: cycle.dueDate ? new Date(cycle.dueDate) : undefined
  }));
  
  // Debug: Log what we're actually passing to components
  if (isLoggedIn && Array.isArray(billingCycles) && billingCycles.length > 0) {
    const amexCycles = (Array.isArray(displayCycles) ? displayCycles : []).filter((c: any) => 
      c.creditCardName?.toLowerCase().includes('platinum')
    );
    console.log('🔍 DASHBOARD PASSING TO COMPONENT:', {
      totalCycles: Array.isArray(displayCycles) ? displayCycles.length : 0,
      amexCycles: amexCycles.length
    });
  }
  
  // Calculate actual current month spending from transactions
  const totalSpendThisMonth = (() => {
    if (!isLoggedIn) {
      // For mock data, only sum OPEN cycles (no dueDate means open/current cycle)
      return Array.isArray(displayCycles) ? displayCycles
        .filter(cycle => !cycle.dueDate) // Only open cycles
        .reduce((sum, cycle) => sum + cycle.totalSpend, 0) : 0;
    }
    
    // For real data, sum all transaction amounts from current month
    // Transaction amounts are positive for purchases/spending
    return Array.isArray(currentMonthTransactions) ? currentMonthTransactions.reduce((sum, transaction) => {
      // Only include positive amounts (spending), exclude payments/credits
      return transaction.amount > 0 ? sum + transaction.amount : sum;
    }, 0) : 0;
  })();
  const totalBalance = Array.isArray(displayCards) ? displayCards.reduce((sum, card) => 
    sum + Math.abs(card.balanceCurrent || 0), 0
  ) : 0;
  const averageUtilization = (() => {
    if (!Array.isArray(displayCards)) return 0;
    
    const cardsWithLimits = displayCards.filter(card => {
      const effectiveLimit = card.ismanuallimit ? card.manualcreditlimit : card.balanceLimit;
      return effectiveLimit && effectiveLimit > 0 && isFinite(effectiveLimit);
    });
    
    if (cardsWithLimits.length === 0) return 0;
    
    return cardsWithLimits.reduce((sum, card) => {
      const balance = Math.abs(card.balanceCurrent || 0);
      const effectiveLimit = card.ismanuallimit ? card.manualcreditlimit! : card.balanceLimit!;
      return sum + (balance / effectiveLimit) * 100;
    }, 0) / cardsWithLimits.length;
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-none mx-auto px-9 py-4">
        {/* Header with title and Quick Actions */}
        <div className="mb-3 max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-1">Credit Card Dashboard</h1>
              <p className="text-gray-600 text-sm">
                {isLoggedIn 
                  ? 'Track your spending, due dates, and credit utilization' 
                  : 'Sign in to connect your credit cards and see real data'
                }
              </p>
            </div>
            
            {/* Quick Actions - ensure they stay visible */}
            <div className="flex items-center space-x-3 flex-shrink-0">
              {isLoggedIn ? (
                <>

                  {/* Elegant sync status showing real database sync times - moved to left of Refresh button */}
                  <div className="flex items-center space-x-2 text-xs">
                    {backgroundSyncing ? (
                      <div className="flex items-center text-blue-600">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2"></div>
                        <span className="font-medium">Syncing data...</span>
                      </div>
                    ) : (() => {
                      // Get the most recent sync time from all connected cards
                      const mostRecentSync = Array.isArray(displayCards) && displayCards.length > 0 
                        ? displayCards
                            .filter(card => card.plaidItem?.lastSyncAt)
                            .map(card => new Date(card.plaidItem.lastSyncAt))
                            .sort((a, b) => b.getTime() - a.getTime())[0]
                        : null;

                      // Debug dashboard sync time calculation
                      if (mostRecentSync) {
                        const timeDiff = Date.now() - mostRecentSync.getTime();
                        const minutesAgo = Math.floor(timeDiff / (1000 * 60));
                        console.log('🕐 DASHBOARD SYNC TIME DEBUG:', {
                          mostRecentSyncTime: mostRecentSync.toISOString(),
                          currentTime: new Date().toISOString(),
                          timeDiffMs: timeDiff,
                          minutesAgo,
                          displayText: timeDiff < 30000 ? 'Data current' : minutesAgo < 60 ? `${minutesAgo}m ago` : 'older'
                        });
                      }

                      if (mostRecentSync) {
                        const timeDiff = Date.now() - mostRecentSync.getTime();
                        const minutesAgo = Math.floor(timeDiff / (1000 * 60));
                        const hoursAgo = Math.floor(minutesAgo / 60);
                        const daysAgo = Math.floor(hoursAgo / 24);
                        
                        if (timeDiff < 30000) { // Less than 30 seconds
                          return (
                            <div className="flex items-center text-green-600">
                              <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                              <span>Data current</span>
                            </div>
                          );
                        } else if (hoursAgo === 0) {
                          return (
                            <div className="text-gray-500">
                              Last sync: {minutesAgo}m ago
                            </div>
                          );
                        } else if (daysAgo === 0) {
                          return (
                            <div className="text-gray-500">
                              Last sync: {hoursAgo}h ago
                            </div>
                          );
                        } else {
                          return (
                            <div className="text-gray-500">
                              Last sync: {daysAgo}d ago
                            </div>
                          );
                        }
                      } else {
                        return (
                          <div className="text-gray-400">
                            <div className="flex items-center">
                              <div className="w-2 h-2 bg-gray-400 rounded-full mr-2"></div>
                              <span>No sync data</span>
                            </div>
                          </div>
                        );
                      }
                    })()}
                  </div>

                  <button 
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`relative overflow-hidden font-medium py-3 px-6 rounded-2xl transition-all duration-200 flex items-center justify-center space-x-2 text-sm whitespace-nowrap transform focus:outline-none focus:ring-2 group border ${
                      refreshing 
                        ? 'bg-gray-100 border-gray-200 text-gray-600 cursor-not-allowed opacity-90 shadow-sm' 
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300 hover:shadow-md hover:scale-[1.02] focus:ring-gray-500/50 shadow-sm'
                    }`}
                  >
                    <RefreshCw className={`h-4 w-4 transition-transform duration-200 ${
                      (refreshing || backgroundSyncing) ? 'animate-spin' : 'group-hover:rotate-45'
                    }`} />
                    <span className="font-medium">
                      {refreshing ? refreshStep || 'Refreshing...' : backgroundSyncing ? 'Syncing...' : 'Refresh All'}
                    </span>
                    
                    {/* Progress bar - iOS style with grey theme */}
                    {refreshing && (
                      <div className="absolute inset-0 flex items-end">
                        <div 
                          className="h-1 bg-gradient-to-r from-gray-400 to-gray-600 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${refreshProgress}%` }}
                        />
                      </div>
                    )}
                    
                    {/* Shimmer effect when not refreshing */}
                    {!refreshing && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                    )}
                  </button>
                  
                  <PlaidLink onSuccess={async (ctx) => {
                    console.log('🎯🎯🎯 DashboardContent: PlaidLink onSuccess CALLBACK TRIGGERED 🎯🎯🎯');
                    console.log('📊 Current state before refresh:', {
                      creditCardCount: creditCards.length,
                      billingCycleCount: billingCycles.length,
                      sharedCardOrderLength: sharedCardOrder.length,
                      cardNames: creditCards.map(c => c.name)
                    });
                    
                    // Directly refresh the Dashboard data instead of page reload
                    try {
                      console.log('🔧 Setting recentCardAddition flag to prevent background sync interference');
                      setRecentCardAddition(true);
                      
                      // Wait a moment for database commits to complete
                      console.log('⏳ Waiting 1 second for database commits to complete...');
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      
                      // Capture current cards before refresh to detect new ones
                      const currentCardIds = new Set(creditCards.map(c => c.id));
                      console.log('📊 Current card IDs before refresh:', Array.from(currentCardIds));
                      
                      // Refresh data with the new card (lightweight version to avoid rate limits)
                      console.log('🔄 Starting fetchUserDataForNewCard...');
                      await fetchUserDataForNewCard('New card added: ');
                      console.log('✅ fetchUserDataForNewCard completed');
                      
                      console.log('📊 Final state after fetchUserDataForNewCard:', {
                        creditCardCount: creditCards.length,
                        billingCycleCount: billingCycles.length,
                        sharedCardOrderLength: sharedCardOrder.length,
                        cardNames: creditCards.map(c => c.name)
                      });
                      
                      // Mark newly added cards (by itemId) as visually refreshing
                      try {
                        if (ctx?.itemId) {
                          const res = await fetch('/api/user/credit-cards', { cache: 'no-store' });
                          if (res.ok) {
                            const { creditCards: latest } = await res.json();
                            let newCardsForItem = (latest || []).filter((c: any) => c.plaidItem?.itemId === ctx.itemId).map((c: any) => c.id);
                            // If PlaidLink provided explicit new ids, prefer those
                            if (ctx.newCardIds && ctx.newCardIds.length > 0) {
                              newCardsForItem = ctx.newCardIds;
                            }
                            if (newCardsForItem.length > 0) {
                              setVisualRefreshingIds(prev => Array.from(new Set([...prev, ...newCardsForItem])));
                              // Clear indicator after 30 seconds (visual only)
                              setTimeout(() => {
                                setVisualRefreshingIds(prev => prev.filter(id => !newCardsForItem.includes(id)));
                              }, 30000);

                              // Also mark older cycles as loading; poll DB-only for completion
                              setHistoryRefreshingIds(prev => Array.from(new Set([...prev, ...newCardsForItem])));
                              // Start lightweight polling to see when more than 2 cycles are present
                              const start = Date.now();
                              const poll = async () => {
                                try {
                                  const cyclesRes = await fetch('/api/user/billing-cycles?recent=1', { cache: 'no-store' });
                                  if (cyclesRes.ok) {
                                    const { billingCycles } = await cyclesRes.json();
                                    const doneIds: string[] = [];
                                    for (const cardId of newCardsForItem) {
                                      const cardCycles = (billingCycles || [])
                                        .filter((bc: any) => bc.creditCardId === cardId)
                                        .sort((a: any, b: any) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());

                                      // Ready only when ALL historical cycles (beyond current + recent closed)
                                      // show evidence of iteration (transactionCount present; can be 0) or a statementBalance value
                                      const historical = cardCycles.slice(2);
                                      // Consider done if no historical cycles expected (new card) or all are loaded
                                      const allHistoricalLoaded = historical.length === 0 || historical.every((c: any) =>
                                        (typeof c.transactionCount === 'number') ||
                                        (typeof c.statementBalance === 'number' && c.statementBalance >= 0)
                                      );
                                      if (allHistoricalLoaded || cardCycles.length >= 2) doneIds.push(cardId);
                                    }
                                    if (doneIds.length > 0) {
                                      setHistoryRefreshingIds(prev => prev.filter(id => !doneIds.includes(id)));
                                      // Fetch full history and fully overwrite cycles once some cards are ready
                                      try {
                                        const full = await fetch('/api/user/billing-cycles', { cache: 'no-store' });
                                        if (full.ok) {
                                          const { billingCycles: all } = await full.json();
                                          if (Array.isArray(all)) {
                                            setBillingCycles(dedupeCycles(all));
                                          }
                                        }
                                      } catch {}
                                    }
                                    if (Date.now() - start < 120000 && doneIds.length < newCardsForItem.length) {
                                      setTimeout(poll, 5000);
                                    } else if (doneIds.length < newCardsForItem.length) {
                                      // Timeout reached but some cards still loading - clear their loading state
                                      console.log('⏱️ Polling timeout reached, clearing loading state for remaining cards');
                                      setHistoryRefreshingIds(prev => prev.filter(id => !newCardsForItem.includes(id)));
                                    }
                                  }
                                } catch {}
                              };
                              setTimeout(poll, 5000);
                            }
                          }
                        }
                      } catch (e) {
                        console.warn('Unable to set visual refreshing indicator:', e);
                      }

                      // Force a re-render by updating a dummy state
                      console.log('🔄 Forcing Dashboard re-render with state update...');
                      setRefreshProgress(0); // This will trigger a re-render
                      
                      // Additional force refresh - trigger multiple state updates to ensure re-render
                      setTimeout(() => {
                        console.log('🔄 Additional state update to ensure re-render...');
                        setRefreshProgress(prev => prev + 1);
                        setLoading(false); // Make sure loading is off
                      }, 100);
                      
                      // Final fallback: If still not showing after 3 seconds, do a page refresh
                      setTimeout(() => {
                        console.log('📊 Final check - are new cards visible?', {
                          creditCardCount: creditCards.length,
                          cardNames: creditCards.map(c => c.name)
                        });
                        
                        // If we still don't see the expected cards, do a page refresh as fallback
                        const currentCardCount = creditCards.length;
                        if (currentCardCount === 0) {
                          console.log('⚠️ No cards visible after 3 seconds - doing page refresh as fallback');
                          window.location.reload();
                        } else {
                          console.log('✅ Cards are visible - no page refresh needed');
                        }
                      }, 3000);
                      
                      // Clear the recent addition flag after a delay (background sync is handled by fetchUserDataForNewCard)
                      setTimeout(() => {
                        setRecentCardAddition(false);
                      }, 5000);
                      
                    } catch (error) {
                      console.error('❌ Failed to refresh Dashboard data:', error);
                      // Fallback to page refresh if direct refresh fails
                      window.location.reload();
                    }
                  }} />
                  
                  {/* Account Settings Button */}
                  <button
                    onClick={() => setShowAccountSettings(true)}
                    className="relative overflow-hidden font-medium py-3 px-4 rounded-2xl transition-all duration-200 flex items-center justify-center space-x-2 text-sm whitespace-nowrap transform focus:outline-none focus:ring-2 group border bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300 hover:shadow-md hover:scale-[1.02] focus:ring-gray-500/50 shadow-sm"
                    title="Account Settings"
                  >
                    <Settings className="h-4 w-4 transition-transform duration-200 group-hover:rotate-45" />
                    <span className="hidden sm:inline font-medium">Settings</span>
                    
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                  </button>
                </>
              ) : (
                <div className="text-center py-2">
                  <p className="text-gray-600 text-xs">Sign in to connect cards</p>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Header Metrics - utilizing more horizontal space */}
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <TrendingUp className="h-7 w-7 text-green-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">This Month's Spend</p>
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalSpendThisMonth)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <DollarSign className="h-7 w-7 text-blue-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Total Balance</p>
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(totalBalance)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <CreditCard className="h-7 w-7 text-purple-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active Cards</p>
                <p className="text-xl font-semibold text-gray-900">{displayCards.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="flex items-center">
              <Calendar className="h-7 w-7 text-orange-600 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Utilization</p>
                <p className="text-xl font-semibold text-gray-900">{averageUtilization.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Instruction text aligned with header metrics */}
        <div className="mb-4">
          <p className="text-gray-600 text-base">Swipe horizontally to see all your cards • Expand to view billing cycles</p>
        </div>
        </div>

        {!isLoggedIn && (
          <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 text-sm">
              <strong>Demo Mode:</strong> This is sample data. Sign in to connect your real credit cards.
            </p>
          </div>
        )}

        {/* Always show content immediately - no more blocking loading states */}

        {/* Revolutionary Horizontal Card Layout */}
        <div className="mb-6">
          
          {initialLoading ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-8 text-center">
              <div className="w-full h-2 bg-gray-200 rounded overflow-hidden mb-4">
                <div className="h-full w-1/3 bg-gradient-to-r from-gray-300 to-gray-400 animate-pulse"></div>
              </div>
              <p className="text-gray-600">Loading your dashboard...</p>
            </div>
          ) : loading ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-12 text-center">
              <div className="flex items-center justify-center mb-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <p className="text-gray-600">Loading your credit cards...</p>
            </div>
          ) : displayCards.length > 0 ? (
            <div className="relative -mx-7">
              <HorizontalCardColumns
                cards={displayCards}
                cycles={displayCycles}
                connectionHealth={connectionHealth}
                onSync={handleCardSync}
                onReconnect={handleCardReconnect}
                onRemove={handleCardRemove}
                onRequestDelete={handleRequestDelete}
                onCreditLimitUpdated={handleCreditLimitUpdated}
                initialCardOrder={getEffectiveOrder(sharedCardOrder, displayCards)}
                onOrderChange={async (order) => {
                  setSharedCardOrder(order);
                  try {
                    localStorage.setItem('cached_card_order', JSON.stringify(order));
                    // Mark all cards we know about as positioned so they won't be treated as new again
                    const next = new Set(positionedCardIds);
                    order.forEach(id => next.add(id));
                    setPositionedCardIds(next);
                    localStorage.setItem('positioned_card_ids', JSON.stringify(Array.from(next)));
                    // User reordered: clear pinned-new set
                    setPinnedNewCardIds(new Set());
                    localStorage.removeItem('pinned_new_card_ids');
                    // Persist immediately to DB with small retry/backoff to avoid race with later fetches
                    const saveWithRetry = async (payload: string[], attempts = 3) => {
                      let delay = 200;
                      for (let i = 1; i <= attempts; i++) {
                        try {
                          const res = await fetch('/api/user/credit-cards/order', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order: payload })
                          });
                          if (!res.ok) {
                            const txt = await res.text();
                            console.error(`Order save attempt ${i} failed:`, res.status, txt);
                            if (i === attempts) throw new Error(`Save failed: ${res.status}`);
                          } else {
                            console.log(`💾 Order saved (attempt ${i})`);
                            return;
                          }
                        } catch (err) {
                          console.error(`Order save attempt ${i} error:`, err);
                          if (i === attempts) throw err;
                        }
                        await new Promise(r => setTimeout(r, delay));
                        delay *= 3; // 200 -> 600 -> 1800ms
                      }
                    };
                    await saveWithRetry(order);
                    // Optional: quick validation log to confirm what's in DB now
                    if (process.env.NODE_ENV !== 'production') {
                      try {
                        const check = await fetch('/api/user/credit-cards/order/validate');
                        if (check.ok) {
                          const data = await check.json();
                          console.log('✅ DB order validation:', data);
                        } else {
                          console.warn('Order validation failed with status:', check.status);
                        }
                      } catch (e) {
                        console.warn('Order validation request failed:', e);
                      }
                    }
                    localStorage.setItem('card_order_user_set', '1');
                    setHasUserOrdered(true);
                  } catch {}
                }}
                visualRefreshingIds={visualRefreshingIds}
                olderCyclesLoadingIds={historyRefreshingIds}
                fullCyclesLoading={fullCyclesLoading}
              />
            </div>
          ) : isLoggedIn ? (
            <div className="bg-white/50 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg p-12 text-center">
              <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 text-lg">No credit cards connected yet</p>
              <p className="text-gray-500 text-sm mt-2">Connect your first card to get started with tracking</p>
            </div>
          ) : null}
        </div>
      </div>
      
      {/* Full-page loading overlay during refresh */}
      <LoadingOverlay 
        isVisible={refreshing}
        message="Refreshing Your Data"
        subMessage="Syncing credit cards and transactions..."
      />
      
      {/* Plaid Update Flow */}
      {updateFlow && (
        <PlaidUpdateLink
          linkToken={updateFlow.linkToken}
          institutionName={updateFlow.institutionName}
          itemId={updateFlow.itemId}
          onSuccess={() => {
            console.log(`🎉 Successfully updated ${updateFlow.institutionName} connection`);
            setUpdateFlow(null);
            // Refresh data after successful update
            handleRefresh();
          }}
          onExit={() => {
            console.log(`🚪 Exited ${updateFlow.institutionName} update flow`);
            setUpdateFlow(null);
          }}
        />
      )}

      {/* Credit Limit Success Popup - Overlays entire Dashboard */}
      {showSuccessPopup && successPopupData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setShowSuccessPopup(false)}
          />
          
          {/* Popup */}
          <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-sm w-full mx-4 transform transition-all duration-200 scale-100">
            {/* Success Icon and Header */}
            <div className="text-center mb-4">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-3">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-1">Credit Limit Updated!</h3>
              <p className="text-sm text-gray-600">{successPopupData.cardName}</p>
            </div>
            
            {/* Main Info */}
            <div className="bg-green-50 rounded-xl p-4 mb-4 border border-green-100">
              <div className="text-center">
                <p className="text-sm text-green-700 font-medium mb-1">New Credit Limit</p>
                <p className="text-2xl font-bold text-green-800">{formatCurrency(successPopupData.newLimit)}</p>
                <p className="text-sm text-green-600 mt-1">
                  Utilization: {formatPercentage(successPopupData.newUtilization)}
                </p>
              </div>
            </div>
            
            {/* Previous Info */}
            {(successPopupData.previousLimit || successPopupData.plaidLimit) && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                {successPopupData.previousLimit && (
                  <p>Previous manual limit: {formatCurrency(successPopupData.previousLimit)}</p>
                )}
                {successPopupData.plaidLimit && (
                  <p>Plaid detected limit: {formatCurrency(successPopupData.plaidLimit)}</p>
                )}
                {!successPopupData.previousLimit && (
                  <p>First time setting manual limit</p>
                )}
              </div>
            )}
            
            {/* OK Button */}
            <button
              onClick={() => setShowSuccessPopup(false)}
              className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              OK
            </button>
          </div>
        </div>
      )}
      
      {/* Page-level Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        title="Remove Credit Card Connection?"
        message={(() => {
          if (!cardToDelete) return '';
          
          const cardsToDelete = getCardsToBeDeleted(cardToDelete);
          const bankName = cardToDelete.plaidItem?.institutionName || 'bank';
          
          if (cardsToDelete.length > 1) {
            const cardNames = cardsToDelete.map(c => c.name).join(', ');
            return `This will remove your entire ${bankName} connection and delete ALL ${cardsToDelete.length} cards: ${cardNames}. All transaction history will be permanently deleted and cannot be undone.`;
          } else {
            return `Are you sure you want to remove ${cardToDelete.name}? This will permanently delete all associated transaction history and cannot be undone.`;
          }
        })()}
        confirmText={(() => {
          if (!cardToDelete) return 'Yes, Remove';
          
          const cardsToDelete = getCardsToBeDeleted(cardToDelete);
          return cardsToDelete.length > 1 
            ? `Yes, Remove All ${cardsToDelete.length} Cards` 
            : 'Yes, Remove Card';
        })()}
        secondConfirmText={(() => {
          if (!cardToDelete) return undefined;
          const cardsToDelete = getCardsToBeDeleted(cardToDelete);
          return cardsToDelete.length > 1 ? 'Delete Only This Card' : undefined;
        })()}
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onSecondConfirm={handleConfirmDeleteSingle}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setCardToDelete(null);
        }}
        type="danger"
      />
      
      {/* Page-level Deletion Progress Dialog */}
      <DeletionProgressDialog
        isOpen={isDeleting}
        cardName={cardToDelete?.name || ''}
        step={deletionStep}
        progress={deletionProgress}
      />
      
      {/* Page-level Deletion Success Notification */}
      <SuccessNotification
        isOpen={showDeletionSuccess}
        message={(() => {
          if (!cardToDelete) return 'Card has been successfully removed';
          
          const cardsToDelete = getCardsToBeDeleted(cardToDelete);
          const bankName = cardToDelete.plaidItem?.institutionName || 'bank';
          
          if (cardsToDelete.length > 1) {
            return `All ${cardsToDelete.length} cards from ${bankName} have been successfully removed`;
          } else {
            return `${cardToDelete.name} has been successfully removed`;
          }
        })()}
        duration={3000}
        onClose={() => setShowDeletionSuccess(false)}
      />

      {/* Account Settings Modal */}
      <AccountSettings
        isOpen={showAccountSettings}
        onClose={() => setShowAccountSettings(false)}
        userEmail={userEmail}
      />
    </div>
  );
}
