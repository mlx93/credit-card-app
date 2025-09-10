'use client';

import { useState } from 'react';
import { X, CreditCard, TrendingUp } from 'lucide-react';

interface InstitutionSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectType: (type: 'standard' | 'investment') => void;
}

export function InstitutionSelectModal({ isOpen, onClose, onSelectType }: InstitutionSelectModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Select Institution Type</h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          <p className="text-gray-600 mb-6">
            Choose the type of institution you want to connect:
          </p>
          
          <div className="space-y-4">
            {/* Standard Credit Cards - Main prominent option */}
            <button
              onClick={() => onSelectType('standard')}
              className="group relative w-full p-8 bg-gradient-to-br from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 rounded-xl border-2 border-transparent hover:border-indigo-300 transition-all duration-200 text-left shadow-sm hover:shadow-md"
            >
              <div className="flex items-start space-x-6">
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                    <CreditCard className="w-8 h-8 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    Credit Cards & Banks
                  </h3>
                  <p className="text-base text-gray-600 mb-4">
                    Connect traditional credit cards from banks like Chase, Capital One, Citi, Wells Fargo, and more. Most popular option with automatic billing cycle detection.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm px-3 py-1.5 bg-white/80 rounded-md text-gray-700 font-medium">Chase</span>
                    <span className="text-sm px-3 py-1.5 bg-white/80 rounded-md text-gray-700 font-medium">Capital One</span>
                    <span className="text-sm px-3 py-1.5 bg-white/80 rounded-md text-gray-700 font-medium">Amex</span>
                    <span className="text-sm px-3 py-1.5 bg-white/80 rounded-md text-gray-700 font-medium">Citi</span>
                    <span className="text-xs px-2 py-1 bg-indigo-100 rounded-md text-indigo-700 font-medium">+ Many More</span>
                  </div>
                </div>
              </div>
            </button>

            {/* Investment Platforms - Smaller secondary option */}
            <button
              onClick={() => onSelectType('investment')}
              className="group relative w-full p-4 bg-gradient-to-br from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 rounded-lg border border-gray-200 hover:border-emerald-300 transition-all duration-200 text-left"
            >
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">
                    Credit Cards from Investment Platforms
                  </h3>
                  <p className="text-xs text-gray-600 mb-2">
                    For specialized platforms like Robinhood Gold Card that require manual setup
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs px-2 py-0.5 bg-white/70 rounded text-gray-700">Robinhood</span>
                    <span className="text-xs px-2 py-0.5 bg-white/50 rounded text-gray-500">Limited options</span>
                  </div>
                </div>
              </div>
            </button>
          </div>
          
          <p className="mt-6 text-xs text-gray-500 text-center">
            You'll be securely redirected to your institution to authorize the connection
          </p>
        </div>
      </div>
    </div>
  );
}