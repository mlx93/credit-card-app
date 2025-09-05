'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  secondConfirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onSecondConfirm?: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  secondConfirmText,
  cancelText = 'Cancel',
  onConfirm,
  onSecondConfirm,
  onCancel,
  type = 'danger'
}: ConfirmationDialogProps) {
  if (!isOpen) return null;

  const typeStyles = {
    danger: {
      icon: 'bg-red-100 text-red-600',
      confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    },
    warning: {
      icon: 'bg-orange-100 text-orange-600',
      confirmButton: 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-500'
    },
    info: {
      icon: 'bg-blue-100 text-blue-600',
      confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
    }
  };

  const style = typeStyles[type];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      
      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 max-w-md w-full mx-4 transform transition-all duration-200 scale-100" style={{ position: 'relative', zIndex: 1 }}>
        {/* Icon and Header */}
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-3 rounded-full ${style.icon}`}>
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-600 mt-2">{message}</p>
          </div>
        </div>
        
        {/* Actions */}
        <div className={`grid gap-3 mt-6 ${secondConfirmText ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <button
            onClick={onCancel}
            className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
          >
            {cancelText}
          </button>
          {secondConfirmText && onSecondConfirm && (
            <button
              onClick={onSecondConfirm}
              className="py-3 px-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 font-medium rounded-xl transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
            >
              {secondConfirmText}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`py-3 px-4 text-white font-medium rounded-xl transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${style.confirmButton}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
