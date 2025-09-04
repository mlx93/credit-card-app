'use client';

import React, { useEffect } from 'react';
import { CheckCircle } from 'lucide-react';

interface SuccessNotificationProps {
  isOpen: boolean;
  message: string;
  duration?: number;
  onClose: () => void;
}

export function SuccessNotification({
  isOpen,
  message,
  duration = 3000,
  onClose
}: SuccessNotificationProps) {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-white rounded-lg shadow-lg border border-green-200 p-4 flex items-center gap-3 min-w-[300px] max-w-md">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">{message}</p>
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