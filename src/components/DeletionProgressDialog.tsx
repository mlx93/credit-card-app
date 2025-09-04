'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

interface DeletionProgressDialogProps {
  isOpen: boolean;
  cardName: string;
  step: string;
  progress: number;
}

export function DeletionProgressDialog({
  isOpen,
  cardName,
  step,
  progress
}: DeletionProgressDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />
      
      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-sm w-full mx-4 transform transition-all duration-200 scale-100">
        {/* Loading Icon and Header */}
        <div className="text-center mb-4">
          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
            <Loader2 className="h-8 w-8 text-gray-600 animate-spin" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-1">Removing Card</h3>
          <p className="text-sm text-gray-600">{cardName}</p>
        </div>
        
        {/* Progress Info */}
        <div className="mb-4">
          <p className="text-sm text-gray-600 text-center mb-3">{step}</p>
          
          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        <p className="text-xs text-gray-500 text-center">Please wait...</p>
      </div>
    </div>
  );
}