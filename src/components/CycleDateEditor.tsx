'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X, Check, AlertCircle } from 'lucide-react';

interface CycleDateEditorProps {
  cardId: string;
  cardName: string;
  currentCycleDay?: number | null;
  currentDueDay?: number | null;
  currentCycleDateType?: 'same_day' | 'days_before_end' | 'dynamic_anchor' | null;
  currentCycleDaysBeforeEnd?: number | null;
  currentDueDateType?: 'same_day' | 'days_before_end' | 'dynamic_anchor' | null;
  currentDueDaysBeforeEnd?: number | null;
  onSave: (data: {
    cycleDay?: number;
    dueDay?: number;
    cycleDateType: 'same_day' | 'days_before_end' | 'dynamic_anchor';
    cycleDaysBeforeEnd?: number;
    dueDateType: 'same_day' | 'days_before_end' | 'dynamic_anchor';
    dueDaysBeforeEnd?: number;
  }) => Promise<void>;
  isRobinhood?: boolean;
}

export default function CycleDateEditor({
  cardId,
  cardName,
  currentCycleDay,
  currentDueDay,
  currentCycleDateType,
  currentCycleDaysBeforeEnd,
  currentDueDateType,
  currentDueDaysBeforeEnd,
  onSave,
  isRobinhood = false
}: CycleDateEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  // Independent date types for cycle and due dates
  const [cycleDateType, setCycleDateType] = useState<'same_day' | 'days_before_end' | 'dynamic_anchor'>(
    currentCycleDateType || 'same_day'
  );
  const [dueDateType, setDueDateType] = useState<'same_day' | 'days_before_end' | 'dynamic_anchor'>(
    currentDueDateType || 'same_day'
  );
  const [cycleDayInput, setCycleDayInput] = useState((currentCycleDay || 1).toString());
  const [cycleDaysBeforeEndInput, setCycleDaysBeforeEndInput] = useState(
    (currentCycleDaysBeforeEnd || 3).toString()
  );
  const [dueDayInput, setDueDayInput] = useState((currentDueDay || 1).toString());
  const [dueDaysBeforeEndInput, setDueDaysBeforeEndInput] = useState(
    (currentDueDaysBeforeEnd || 0).toString()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    
    let cycleDayNum: number | undefined;
    let cycleDaysBeforeEndNum: number | undefined;
    let dueDayNum: number | undefined;
    let dueDaysBeforeEndNum: number | undefined;
    
    // Validate cycle date settings
    if (cycleDateType === 'same_day') {
      cycleDayNum = parseInt(cycleDayInput.trim());
      if (isNaN(cycleDayNum) || !Number.isInteger(cycleDayNum)) {
        setError('Statement close day must be a valid number');
        return;
      }
      if (cycleDayNum < 1 || cycleDayNum > 31) {
        setError('Statement close day must be between 1 and 31');
        return;
      }
    } else if (cycleDateType === 'days_before_end') {
      cycleDaysBeforeEndNum = parseInt(cycleDaysBeforeEndInput.trim());
      if (isNaN(cycleDaysBeforeEndNum) || !Number.isInteger(cycleDaysBeforeEndNum)) {
        setError('Days before month end must be a valid number');
        return;
      }
      if (cycleDaysBeforeEndNum < 1 || cycleDaysBeforeEndNum > 31) {
        setError('Days before month end must be between 1 and 31');
        return;
      }
    } else if (cycleDateType === 'dynamic_anchor') {
      // For dynamic anchor, we use the cycleDayInput as the anchor day
      cycleDayNum = parseInt(cycleDayInput.trim());
      if (isNaN(cycleDayNum) || !Number.isInteger(cycleDayNum)) {
        setError('Anchor day must be a valid number');
        return;
      }
      if (cycleDayNum < 1 || cycleDayNum > 31) {
        setError('Anchor day must be between 1 and 31');
        return;
      }
    }
    
    // Validate due date settings
    if (dateType === 'same_day') {
      dueDayNum = parseInt(dueDayInput.trim());
      if (isNaN(dueDayNum) || !Number.isInteger(dueDayNum)) {
        setError('Payment due day must be a valid number');
        return;
      }
      if (dueDayNum < 1 || dueDayNum > 31) {
        setError('Payment due day must be between 1 and 31');
        return;
      }
    } else if (dateType === 'days_before_end') {
      dueDaysBeforeEndNum = parseInt(dueDaysBeforeEndInput.trim());
      if (isNaN(dueDaysBeforeEndNum) || !Number.isInteger(dueDaysBeforeEndNum)) {
        setError('Days before month end must be a valid number');
        return;
      }
      if (dueDaysBeforeEndNum < 1 || dueDaysBeforeEndNum > 31) {
        setError('Days before month end must be between 1 and 31');
        return;
      }
    } else if (dateType === 'dynamic_anchor') {
      // For dynamic anchor, due date is typically 21 days after statement
      dueDayNum = parseInt(dueDayInput.trim());
      if (isNaN(dueDayNum) || !Number.isInteger(dueDayNum)) {
        setError('Due date anchor must be a valid number');
        return;
      }
      if (dueDayNum < 1 || dueDayNum > 31) {
        setError('Due date anchor must be between 1 and 31');
        return;
      }
    }
    
    // Skip complex validation for now - let the billing cycle generation handle edge cases
    
    setIsSaving(true);
    try {
      await onSave({
        cycleDay: cycleDayNum,
        dueDay: dueDayNum,
        cycleDateType: dateType,
        cycleDaysBeforeEnd: cycleDaysBeforeEndNum,
        dueDateType: dateType,
        dueDaysBeforeEnd: dueDaysBeforeEndNum
      });
      setIsEditing(false);
    } catch (err) {
      setError('Failed to save dates. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const needsConfiguration = !currentCycleDay && !currentCycleDaysBeforeEnd || !currentDueDay && !currentDueDaysBeforeEnd;

  if (!isEditing) {
    return (
      <div className="flex items-start gap-2 mt-1">
        {needsConfiguration ? (
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-200 text-xs text-gray-700"
            title="Set billing cycle dates"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-600" />
            <span>Billing</span>
          </button>
        ) : (
          <>
            <div className="text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0">
              {(() => {
                // Format statement close display based on date type
                const closeDisplay = currentCycleDateType === 'days_before_end' && currentCycleDaysBeforeEnd
                  ? `${currentCycleDaysBeforeEnd} days before last day of month`
                  : currentCycleDateType === 'dynamic_anchor'
                  ? `Dynamic anchor day ${currentCycleDay}`
                  : `Day ${currentCycleDay}`;
                
                // Format due date display based on date type
                const dueDisplay = currentDueDateType === 'days_before_end' && currentDueDaysBeforeEnd
                  ? `${currentDueDaysBeforeEnd} days before last day of month`
                  : currentDueDateType === 'dynamic_anchor'
                  ? `Dynamic anchor day ${currentDueDay}`
                  : `Day ${currentDueDay}`;
                
                // Check if text is too long and needs wrapping
                const combinedText = `Close: ${closeDisplay} • Due: ${dueDisplay}`;
                const needsWrap = combinedText.length > 42;
                
                if (needsWrap) {
                  return (
                    <div className="space-y-0.5">
                      <div className="truncate">Close: {closeDisplay}</div>
                      <div className="truncate">Due: {dueDisplay}</div>
                    </div>
                  );
                }
                
                return <div className="truncate">{combinedText}</div>;
              })()}
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors opacity-50 hover:opacity-100 flex-shrink-0"
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

        <div className="space-y-8">
          {/* Date Type Selection - Applies to both statement and due dates */}
          <div>
            <label className="block text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Billing Cycle Type
            </label>
            <div className="mb-4">
              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="same_day"
                    checked={dateType === 'same_day'}
                    onChange={(e) => setDateType(e.target.value as 'same_day' | 'days_before_end' | 'dynamic_anchor')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">Same day each month</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="days_before_end"
                    checked={dateType === 'days_before_end'}
                    onChange={(e) => setDateType(e.target.value as 'same_day' | 'days_before_end' | 'dynamic_anchor')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">X days before month end</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="dynamic_anchor"
                    checked={dateType === 'dynamic_anchor'}
                    onChange={(e) => setDateType(e.target.value as 'same_day' | 'days_before_end' | 'dynamic_anchor')}
                    className="text-blue-600"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm">Dynamic anchor (Amex-style)</span>
                    <span className="text-xs text-gray-500">Cycles balance between 28-31 days using anchor date</span>
                  </div>
                </label>
              </div>
            </div>
            <p className="text-sm text-gray-500">
              {dateType === 'same_day' 
                ? 'Your card uses the same day each month for billing dates'
                : dateType === 'days_before_end' 
                ? 'Your card uses days relative to month end (e.g., Bilt closes 3 days before month end)'
                : 'Your card uses dynamic anchor dates that balance cycle lengths (like Amex)'
              }
            </p>
          </div>

          <div>
            <label className="block text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Statement Close Day
            </label>

            {/* Conditional Input Based on Selection */}
            {dateType === 'same_day' ? (
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
            ) : dateType === 'days_before_end' ? (
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={cycleDaysBeforeEndInput}
                  onChange={(e) => setCycleDaysBeforeEndInput(e.target.value)}
                  className="w-20 px-3 py-2 text-lg text-center border border-gray-300 dark:border-gray-700 rounded-lg 
                           bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                           transition-all duration-200"
                  placeholder="3"
                />
                <span className="text-gray-600 dark:text-gray-400">days before month end (1-31)</span>
              </div>
            ) : (
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={cycleDayInput}
                  onChange={(e) => setCycleDayInput(e.target.value)}
                  className="w-20 px-3 py-2 text-lg text-center border border-gray-300 dark:border-gray-700 rounded-lg 
                           bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                           transition-all duration-200"
                  placeholder="19"
                />
                <span className="text-gray-600 dark:text-gray-400">anchor day (1-31)</span>
              </div>
            )}
            
            <p className="text-sm text-gray-500">
              {dateType === 'same_day' 
                ? 'The day your statement period ends each month'
                : dateType === 'days_before_end' 
                ? 'Number of days before the last day of the month when your statement closes'
                : 'Target day that cycles aim for, but may adjust ±1-3 days to keep cycle length between 28-31 days'
              }
            </p>
          </div>

          <div>
            <label className="block text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Payment Due Day
            </label>

            {/* Conditional Input Based on Selection */}
            {dateType === 'same_day' ? (
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
            ) : dateType === 'days_before_end' ? (
              <div className="flex items-center gap-3 mb-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={dueDaysBeforeEndInput}
                  onChange={(e) => setDueDaysBeforeEndInput(e.target.value)}
                  className="w-20 px-3 py-2 text-lg text-center border border-gray-300 dark:border-gray-700 rounded-lg 
                           bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500
                           transition-all duration-200"
                  placeholder="0"
                />
                <span className="text-gray-600 dark:text-gray-400">days before month end (1-31)</span>
              </div>
            ) : (
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
                <span className="text-gray-600 dark:text-gray-400">anchor day (1-31)</span>
              </div>
            )}
            
            <p className="text-sm text-gray-500">
              {dateType === 'same_day' 
                ? 'The day your payment is due each month'
                : dateType === 'days_before_end' 
                ? 'Number of days before the last day of the month when payment is due'
                : 'Target due day (typically ~21 days after statement close), adjusts with dynamic cycles'
              }
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
