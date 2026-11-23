import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Lock, QrCode } from 'lucide-react';
import { motion } from 'motion/react';
import { AmbientCanvas } from '../common/AmbientCanvas.tsx';
import { BrandMark } from '../common/BrandMark.tsx';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { AssessmentTaker } from './AssessmentTaker.tsx';
import { StudentResultView } from './StudentResultView.tsx';
import { ApiError, apiRequest } from '../../services/api.ts';
import type { PublicSessionDTO } from '../../../shared/types.ts';

interface AnonymousQrRunnerProps {
  sid: string;
  token: string;
  onGoToLogin: () => void;
}

export function AnonymousQrRunner({ sid, token, onGoToLogin }: AnonymousQrRunnerProps) {
  const [session, setSession] = useState<PublicSessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; resultToken?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRequiresSignIn(false);

    apiRequest<{ session: PublicSessionDTO }>('/public/sessions/verify-qr', {
      method: 'POST',
      body: { sid, token },
    })
      .then((res) => {
        if (cancelled) return;
        setSession(res.session);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'SIGN_IN_REQUIRED') {
          setRequiresSignIn(true);
        }
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to open this QR session. Please ask your host for the latest QR code.'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sid, token]);

  if (submitted) {
    return (
      <div className="min-h-screen tp-ambient-bg relative">
        <AmbientCanvas />
        <div className="relative z-10">
          <StudentResultView
            submissionId={submitted.id}
            guestResultToken={submitted.resultToken}
            backLabel="Go to ThinkPulse Sign In"
            onBack={onGoToLogin}
          />
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="min-h-screen tp-ambient-bg relative">
        <AmbientCanvas />
        <div className="relative z-10">
          <AssessmentTaker
            session={session}
            guestQrToken={token}
            onExit={onGoToLogin}
            onSubmitted={(submissionId, resultToken) =>
              setSubmitted({ id: submissionId, resultToken })
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen tp-ambient-bg relative flex items-center justify-center p-4 sm:p-6">
      <AmbientCanvas />

      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md tp-liquid-card rounded-[32px] p-7 sm:p-8 text-center space-y-5"
      >
        <div className="flex justify-center">
          <BrandMark size="md" />
        </div>

        {loading ? (
          <div className="py-6 space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#6334E8]/12 dark:bg-[#8B5CF6]/22 text-[#6334E8] dark:text-[#C4B5FD] flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <h1 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
              Opening Anonymous Session
            </h1>
            <p className="text-sm text-[#55587D] dark:text-[#A49EC6]">
              Verifying host QR code...
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={`w-12 h-12 mx-auto rounded-2xl flex items-center justify-center ${
                requiresSignIn
                  ? 'bg-[#6334E8]/12 dark:bg-[#8B5CF6]/22 text-[#6334E8] dark:text-[#C4B5FD]'
                  : 'bg-rose-500/12 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300'
              }`}
            >
              {requiresSignIn ? <Lock className="w-6 h-6" /> : <QrCode className="w-6 h-6" />}
            </div>

            <div className="space-y-1.5">
              <h1 className="font-display font-bold text-xl text-[#17143A] dark:text-[#F4F2FF]">
                {requiresSignIn ? 'Google Sign-In Required' : 'Unable to Open QR Session'}
              </h1>
              <div
                role="alert"
                className="rounded-2xl bg-white/65 dark:bg-white/6 border border-white/90 dark:border-white/12 p-3.5 text-sm text-[#433E68] dark:text-[#C5BFE4] flex items-start gap-2 text-left"
              >
                <AlertCircle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    requiresSignIn
                      ? 'text-[#6334E8] dark:text-[#C4B5FD]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                />
                <span>{error}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onGoToLogin}
              className="w-full tp-gradient-btn text-white font-semibold text-sm px-5 py-3 rounded-full inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{requiresSignIn ? 'Continue to Google Sign In' : 'Go to ThinkPulse Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
