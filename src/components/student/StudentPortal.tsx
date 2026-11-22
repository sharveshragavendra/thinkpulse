import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Clock,
  LogOut,
  QrCode,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { AmbientCanvas } from '../common/AmbientCanvas.tsx';
import { BrandMark } from '../common/BrandMark.tsx';
import { QrScannerModal } from './QrScannerModal.tsx';
import { AssessmentTaker } from './AssessmentTaker.tsx';
import { StudentResultView } from './StudentResultView.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../services/api.ts';
import { useRealtime } from '../../hooks/useRealtime.ts';
import type { PublicSessionDTO, SubmissionSummaryDTO } from '../../../shared/types.ts';

export function StudentPortal() {
  const { user, logout } = useAuth();
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [activeSession, setActiveSession] = useState<PublicSessionDTO | null>(null);
  const [viewingSubmissionId, setViewingSubmissionId] = useState<string | null>(null);

  const [recentSubmissions, setRecentSubmissions] = useState<SubmissionSummaryDTO[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecent = useCallback(async () => {
    try {
      const res = await apiRequest<{ submissions: SubmissionSummaryDTO[] }>('/my/submissions');
      setRecentSubmissions(res.submissions);
    } catch {
      // handled gracefully
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useRealtime(
    true,
    (evt) => {
      if (evt.type === 'submission.graded' || evt.type === 'submission.recalculated') {
        void loadRecent();
      }
    },
    () => void loadRecent()
  );

  const codeValue = digits.join('');

  const handleDigitChange = (idx: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    setError(null);
    if (!clean) {
      setDigits((prev) => {
        const next = [...prev];
        next[idx] = '';
        return next;
      });
      return;
    }

    // Handle paste or multi-digit entry
    if (clean.length > 1) {
      const slice = clean.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      slice.forEach((d, i) => {
        next[i] = d;
      });
      setDigits(next);
      const focusIdx = Math.min(5, slice.length);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    setDigits((prev) => {
      const next = [...prev];
      next[idx] = clean;
      return next;
    });
    if (idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleClearDigits = () => {
    setDigits(['', '', '', '', '', '']);
    setError(null);
    inputRefs.current[0]?.focus();
  };

  const handleResolveCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (codeValue.length !== 6) {
      setError('Enter all 6 numeric digits of your session code.');
      return;
    }
    setResolving(true);
    try {
      const res = await apiRequest<{ session: PublicSessionDTO }>('/sessions/resolve-code', {
        method: 'POST',
        body: { code: codeValue },
      });
      setActiveSession(res.session);
      setDigits(['', '', '', '', '', '']);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to join session.');
    } finally {
      setResolving(false);
    }
  };

  const initials = (user?.displayName || user?.email || 'S')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  if (activeSession) {
    return (
      <div className="min-h-screen tp-ambient-bg relative">
        <AmbientCanvas />
        <div className="relative z-10">
          <AssessmentTaker
            session={activeSession}
            onExit={() => setActiveSession(null)}
            onSubmitted={(subId) => {
              setActiveSession(null);
              setViewingSubmissionId(subId);
              void loadRecent();
            }}
          />
        </div>
      </div>
    );
  }

  if (viewingSubmissionId) {
    return (
      <div className="min-h-screen tp-ambient-bg relative">
        <AmbientCanvas />
        <div className="relative z-10">
          <StudentResultView
            submissionId={viewingSubmissionId}
            onBack={() => {
              setViewingSubmissionId(null);
              void loadRecent();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen tp-ambient-bg relative">
      <AmbientCanvas />

      {/* Floating Liquid Glass Top Pill Bar */}
      <div className="sticky top-4 z-30 px-4 sm:px-6 pt-4">
        <header className="max-w-6xl mx-auto tp-glass-bar rounded-full px-5 h-14 flex items-center justify-between gap-4">
          <BrandMark size="sm" />

          <div className="flex items-center gap-3.5 min-w-0">
            <div className="hidden sm:flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-full tp-gradient-btn text-white font-display font-bold text-xs flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0F1035] truncate leading-tight">
                  {user?.displayName}
                </p>
                <p className="text-[11px] text-[#55587D] truncate leading-tight">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="tp-glass-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold text-[#0F1035] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-[#55587D]" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8 relative z-10">
        {/* Welcome Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
        >
          <div>
            <p className="text-xs font-semibold text-[#6334E8]">
              Student Portal · {user?.institutionName || 'ThinkPulse'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#17143A] tracking-tight mt-1">
              Welcome, {user?.displayName}
            </h1>
            <p className="text-sm text-[#433E68] mt-1">
              Join an active quiz or poll using the host’s six-digit code or official QR scanner.
            </p>
          </div>
          {user?.classSection && (
            <div className="text-xs text-[#433E68] tp-surface rounded-xl px-4 py-2 whitespace-nowrap">
              Class: <strong className="text-[#17143A]">{user.classSection}</strong>
            </div>
          )}
        </motion.div>

        {/* Join Grid: 6-Digit Crystal Code + Official QR Scanner */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* 6-Digit Numeric Entry Frosted Glass Pane */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-7 tp-liquid-card rounded-[34px] p-6 sm:p-8 flex flex-col justify-between space-y-6 relative overflow-hidden"
          >
            <div className="relative z-10 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-xl text-[#0F1035]">
                  Enter 6-Digit Session Code
                </h2>
                <p className="text-sm text-[#43446B] mt-1">
                  Type or paste the six numeric digits displayed on your host’s screen.
                </p>
              </div>
              {codeValue.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearDigits}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#43446B] hover:text-[#0F1035] cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            <form onSubmit={handleResolveCode} className="relative z-10 space-y-5">
              {/* 3 + 3 Spaced Crystal Digit Cells */}
              <div
                className="flex items-center justify-between gap-2 sm:gap-2.5"
                role="group"
                aria-label="Six digit session code"
              >
                {digits.map((digit, idx) => (
                  <React.Fragment key={idx}>
                    {idx === 3 && (
                      <span
                        className="text-lg font-mono font-bold text-[#6E6A96] px-0.5 select-none"
                        aria-hidden="true"
                      >
                        –
                      </span>
                    )}
                    <input
                      ref={(el) => {
                        inputRefs.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      aria-label={`Digit ${idx + 1}`}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className={`tp-input w-full h-14 sm:h-[68px] text-center font-mono text-2xl sm:text-3xl font-bold rounded-2xl tabular-nums transition-all ${
                        digit
                          ? 'text-[#6D28D9] border-[#7C3AED]/65 bg-white shadow-sm'
                          : 'text-[#0F1035] bg-white/90'
                      }`}
                    />
                  </React.Fragment>
                ))}
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-2xl bg-rose-50/95 border border-rose-200 px-3.5 py-3 text-sm text-rose-800"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={resolving || codeValue.length !== 6}
                className="w-full tp-gradient-btn text-white font-semibold text-sm py-3.5 px-6 rounded-full flex items-center justify-center gap-2 disabled:opacity-80 disabled:saturate-90 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>{resolving ? 'Verifying session...' : 'Join Active Session'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="relative z-10 flex items-start gap-2.5 pt-3 border-t border-[#17143A]/10 text-xs text-[#43446B]">
              <ShieldCheck className="w-4 h-4 text-[#6D28D9] shrink-0 mt-0.5" />
              <span>
                You can join only active sessions. Before starting, ThinkPulse clearly indicates whether the session is Anonymous or Normal mode.
              </span>
            </div>
          </motion.div>

          {/* Scan Official QR Frosted Pane */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-5 tp-liquid-card rounded-[34px] p-6 sm:p-8 flex flex-col justify-between space-y-6 relative overflow-hidden"
          >
            <div
              className="pointer-events-none absolute -bottom-16 -right-16 w-48 h-48 rounded-full opacity-35 blur-2xl"
              style={{ background: 'radial-gradient(circle, rgba(79, 70, 229, 0.35), transparent 70%)' }}
              aria-hidden="true"
            />
            <div className="space-y-4 relative z-10">
              {/* Viewfinder Motif Icon Container */}
              <div className="w-16 h-16 rounded-2xl bg-white/75 border border-white/95 shadow-sm flex items-center justify-center relative">
                <span className="absolute top-2 left-2 w-2.5 h-2.5 border-t-2 border-l-2 border-[#6334E8] rounded-tl-xs" />
                <span className="absolute top-2 right-2 w-2.5 h-2.5 border-t-2 border-r-2 border-[#6334E8] rounded-tr-xs" />
                <span className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b-2 border-l-2 border-[#6334E8] rounded-bl-xs" />
                <span className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b-2 border-r-2 border-[#6334E8] rounded-br-xs" />
                <QrCode className="w-7 h-7 text-[#6334E8]" />
              </div>
              <div>
                <h2 className="font-display font-bold text-xl text-[#17143A]">Scan Official QR</h2>
                <p className="text-sm text-[#433E68] mt-1.5 leading-relaxed">
                  Point your camera at the host’s projected QR code or upload a QR image. Every scan is verified server-side against the active rotating token.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="tp-glass-btn relative z-10 w-full text-[#0F1035] font-semibold text-sm py-3.5 px-6 rounded-full flex items-center justify-center gap-2 cursor-pointer"
            >
              <QrCode className="w-4 h-4 text-[#6D28D9]" />
              <span>Open QR Scanner</span>
            </button>
          </motion.div>
        </div>

        {/* Recent Submitted Sessions */}
        <section className="tp-surface rounded-[28px] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#17143A]/8 flex items-center justify-between">
            <div>
              <h2 className="font-display font-bold text-lg text-[#17143A]">
                Recent Submitted Sessions
              </h2>
              <p className="text-xs text-[#5B617A]">
                Review your scores, written feedback, and poll confirmations.
              </p>
            </div>
            <span className="text-xs font-mono text-[#5B617A] tabular-nums">
              {recentSubmissions.length} total
            </span>
          </div>

          {loadingRecent ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-14 rounded-2xl bg-white/60 animate-pulse" />
              ))}
            </div>
          ) : recentSubmissions.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-[#17143A]">No completed sessions yet</p>
              <p className="text-xs text-[#5B617A] max-w-sm mx-auto">
                Join an active quiz or poll above using a six-digit code or official QR to see your results and feedback here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#17143A]/8">
              {recentSubmissions.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setViewingSubmissionId(sub.id)}
                  className="w-full text-left px-6 py-4 hover:bg-white/65 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#17143A] truncate">
                      {sub.assessmentTitle}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#5B617A] mt-1">
                      <span className="capitalize">{sub.assessmentType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{sub.privacyMode} mode</span>
                      {sub.anonId && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[#6334E8]">{sub.anonId}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(sub.submittedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {sub.assessmentType === 'quiz' ? (
                      <div className="text-right">
                        <p className="font-mono font-bold text-sm text-[#17143A] tabular-nums">
                          {sub.totalScore} / {sub.maxScore}
                        </p>
                        <p className="text-xs text-[#5B617A] flex items-center justify-end gap-1">
                          {sub.status === 'pending_review' ? (
                            <>
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span className="text-amber-700 font-medium">Pending review</span>
                            </>
                          ) : (
                            <span className="text-emerald-700 font-medium">Reviewed</span>
                          )}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-700">Recorded</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-[#8E93AB]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onVerified={(sess) => {
          setScannerOpen(false);
          setActiveSession(sess);
        }}
        onSwitchToCode={() => {
          inputRefs.current[0]?.focus();
        }}
      />
    </div>
  );
}
