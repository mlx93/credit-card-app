'use client';

import { useState } from 'react';
import { Pencil, X, Check, AlertCircle } from 'lucide-react';

interface CycleDateEditorProps {
  cardId: string;
  cardName: string;
  currentCycleDay?: number | null;
  currentDueDay?: number | null;
  onSave: (cycleDay: number, dueDay: number) => Promise<void>;
  isRobinhood?: boolean;
}

export default function CycleDateEditor({
  cardId,
  cardName,
  currentCycleDay,
  currentDueDay,
  onSave,
  isRobinhood = false
}: CycleDateEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [cycleDay, setCycleDay] = useState(currentCycleDay || 1);
  const [dueDay, setDueDay] = useState(currentDueDay || 1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    
    // Validate days
    if (cycleDay < 1 || cycleDay > 31) {
      setError('Statement close day must be between 1 and 31');
      return;
    }
    
    if (dueDay < 1 || dueDay > 31) {
      setError('Payment due day must be between 1 and 31');
      return;
    }
    
    // Validate that due date is after statement close (accounting for month wrap)
    const daysBetween = dueDay > cycleDay ? dueDay - cycleDay : (31 - cycleDay + dueDay);
    if (daysBetween < 15 || daysBetween > 28) {
      setError('Payment due date should be 15-28 days after statement close');
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(cycleDay, dueDay);
      setIsEditing(false);
    } catch (err) {
      setError('Failed to save dates. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const needsConfiguration = !currentCycleDay || !currentDueDay;

  if (!isEditing) {
    return (
      <div className="flex items-center gap-2">
        {needsConfiguration ? (
          <>
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">Billing dates needed</span>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              title="Set billing cycle dates"
            >
              <Pencil className="w-4 h-4 text-gray-500" />
            </button>
          </>
        ) : (
          <>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Statement closes: Day {currentCycleDay} • Due: Day {currentDueDay}
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors opacity-50 hover:opacity-100"
              title="Edit billing cycle dates"
            >
              <Pencil className="w-3 h-3 text-gray-400" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold">Set Billing Cycle Dates</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{cardName}</p>
          </div>
          <button
            onClick={() => setIsEditing(false)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isRobinhood && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
            <p className="text-blue-700 dark:text-blue-300">
              Robinhood doesn't provide statement dates through their API. 
              Please check your Robinhood app or recent statements to find these dates.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Statement Close Day
              <span className="text-gray-500 font-normal ml-2">(Day of month: 1-31)</span>
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={cycleDay}
              onChange={(e) => setCycleDay(parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg 
                       bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 15"
            />
            <p className="text-xs text-gray-500 mt-1">
              The day your statement period ends each month
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Payment Due Day
              <span className="text-gray-500 font-normal ml-2">(Day of month: 1-31)</span>
            </label>
            <input
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={(e) => setDueDay(parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg 
                       bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., 10"
            />
            <p className="text-xs text-gray-500 mt-1">
              The day your payment is due each month
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Dates
                </>
              )}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg 
                       hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors
                       disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500">
            <strong>Tip:</strong> Your statement close date is usually the same day each month when your 
            billing period ends. The payment due date is typically 21-25 days after the statement close.
          </p>
        </div>
      </div>
    </div>
  );
}