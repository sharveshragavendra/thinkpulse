import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AmbientCanvas } from '../common/AmbientCanvas.tsx';
import { BrandMark } from '../common/BrandMark.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';

type CardView = 'google' | 'email' | 'forgot';

interface BootstrapStatus {
  needsAdminBootstrap: boolean;
  institutionName: string;
  allowStudentSelfRegistration: boolean;
}

export function LoginPage() {
  const { loginWithGoogle, loginWithEmail, loading } = useAuth();
  const [view, setView] = useState<CardView>('google');
  const [statusInfo, setStatusInfo] = useState<BootstrapStatus | null>(null);

  // Institutional email/password fallback (for host-provisioned accounts without Google)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Password recovery
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetStage, setResetStage] = useState<'request' | 'confirm'>('request');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest<BootstrapStatus>('/auth/bootstrap-status')
      .then((res) => {
        if (active) setStatusInfo(res);
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      active = false;
    };
  }, []);

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const handleGoogleSignIn = async () => {
    clearFeedback();
    try {
      await loginWithGoogle();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      const rawMessage = err instanceof Error ? err.message : '';
      if (code === 'auth/unauthorized-domain' || rawMessage.includes('auth/unauthorized-domain')) {
        setError(
          `This domain (${window.location.hostname}) is not authorized for Google Sign-In. Add it in Firebase Console → Authentication → Settings → Authorized domains.`
        );
      } else if (code === 'auth/popup-blocked') {
        setError('Sign-in popup was blocked by your browser. Please allow popups and try again.');
      } else if (code === 'auth/popup-closed-by-user') {
        setError('Google sign-in window was closed before completing sign-in.');
      } else {
        setError(rawMessage || 'Google sign-in could not be completed.');
      }
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!email.trim() || !password) {
      setError('Please enter both your email address and password.');
      return;
    }
    try {
      await loginWithEmail(email.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      if (resetStage === 'request') {
        const res = await apiRequest<{ message: string; devResetToken?: string }>(
          '/auth/forgot-password',
          {
            method: 'POST',
            body: { email: resetEmail.trim() },
          }
        );
        setNotice(res.message);
        if (res.devResetToken) {
          setResetToken(res.devResetToken);
        }
        setResetStage('confirm');
      } else {
        const res = await apiRequest<{ message: string }>('/auth/reset-password', {
          method: 'POST',
          body: { email: resetEmail.trim(), token: resetToken.trim(), newPassword },
        });
        setNotice(res.message);
        setView('email');
        setResetStage('request');
        setNewPassword('');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Password recovery failed.');
    } finally {
      setBusy(false);
    }
  };

  const isWorking = loading || busy;

  return (
    <div className="min-h-screen tp-ambient-bg relative flex items-center justify-center p-4 sm:p-8 overflow-hidden">
      <AmbientCanvas />

      {/* Floating Theme Switch */}
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-30">
        <ThemeToggle />
      </div>

      <motion.main
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[432px] relative z-10"
      >
        <div className="tp-liquid-card rounded-[42px] px-7 py-10 sm:px-10 sm:py-12 overflow-hidden">
          <div className="relative z-10 flex flex-col items-center text-center">
            <BrandMark variant="stacked" size="lg" />

            <AnimatePresence mode="wait">
              {view === 'google' && (
                <motion.div
                  key="google-login"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="w-full mt-7"
                >
                  <h1 className="font-display text-[28px] font-bold text-[#0F1035] dark:text-[#F4F2FF] tracking-tight leading-tight">
                    Login
                  </h1>
                  <p className="text-sm text-[#494B72] dark:text-[#C5BFE4] mt-1.5">
                    Access your ThinkPulse account
                  </p>
                  {statusInfo?.institutionName && (
                    <p className="text-xs font-medium text-[#6D28D9]/85 dark:text-[#C4B5FD] mt-1">
                      {statusInfo.institutionName}
                    </p>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="mt-5 text-left flex items-start gap-2.5 rounded-2xl bg-rose-50/85 dark:bg-rose-950/60 backdrop-blur-md border border-rose-200/90 dark:border-rose-400/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  {notice && (
                    <div
                      role="status"
                      className="mt-5 text-left flex items-start gap-2.5 rounded-2xl bg-emerald-50/85 dark:bg-emerald-950/60 backdrop-blur-md border border-emerald-200/90 dark:border-emerald-400/30 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span>{notice}</span>
                    </div>
                  )}

                  {/* Primary Unified Google Sign-In CTA */}
                  <div className="mt-8 space-y-4">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isWorking}
                      className="tp-gradient-btn w-full h-[54px] rounded-full text-white font-semibold text-[15px] px-6 flex items-center justify-center gap-3 disabled:opacity-65 cursor-pointer"
                    >
                      <span
                        className="w-7 h-7 rounded-full bg-white/95 shadow-xs flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                          />
                        </svg>
                      </span>
                      <span>{isWorking ? 'Signing in...' : 'Continue with Google'}</span>
                      {!isWorking && <ArrowRight className="w-4 h-4 shrink-0" />}
                    </button>

                    <div className="py-1 flex items-center gap-3">
                      <div className="h-px flex-1 bg-[#17143A]/12 dark:bg-white/15" />
                      <span className="text-xs font-medium text-[#55587D] dark:text-[#A49EC6]">or</span>
                      <div className="h-px flex-1 bg-[#17143A]/12 dark:bg-white/15" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        clearFeedback();
                        setView('email');
                      }}
                      disabled={isWorking}
                      className="tp-glass-btn w-full h-[50px] rounded-full text-[#0F1035] dark:text-[#F4F2FF] font-semibold text-sm px-5 flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
                    >
                      <Mail className="w-4 h-4 text-[#6D28D9] dark:text-[#C4B5FD]" />
                      <span>Sign in with institutional email</span>
                    </button>
                  </div>

                  <p className="mt-7 text-xs text-[#55587D] dark:text-[#A49EC6] leading-relaxed">
                    Your workspace is routed automatically from your verified Google credentials.
                  </p>
                </motion.div>
              )}

              {view === 'email' && (
                <motion.div
                  key="email-login"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="w-full mt-6"
                >
                  <h1 className="font-display text-[26px] font-bold text-[#0F1035] dark:text-[#F4F2FF] tracking-tight">
                    Login
                  </h1>
                  <p className="text-sm text-[#494B72] dark:text-[#C5BFE4] mt-1">
                    Access your ThinkPulse account
                  </p>

                  {error && (
                    <div
                      role="alert"
                      className="mt-5 text-left flex items-start gap-2.5 rounded-2xl bg-rose-50/85 dark:bg-rose-950/60 backdrop-blur-md border border-rose-200/90 dark:border-rose-400/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  {notice && (
                    <div
                      role="status"
                      className="mt-5 text-left flex items-start gap-2.5 rounded-2xl bg-emerald-50/85 dark:bg-emerald-950/60 backdrop-blur-md border border-emerald-200/90 dark:border-emerald-400/30 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <span>{notice}</span>
                    </div>
                  )}

                  <form onSubmit={handleEmailSignIn} className="mt-6 space-y-3.5 text-left">
                    <div className="relative">
                      <label htmlFor="tp-login-email" className="sr-only">
                        Email address
                      </label>
                      <Mail className="w-4 h-4 text-[#55587D] dark:text-[#A49EC6] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="tp-login-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email address"
                        className="tp-input w-full h-[50px] rounded-full pl-11 pr-4 text-sm text-[#0F1035] dark:text-[#F4F2FF] placeholder:text-[#6B6E94] dark:placeholder:text-[#9A93BE]"
                      />
                    </div>

                    <div className="relative">
                      <label htmlFor="tp-login-password" className="sr-only">
                        Password
                      </label>
                      <Lock className="w-4 h-4 text-[#55587D] dark:text-[#A49EC6] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="tp-login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        className="tp-input w-full h-[50px] rounded-full pl-11 pr-11 text-sm text-[#0F1035] dark:text-[#F4F2FF] placeholder:text-[#6B6E94] dark:placeholder:text-[#9A93BE]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#55587D] dark:text-[#A49EC6] hover:text-[#0F1035] dark:hover:text-white p-1 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    <div className="flex justify-end px-2">
                      <button
                        type="button"
                        onClick={() => {
                          clearFeedback();
                          setResetEmail(email);
                          setView('forgot');
                        }}
                        className="text-xs font-semibold text-[#6D28D9] dark:text-[#C4B5FD] hover:text-[#4F46E5] dark:hover:text-white cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isWorking}
                      className="tp-gradient-btn w-full h-[52px] rounded-full text-white font-semibold text-[15px] px-6 flex items-center justify-center gap-2 disabled:opacity-65 cursor-pointer mt-1"
                    >
                      <span>{isWorking ? 'Signing in...' : 'Login'}</span>
                      {!isWorking && <ArrowRight className="w-4 h-4" />}
                    </button>
                  </form>

                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-[#17143A]/12 dark:bg-white/15" />
                    <span className="text-xs font-medium text-[#55587D] dark:text-[#A49EC6]">or</span>
                    <div className="h-px flex-1 bg-[#17143A]/12 dark:bg-white/15" />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isWorking}
                    className="tp-glass-btn w-full h-[50px] rounded-full text-[#0F1035] dark:text-[#F4F2FF] font-semibold text-sm px-5 flex items-center justify-center gap-2.5 disabled:opacity-60 cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </motion.div>
              )}

              {view === 'forgot' && (
                <motion.div
                  key="forgot-password"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="w-full mt-6 text-left"
                >
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setResetStage('request');
                      setView('email');
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6D28D9] dark:text-[#C4B5FD] hover:text-[#4F46E5] dark:hover:text-white mb-4 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to login</span>
                  </button>

                  <h1 className="font-display text-2xl font-bold text-[#0F1035] dark:text-[#F4F2FF]">
                    Password Recovery
                  </h1>
                  <p className="text-xs text-[#55587D] dark:text-[#A49EC6] mt-1 mb-5">
                    Enter your institutional email address to issue a password recovery token.
                  </p>

                  {error && (
                    <div
                      role="alert"
                      className="mb-4 rounded-2xl bg-rose-50/85 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
                    >
                      {error}
                    </div>
                  )}
                  {notice && (
                    <div
                      role="status"
                      className="mb-4 rounded-2xl bg-emerald-50/85 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200"
                    >
                      {notice}
                    </div>
                  )}

                  <form onSubmit={handleForgotSubmit} className="space-y-3.5">
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#55587D] dark:text-[#A49EC6] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="Email address"
                        className="tp-input w-full h-[48px] rounded-full pl-11 pr-4 text-sm text-[#0F1035] dark:text-[#F4F2FF] placeholder:text-[#6B6E94] dark:placeholder:text-[#9A93BE]"
                      />
                    </div>

                    {resetStage === 'confirm' && (
                      <>
                        <input
                          type="text"
                          required
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          placeholder="Recovery token"
                          className="tp-input w-full h-[48px] rounded-full px-4 text-sm font-mono text-[#0F1035] dark:text-[#F4F2FF] placeholder:text-[#6B6E94] dark:placeholder:text-[#9A93BE]"
                        />
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="New password (min 8 characters)"
                          className="tp-input w-full h-[48px] rounded-full px-4 text-sm text-[#0F1035] dark:text-[#F4F2FF] placeholder:text-[#6B6E94] dark:placeholder:text-[#9A93BE]"
                        />
                      </>
                    )}

                    <button
                      type="submit"
                      disabled={isWorking}
                      className="tp-gradient-btn w-full h-[50px] rounded-full text-white font-semibold text-sm px-6 disabled:opacity-65 cursor-pointer"
                    >
                      {isWorking
                        ? 'Processing...'
                        : resetStage === 'request'
                        ? 'Request Recovery Token'
                        : 'Reset Password'}
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.main>
    </div>
  );
}
