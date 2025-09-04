'use client';

import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface RateLimitNotificationProps {
  isOpen: boolean;
  onClose: () => void;
  duration?: number;
}

export function RateLimitNotification({
  isOpen,
  onClose,
  duration = 5000
}: RateLimitNotificationProps) {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-white rounded-lg shadow-lg border border-orange-200 p-4 flex items-start gap-3 min-w-[320px] max-w-md">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-orange-600" />
          </div>
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-gray-900 mb-1">Card Added Successfully</h4>
          <p className="text-sm text-gray-600">
            Your credit card has been connected! Transaction history may take a few more minutes to sync due to bank limits.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ✕
        </button>
      </div>
    </div>
  );
}