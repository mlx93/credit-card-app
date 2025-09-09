'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [cycleDayInput, setCycleDayInput] = useState((currentCycleDay || 1).toString());
  const [dueDayInput, setDueDayInput] = useState((currentDueDay || 1).toString());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    
    // Parse and validate cycle day
    const cycleDayNum = parseInt(cycleDayInput.trim());
    if (isNaN(cycleDayNum) || !Number.isInteger(cycleDayNum)) {
      setError('Statement close day must be a valid number');
      return;
    }
    if (cycleDayNum < 1 || cycleDayNum > 31) {
      setError('Statement close day must be between 1 and 31');
      return;
    }
    
    // Parse and validate due day
    const dueDayNum = parseInt(dueDayInput.trim());
    if (isNaN(dueDayNum) || !Number.isInteger(dueDayNum)) {
      setError('Payment due day must be a valid number');
      return;
    }
    if (dueDayNum < 1 || dueDayNum > 31) {
      setError('Payment due day must be between 1 and 31');
      return;
    }
    
    // Validate that due date is after statement close (accounting for month wrap)
    const daysBetween = dueDayNum > cycleDayNum ? dueDayNum - cycleDayNum : (31 - cycleDayNum + dueDayNum);
    if (daysBetween < 15 || daysBetween > 28) {
      setError('Payment due date should be 15-28 days after statement close');
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(cycleDayNum, dueDayNum);
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
      <div className="flex items-center gap-2 mt-1">
        {needsConfiguration ? (
          <>
            <div className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs font-medium whitespace-nowrap">Setup billing dates</span>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              title="Set billing cycle dates"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </>
        ) : (
          <>
            <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
              Close: Day {currentCycleDay} • Due: Day {currentDueDay}
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

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4 sm:p-6">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 sm:p-8 w-full max-w-md sm:max-w-lg h-auto max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-6 sm:mb-8">
          <div>
            <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Set Billing Cycle Dates</h3>
            <p className="text-lg text-gray-600 dark:text-gray-400 mt-2">{cardName}</p>
          </div>
          <button
            onClick={() => setIsEditing(false)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {isRobinhood && (
          <div className="mb-6 sm:mb-8 p-4 sm:p-6 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
            <p className="text-blue-700 dark:text-blue-300 text-base sm:text-lg">
              Robinhood doesn't provide statement dates through their API. 
              Please check your Robinhood app or recent statements to find these dates.
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-lg font-semibold mb-3 text-gray-900 dark:text-white">
              Statement Close Day
            </label>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="text"
                inputMode="numeric"
                value={cycleDayInput}
                onChange={(e) => setCycleDayInput(e.target.value)}
                className="w-20 px-3 py-2 text-lg text-center border border-gray-300 dark:border-gray-700 rounded-lg 
                         bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                         transition-all duration-200"
                placeholder="15"
              />
              <span className="text-gray-600 dark:text-gray-400">day of the month (1-31)</span>
            </div>
            <p className="text-sm text-gray-500">
              The day your statement period ends each month
            </p>
          </div>

          <div>
            <label className="block text-lg font-semibold mb-3 text-gray-900 dark:text-white">
              Payment Due Day
            </label>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="text"
                inputMode="numeric"
                value={dueDayInput}
                onChange={(e) => setDueDayInput(e.target.value)}
                className="w-20 px-3 py-2 text-lg text-center border border-gray-300 dark:border-gray-700 rounded-lg 
                         bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                         transition-all duration-200"
                placeholder="10"
              />
              <span className="text-gray-600 dark:text-gray-400">day of the month (1-31)</span>
            </div>
            <p className="text-sm text-gray-500">
              The day your payment is due each month
            </p>
          </div>

        </div>

        {error && (
          <div className="mt-6 p-4 sm:p-6 bg-red-50 dark:bg-red-900/20 rounded-xl">
            <p className="text-red-600 dark:text-red-400 text-base sm:text-lg font-medium">
              {error}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mt-8 justify-center">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-base font-semibold
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                     flex items-center justify-center gap-2 min-w-fit"
          >
            {isSaving ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Save Billing Dates
              </>
            )}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            disabled={isSaving}
            className="px-6 py-3 border-2 border-gray-300 dark:border-gray-700 rounded-lg text-base font-semibold
                     hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors
                     disabled:opacity-50 min-w-fit"
          >
            Cancel
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed">
            <strong className="text-gray-900 dark:text-white">Tip:</strong> Your statement close date is usually the same day each month when your 
            billing period ends. The payment due date is typically 21-25 days after the statement close.
          </p>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' 
    ? createPortal(modal, document.body)
    : null;
}