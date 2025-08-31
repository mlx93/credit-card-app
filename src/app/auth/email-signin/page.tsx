'use client';

import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';

export default function EmailSignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(180); // 3 minutes in seconds

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
        setStep('code');
        setTimeLeft(180); // Reset timer
        setMessage('Check your email for a 6-digit verification code');
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
        code,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid or expired verification code');
      } else if (result?.ok) {
        // Successfully signed in
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent"></div>
      <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse"></div>
      <div className="absolute bottom-0 -right-4 w-72 h-72 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-10 animate-pulse delay-1000"></div>
      
      <div className="relative w-full max-w-md">
        <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-8 shadow-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-2xl">📧</span>
            </div>
            <h1 className="text-2xl font-semibold text-white mb-2">
              {step === 'email' ? 'Sign in with Email' : 'Enter Verification Code'}
            </h1>
            <p className="text-slate-300 text-sm">
              {step === 'email' 
                ? "We'll send you a secure 6-digit code" 
                : `Code sent to ${email}`
              }
            </p>
          </div>

          {/* Email Form */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-6">
              <div className="space-y-1">
                <label htmlFor="email" className="text-slate-300 text-sm font-medium">
                  Email Address
                </label>
                <div className="relative group">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="w-full px-4 py-4 bg-white/5 border border-white/10 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all duration-200 hover:bg-white/10 hover:border-white/20"
                    placeholder="Enter your email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500/0 to-purple-500/0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 transition-all duration-200 pointer-events-none"></div>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium rounded-2xl shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 group"
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
                className="w-full py-3 text-slate-300 hover:text-white font-medium rounded-xl hover:bg-white/5 transition-all duration-200"
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

              <div className="space-y-1">
                <label htmlFor="code" className="text-slate-300 text-sm font-medium">
                  Verification Code
                </label>
                <div className="relative group">
                  <input
                    id="code"
                    name="code"
                    type="text"
                    required
                    maxLength={6}
                    className="w-full px-4 py-6 bg-white/5 border border-white/10 rounded-2xl text-white text-center text-3xl font-mono tracking-[0.5em] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all duration-200 hover:bg-white/10 hover:border-white/20"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500/0 to-purple-500/0 group-hover:from-indigo-500/5 group-hover:to-purple-500/5 transition-all duration-200 pointer-events-none"></div>
                </div>
                <p className="text-slate-400 text-xs text-center mt-2">
                  Enter the 6-digit code from your email
                </p>
              </div>

              {message && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                  <p className="text-green-400 text-sm text-center">{message}</p>
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6 || timeLeft <= 0}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-medium rounded-2xl shadow-lg hover:shadow-xl hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] transition-all duration-200 group"
              >
                <span className="flex items-center justify-center space-x-2">
                  {loading ? (
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
                  onClick={() => {
                    setLoading(true);
                    handleSendCode({ preventDefault: () => {} } as any);
                  }}
                  disabled={loading}
                  className="py-3 text-slate-300 hover:text-white font-medium rounded-xl hover:bg-white/5 transition-all duration-200 disabled:opacity-50"
                >
                  📧 Resend Code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError('');
                    setMessage('');
                    setTimeLeft(180);
                  }}
                  className="py-3 text-slate-400 hover:text-slate-300 text-sm rounded-xl hover:bg-white/5 transition-all duration-200"
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