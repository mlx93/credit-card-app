'use client';

import { useState, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { CreditCard } from 'lucide-react';

export default function EmailSignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(180); // 3 minutes in seconds
  const [isSuccess, setIsSuccess] = useState(false);
  const [stepTransition, setStepTransition] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Timer for code expiration
  useEffect(() => {
    if (step === 'code' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step, timeLeft]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        // Debug: Check if we got a debug code (development only)
        if (data.debugCode) {
          console.log('Debug code:', data.debugCode);
          setMessage(`Debug mode: Your code is ${data.debugCode}`);
        }
        
        // Log debug info if available
        if (data.debug) {
          console.log('Debug info:', data.debug);
        }
        
        setStepTransition(true);
        setTimeout(() => {
          setStep('code');
          setTimeLeft(180); // Reset timer
          if (!data.debugCode) {
            setMessage('Check your email for a 6-digit verification code');
          }
          setStepTransition(false);
          // Auto-focus first input
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        }, 300);
      } else {
        setError(data.error || 'Failed to send verification code');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn('email-code', {
        email,
        code: code.join(''),
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid or expired verification code');
        // Shake animation for error
        setCode(['', '', '', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      } else if (result?.ok) {
        // Success animation
        setIsSuccess(true);
        setMessage('Authentication successful!');
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 1500);
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-100/30 via-transparent to-transparent"></div>
      <div className="absolute top-0 -left-4 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
      <div className="absolute bottom-0 -right-4 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
      
      <div className="relative w-full max-w-md">
        <div className={`backdrop-blur-xl bg-white/80 border border-white/60 rounded-3xl p-6 shadow-2xl transition-all duration-300 ${
          stepTransition ? 'scale-95 opacity-50' : 'scale-100 opacity-100'
        }`}>
          {/* Header */}
          <div className="text-center mb-6">
            <div className={`w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg transition-all duration-500 ${
              isSuccess ? 'bg-gradient-to-r from-green-500 to-emerald-500 scale-110' : ''
            }`}>
              {isSuccess ? (
                <span className="text-2xl animate-bounce">✓</span>
              ) : step === 'email' ? (
                <span className="text-2xl">📧</span>
              ) : (
                <CreditCard className="h-8 w-8 text-white" />
              )}
            </div>
            <h1 className="text-2xl font-semibold text-slate-800 mb-2">
              {step === 'email' ? 'Sign in with Email' : 'Enter Verification Code'}
            </h1>
            <p className="text-slate-600 text-sm">
              {isSuccess ? (
                <span className="text-green-400 font-medium">Welcome to CardCycle! 🎉</span>
              ) : step === 'email' ? (
                "We'll send you a secure 6-digit code"
              ) : (
                `Code sent to ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
              )}
            </p>
          </div>

          {/* Email Form */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-6">
              <div className="space-y-1">
                <label htmlFor="email" className="text-slate-700 text-sm font-medium">
                  Email Address
                </label>
                <div className="relative group">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full px-4 py-3 bg-white/70 border border-slate-200 rounded-2xl text-slate-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all duration-200 hover:bg-white/90 hover:border-slate-300"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500/0 to-purple-500/0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 transition-all duration-200 pointer-events-none"></div>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-pulse">
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-red-400 text-lg">⚠️</span>
                    <p className="text-red-400 text-sm font-medium">{error}</p>
                  </div>
                  {error.includes('Invalid or expired') && (
                    <p className="text-red-300 text-xs text-center mt-1">
                      Please request a new code or check your email
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium rounded-2xl shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 group"
              >
                <span className="flex items-center justify-center space-x-2">
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Verification Code</span>
                      <span className="group-hover:translate-x-1 transition-transform duration-200">→</span>
                    </>
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => window.location.href = '/'}
                className="w-full py-2 text-slate-600 hover:text-slate-800 font-medium rounded-xl hover:bg-slate-100/50 transition-all duration-200"
              >
                ← Back to main sign-in
              </button>
            </form>
          )}

          {/* Code Verification Form */}
          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="space-y-6">
              {/* Timer */}
              <div className="text-center">
                <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${
                  timeLeft > 60 
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                    : timeLeft > 30
                    ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
                  <span>Expires in {formatTime(timeLeft)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-slate-700 text-sm font-medium text-center block">
                  Verification Code
                </label>
                <div className={`flex justify-center space-x-3 ${error ? 'animate-pulse' : ''}`}>
                  {code.map((digit, index) => (
                    <div key={index} className="relative group">
                      <input
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="text"
                        maxLength={1}
                        className={`w-12 h-14 bg-white/70 border-2 rounded-xl text-slate-800 text-center text-xl font-mono focus:outline-none transition-all duration-200 ${
                          digit ? 'border-indigo-400/60 bg-indigo-50/80' : 'border-slate-200'
                        } focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30 hover:bg-white/90 hover:border-slate-300`}
                        aria-label={`Digit ${index + 1} of 6`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={digit}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '');
                          if (value.length <= 1) {
                            const newCode = [...code];
                            newCode[index] = value;
                            setCode(newCode);
                            setError(''); // Clear error on input
                            
                            // Auto-focus next input
                            if (value && index < 5) {
                              inputRefs.current[index + 1]?.focus();
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          // Handle backspace
                          if (e.key === 'Backspace' && !code[index] && index > 0) {
                            inputRefs.current[index - 1]?.focus();
                          }
                          // Handle paste
                          if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            navigator.clipboard.readText().then((text) => {
                              const pastedCode = text.replace(/\D/g, '').slice(0, 6).split('');
                              const newCode = [...pastedCode, ...new Array(6 - pastedCode.length).fill('')];
                              setCode(newCode);
                              const lastFilledIndex = pastedCode.length - 1;
                              if (lastFilledIndex >= 0 && lastFilledIndex < 5) {
                                inputRefs.current[lastFilledIndex + 1]?.focus();
                              }
                            });
                          }
                        }}
                        onFocus={(e) => e.target.select()}
                      />
                      <div className={`absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/0 to-purple-500/0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 transition-all duration-200 pointer-events-none ${
                        digit ? 'from-indigo-500/5 to-purple-500/5' : ''
                      }`}></div>
                    </div>
                  ))}
                </div>
                <p className="text-slate-600 text-xs text-center">
                  Enter the 6-digit code from your email
                </p>
              </div>

              {message && (
                <div className={`border rounded-xl p-3 transition-all duration-300 ${
                  isSuccess 
                    ? 'bg-green-500/10 border-green-500/20 scale-105' 
                    : 'bg-blue-500/10 border-blue-500/20'
                }`}>
                  <div className="flex items-center justify-center space-x-2">
                    <span className={`text-lg ${isSuccess ? 'text-green-400' : 'text-blue-400'}`}>
                      {isSuccess ? '🎉' : '📧'}
                    </span>
                    <p className={`text-sm font-medium ${isSuccess ? 'text-green-400' : 'text-blue-400'}`}>
                      {message}
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 animate-pulse">
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-red-400 text-lg">⚠️</span>
                    <p className="text-red-400 text-sm font-medium">{error}</p>
                  </div>
                  {error.includes('Invalid or expired') && (
                    <p className="text-red-300 text-xs text-center mt-1">
                      Please request a new code or check your email
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || code.join('').length !== 6 || timeLeft <= 0 || isSuccess}
                className={`w-full py-3 font-medium rounded-2xl shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed transform transition-all duration-200 group ${
                  isSuccess 
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-green-500/25' 
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 hover:scale-[1.02] disabled:opacity-50'
                }`}
              >
                <span className="flex items-center justify-center space-x-2">
                  {isSuccess ? (
                    <>
                      <div className="w-4 h-4 text-white animate-bounce">✓</div>
                      <span>Success!</span>
                    </>
                  ) : loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify Code</span>
                      <span className="group-hover:translate-x-1 transition-transform duration-200">✓</span>
                    </>
                  )}
                </span>
              </button>

              {/* Action buttons */}
              <div className="flex flex-col space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    await handleSendCode({ preventDefault: () => {} } as React.FormEvent);
                  }}
                  disabled={loading || isSuccess}
                  className="py-2 text-slate-600 hover:text-slate-800 font-medium rounded-xl hover:bg-slate-100/50 transition-all duration-200 disabled:opacity-50 group"
                >
                  <span className="flex items-center justify-center space-x-2">
                    <span>📧</span>
                    <span>Resend Code</span>
                    <span className="opacity-60 group-hover:opacity-100 transition-opacity">{timeLeft < 120 ? '' : '(Available soon)'}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setCode(['', '', '', '', '', '']);
                    setError('');
                    setMessage('');
                    setTimeLeft(180);
                    setIsSuccess(false);
                  }}
                  disabled={isSuccess}
                  className="py-2 text-slate-500 hover:text-slate-700 text-sm rounded-xl hover:bg-slate-100/50 transition-all duration-200 disabled:opacity-50"
                >
                  ← Use Different Email
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}