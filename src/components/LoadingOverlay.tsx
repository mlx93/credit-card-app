'use client';

import { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
  subMessage?: string;
}

export function LoadingOverlay({ isVisible, message = "Connecting to your bank", subMessage = "This may take a few moments..." }: LoadingOverlayProps) {
  const [dots, setDots] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsAnimating(true);
    } else {
      const timeout = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isAnimating) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ${
      isVisible ? 'opacity-100' : 'opacity-0'
    }`}>
      {/* Backdrop with blur effect */}
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-md transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`} />
      
      {/* Content */}
      <div className={`relative z-10 flex flex-col items-center justify-center px-4 transition-all duration-300 transform ${
        isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
      }`}>
        {/* Card stack animation */}
        <div className="relative mb-8">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-20 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl shadow-2xl transform rotate-12 animate-pulse" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-20 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl shadow-2xl transform -rotate-6 animate-pulse animation-delay-200" />
          </div>
          <div className="relative flex items-center justify-center">
            <div className="h-32 w-20 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl shadow-2xl animate-pulse animation-delay-400 flex items-center justify-center">
              <CreditCard className="h-10 w-10 text-white/80" />
            </div>
          </div>
        </div>

        {/* Loading spinner ring */}
        <div className="relative mb-6">
          <div className="h-16 w-16">
            <svg className="animate-spin" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="url(#gradient)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="180"
                strokeDashoffset="60"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#818CF8" />
                  <stop offset="50%" stopColor="#C084FC" />
                  <stop offset="100%" stopColor="#FB7185" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Text content */}
        <div className="text-center max-w-sm">
          <h2 className="text-2xl font-bold text-white mb-2">
            {message}{dots}
          </h2>
          <p className="text-white/70 text-sm">
            {subMessage}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex space-x-2 mt-8">
          <div className="h-2 w-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="h-2 w-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="h-2 w-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(0.95);
          }
        }

        .animation-delay-200 {
          animation-delay: 200ms;
        }

        .animation-delay-400 {
          animation-delay: 400ms;
        }

        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
      `}</style>
    </div>
  );
}