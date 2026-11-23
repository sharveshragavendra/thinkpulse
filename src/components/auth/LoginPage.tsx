import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { AmbientCanvas } from '../common/AmbientCanvas.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

export function LoginPage() {
  const { loginWithGoogle, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setError(null);
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
          `This domain (${window.location.hostname}) is not authorized for Google Sign-In.`
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

  return (
    <div className="min-h-screen tp-ambient-bg relative flex items-center justify-center p-4 sm:p-8 overflow-hidden">
      <AmbientCanvas />

      <motion.main
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[360px] relative z-10 flex flex-col items-center gap-4"
      >
        {error && (
          <div
            role="alert"
            className="w-full text-left flex items-start gap-2.5 rounded-2xl bg-rose-50/90 dark:bg-rose-950/70 backdrop-blur-md border border-rose-200/90 dark:border-rose-400/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
          >
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="tp-gradient-btn w-full h-[56px] rounded-full text-white font-semibold text-[15px] px-7 flex items-center justify-center gap-3 disabled:opacity-65 cursor-pointer shadow-lg"
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
          <span>{loading ? 'Signing in...' : 'Continue with Google'}</span>
        </button>
      </motion.main>
    </div>
  );
}
