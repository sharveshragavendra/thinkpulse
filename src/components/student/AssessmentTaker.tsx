import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  EyeOff,
  Loader2,
  Send,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { apiRequest } from '../../services/api.ts';
import type { PublicSessionDTO } from '../../../shared/types.ts';

interface AssessmentTakerProps {
  session: PublicSessionDTO;
  guestQrToken?: string;
  onExit: () => void;
  onSubmitted: (submissionId: string, guestResultToken?: string) => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function AssessmentTaker({ session, guestQrToken, onExit, onSubmitted }: AssessmentTakerProps) {
  const [stage, setStage] = useState<'instructions' | 'taking'>('instructions');
  const [alias, setAlias] = useState('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [anonId, setAnonId] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState(session.remainingSeconds);

  const [answers, setAnswers] = useState<
    Record<string, { selectedOptionIds: string[]; textAnswer: string }>
  >({});

  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoSubmittedRef = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const isQuiz = session.type === 'quiz';
  const totalMarks = useMemo(
    () => (isQuiz ? session.questions.reduce((acc, q) => acc + q.points, 0) : 0),
    [isQuiz, session.questions]
  );

  const answeredCount = useMemo(() => {
    return session.questions.filter((q) => {
      const a = answers[q.id];
      if (!a) return false;
      if (q.type === 'mcq' || q.type === 'multi_select') return a.selectedOptionIds.length > 0;
      return a.textAnswer.trim().length > 0;
    }).length;
  }, [answers, session.questions]);

  const completionPct =
    session.questions.length > 0 ? Math.round((answeredCount / session.questions.length) * 100) : 0;

  const executeSubmit = useCallback(
    async (isAuto: boolean) => {
      if (!sessionToken || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const formattedAnswers = session.questions.map((q) => {
          const a = answersRef.current[q.id];
          return {
            questionId: q.id,
            selectedOptionIds: a?.selectedOptionIds ?? [],
            textAnswer: a?.textAnswer ?? null,
          };
        });

        const submitPath = guestQrToken
          ? `/public/sessions/${session.sessionId}/submissions`
          : `/sessions/${session.sessionId}/submissions`;

        const res = await apiRequest<{ submissionId: string; resultToken?: string }>(
          submitPath,
          {
            method: 'POST',
            body: {
              sessionToken,
              alias: session.privacyMode === 'anonymous' ? alias.trim() || undefined : undefined,
              autoSubmitted: isAuto,
              answers: formattedAnswers,
            },
          }
        );
        setConfirmOpen(false);
        onSubmitted(res.submissionId, res.resultToken);
      } catch (err: unknown) {
        setConfirmOpen(false);
        setError(err instanceof Error ? err.message : 'Unable to submit your response.');
      } finally {
        setSubmitting(false);
      }
    },
    [alias, guestQrToken, onSubmitted, session.privacyMode, session.questions, session.sessionId, sessionToken, submitting]
  );

  // Authoritative server-synced display countdown + auto-submit on expiry (Quizzes only)
  useEffect(() => {
    if (!isQuiz || stage !== 'taking' || !sessionToken) return;
    const interval = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (!autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            void executeSubmit(true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isQuiz, stage, sessionToken, executeSubmit]);

  const handleStart = async () => {
    setError(null);
    setStarting(true);
    try {
      const startPath = guestQrToken
        ? `/public/sessions/${session.sessionId}/start`
        : `/sessions/${session.sessionId}/start`;

      const res = await apiRequest<{
        sessionToken: string;
        anonId: string | null;
        expiresAt: string;
        serverTime: string;
      }>(startPath, {
        method: 'POST',
        body: guestQrToken
          ? {
              qrToken: guestQrToken,
              alias: alias.trim() || undefined,
            }
          : {
              alias: session.privacyMode === 'anonymous' ? alias.trim() || undefined : undefined,
            },
      });
      setSessionToken(res.sessionToken);
      setAnonId(res.anonId);
      const delta = Math.max(
        0,
        Math.floor((new Date(res.expiresAt).getTime() - new Date(res.serverTime).getTime()) / 1000)
      );
      setRemainingSec(delta);
      setStage('taking');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to start session.');
    } finally {
      setStarting(false);
    }
  };

  const toggleOption = (questionId: string, optionId: string, isMulti: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? { selectedOptionIds: [], textAnswer: '' };
      if (!isMulti) {
        return { ...prev, [questionId]: { ...current, selectedOptionIds: [optionId] } };
      }
      const exists = current.selectedOptionIds.includes(optionId);
      const next = exists
        ? current.selectedOptionIds.filter((id) => id !== optionId)
        : [...current.selectedOptionIds, optionId];
      return { ...prev, [questionId]: { ...current, selectedOptionIds: next } };
    });
  };

  const setTextResponse = (questionId: string, text: string) => {
    setAnswers((prev) => {
      const current = prev[questionId] ?? { selectedOptionIds: [], textAnswer: '' };
      return { ...prev, [questionId]: { ...current, textAnswer: text } };
    });
  };

  if (stage === 'instructions') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between gap-3 mb-5">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6334E8] dark:text-[#C4B5FD] hover:text-[#4F46E5] dark:hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            {guestQrToken ? 'ThinkPulse Sign In' : 'Back to Student Portal'}
          </button>
          <ThemeToggle compact />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="tp-glass rounded-[30px] p-6 sm:p-8 space-y-6"
        >
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#5B617A] dark:text-[#A49EC6]">
              <span>{isQuiz ? 'Quiz Session' : 'Live Poll'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-[#6334E8] dark:text-[#C4B5FD]">Code {session.joinCode}</span>
              <span aria-hidden="true">·</span>
              <span>{session.questions.length} {session.questions.length === 1 ? 'question' : 'questions'}</span>
              {isQuiz && session.showMarksToStudents && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{totalMarks} total marks</span>
                </>
              )}
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#17143A] dark:text-[#F4F2FF] mt-2">
              {session.title}
            </h1>
            {session.description && (
              <p className="text-sm text-[#433E68] dark:text-[#C5BFE4] mt-2 leading-relaxed">{session.description}</p>
            )}
          </div>

          {session.instructions && (
            <div className="rounded-2xl bg-white/60 dark:bg-white/6 border border-white/90 dark:border-white/12 p-4">
              <p className="text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Host instructions</p>
              <p className="text-sm text-[#433E68] dark:text-[#C5BFE4] whitespace-pre-wrap">{session.instructions}</p>
            </div>
          )}

          {/* Explicit Privacy Mode Boundary Disclosure */}
          <div className="rounded-2xl bg-white/65 dark:bg-white/6 border border-white/90 dark:border-white/12 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#6334E8]/12 dark:bg-[#8B5CF6]/20 text-[#6334E8] dark:text-[#C4B5FD] flex items-center justify-center shrink-0">
              {session.privacyMode === 'anonymous' ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <UserCheck className="w-4 h-4" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF]">
                {session.privacyMode === 'anonymous'
                  ? 'Anonymous Mode — Identity hidden from Host'
                  : 'Normal Mode — Linked to your Student Profile'}
              </p>
              <p className="text-xs text-[#5B617A] dark:text-[#A49EC6] leading-relaxed">
                {session.privacyMode === 'anonymous'
                  ? guestQrToken
                    ? 'Direct QR join — no Google Sign-In required. A random anonymous ID will be generated for your response, and your identity is completely hidden from the host.'
                    : 'A random anonymous ID will be generated for your response. Your name, email, and student ID are never exposed to the host in dashboards, Data Retrieval, or CSV exports. You can still view your own result privately inside your portal.'
                  : 'Your name, email, and individual responses will be recorded against your student profile and visible to authorized hosts in your institution.'}
              </p>
            </div>
          </div>

          {session.privacyMode === 'anonymous' && session.allowAlias && (
            <div>
              <label htmlFor="anon-alias" className="block text-sm font-medium text-[#17143A] dark:text-[#F4F2FF] mb-1.5">
                Optional display alias (visible to host alongside your random anonymous ID)
              </label>
              <input
                id="anon-alias"
                type="text"
                maxLength={60}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Leave blank to remain purely anonymous"
                className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl bg-rose-50/90 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 p-3.5 text-sm text-rose-800 dark:text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {session.alreadySubmitted && session.existingSubmissionId ? (
            <div className="rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-400/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-200 font-medium">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>You have already submitted a response for this session.</span>
              </div>
              <button
                type="button"
                onClick={() => onSubmitted(session.existingSubmissionId!)}
                className="tp-gradient-btn text-white text-sm font-semibold px-4 py-2 rounded-xl whitespace-nowrap cursor-pointer"
              >
                View My Result
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-3 border-t border-[#17143A]/8 dark:border-white/10">
              <div className="flex items-center gap-2 text-sm text-[#433E68] dark:text-[#C5BFE4]">
                <Clock className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
                {isQuiz ? (
                  <span className="font-mono tabular-nums font-semibold">
                    {formatTimer(remainingSec)} remaining
                  </span>
                ) : (
                  <span className="font-medium">No time limit · Open poll</span>
                )}
              </div>
              <button
                type="button"
                disabled={starting || (isQuiz && remainingSec <= 0)}
                onClick={handleStart}
                className="tp-gradient-btn text-white font-semibold text-sm px-6 py-3 rounded-xl disabled:opacity-60 cursor-pointer"
              >
                {starting ? 'Starting...' : isQuiz ? 'Start Quiz' : 'Start Poll'}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 space-y-6">
      {/* Floating Frosted Sticky Timer & Progress Dock */}
      <div className="sticky top-3 z-30 tp-glass rounded-2xl px-4 sm:px-6 py-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display font-bold text-base sm:text-lg text-[#17143A] dark:text-[#F4F2FF] truncate">
              {session.title}
            </h1>
            <div className="flex items-center gap-2 text-xs text-[#5B617A] dark:text-[#A49EC6] mt-0.5">
              <span className="tabular-nums font-medium">
                {answeredCount} of {session.questions.length} answered ({completionPct}%)
              </span>
              {anonId && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[#6334E8] dark:text-[#C4B5FD] font-semibold">{anonId}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            {isQuiz && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-mono text-sm font-bold tabular-nums ${
                  remainingSec <= 60
                    ? 'bg-rose-50/90 dark:bg-rose-950/70 border-rose-300 dark:border-rose-400/40 text-rose-700 dark:text-rose-200'
                    : 'bg-white/80 dark:bg-white/10 border-white/95 dark:border-white/15 text-[#17143A] dark:text-[#F4F2FF] shadow-xs'
                }`}
                aria-label="Time remaining"
              >
                <Clock className="w-4 h-4" />
                <span>{formatTimer(remainingSec)}</span>
              </div>
            )}
            <ThemeToggle compact />
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmOpen(true)}
              className="tp-gradient-btn text-white text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              <span>Submit</span>
            </button>
          </div>
        </div>

        {/* Integrated Smooth Completion Rail */}
        <div className="h-1.5 rounded-full bg-white/75 dark:bg-white/12 overflow-hidden ring-1 ring-[#6334E8]/10 dark:ring-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#6E3DF0] to-[#4F46E5] dark:from-[#A78BFA] dark:to-[#6366F1]"
            initial={false}
            animate={{ scaleX: completionPct / 100 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: 'left center', width: '100%' }}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-rose-50/90 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 p-4 text-sm text-rose-800 dark:text-rose-200">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Frosted Question Cards */}
      <div className="space-y-4">
        {session.questions.map((q, idx) => {
          const current = answers[q.id] ?? { selectedOptionIds: [], textAnswer: '' };
          return (
            <div key={q.id} className="tp-surface rounded-[24px] p-5 sm:p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-[#5B617A] dark:text-[#A49EC6] flex items-center gap-2">
                    <span className="font-mono font-semibold text-[#6334E8] dark:text-[#C4B5FD]">Q{idx + 1}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {q.type === 'mcq'
                        ? 'Single Choice'
                        : q.type === 'multi_select'
                        ? 'Select Multiple'
                        : q.type === 'short_answer'
                        ? 'Short Answer'
                        : 'Paragraph Response'}
                    </span>
                  </div>
                  <h2 className="font-display font-semibold text-base text-[#17143A] dark:text-[#F4F2FF] leading-snug">
                    {q.text}
                  </h2>
                </div>
                {isQuiz && session.showMarksToStudents && (
                  <span className="text-xs font-mono font-semibold text-[#6334E8] dark:text-[#C4B5FD] whitespace-nowrap shrink-0 tabular-nums">
                    {q.points} {q.points === 1 ? 'mark' : 'marks'}
                  </span>
                )}
              </div>

              {(q.type === 'mcq' || q.type === 'multi_select') && (
                <div className="space-y-2.5" role={q.type === 'mcq' ? 'radiogroup' : 'group'}>
                  {q.options.map((opt) => {
                    const selected = current.selectedOptionIds.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleOption(q.id, opt.id, q.type === 'multi_select')}
                        className={`w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all cursor-pointer ${
                          selected
                            ? 'bg-[#6334E8]/10 dark:bg-[#8B5CF6]/25 border-[#6334E8] dark:border-[#A78BFA] text-[#17143A] dark:text-white shadow-xs'
                            : 'bg-white/70 dark:bg-white/5 border-white/90 dark:border-white/12 hover:bg-white/95 dark:hover:bg-white/10 hover:border-[#6334E8]/35 dark:hover:border-[#A78BFA]/45 text-[#17143A] dark:text-[#E5E0FF]'
                        }`}
                      >
                        <span
                          className={`w-5 h-5 shrink-0 flex items-center justify-center border transition-colors ${
                            q.type === 'mcq' ? 'rounded-full' : 'rounded-md'
                          } ${
                            selected
                              ? 'border-[#6334E8] dark:border-[#A78BFA] bg-[#6334E8] dark:bg-[#8B5CF6] text-white'
                              : 'border-[#94A3B8] dark:border-[#6F6998] bg-white dark:bg-[#171133]'
                          }`}
                        >
                          {selected && <Check className="w-3 h-3 stroke-[3]" />}
                        </span>
                        <span className="text-sm font-medium">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === 'short_answer' && (
                <input
                  type="text"
                  value={current.textAnswer}
                  onChange={(e) => setTextResponse(q.id, e.target.value)}
                  placeholder="Type your short answer..."
                  className="tp-input w-full rounded-xl px-4 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              )}

              {q.type === 'paragraph' && (
                <textarea
                  rows={4}
                  value={current.textAnswer}
                  onChange={(e) => setTextResponse(q.id, e.target.value)}
                  placeholder="Write your detailed response..."
                  className="tp-input w-full rounded-xl px-4 py-3 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Submit Action */}
      <div className="tp-glass rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#433E68] dark:text-[#C5BFE4] flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
          Answers are immutable once submitted.
        </span>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setConfirmOpen(true)}
          className="tp-gradient-btn text-white font-semibold text-sm px-6 py-3 rounded-xl cursor-pointer disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : isQuiz ? 'Submit Quiz' : 'Submit Poll Response'}
        </button>
      </div>

      {/* Frosted Submit Confirmation Modal */}
      <AnimatePresence>
        {confirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/45 dark:bg-black/65 backdrop-blur-md p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md rounded-3xl tp-modal-glass p-6 space-y-4"
            >
              <h3 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
                Confirm {isQuiz ? 'Quiz' : 'Poll'} Submission
              </h3>
              <p className="text-sm text-[#433E68] dark:text-[#C5BFE4] leading-relaxed">
                You have answered{' '}
                <strong className="text-[#17143A] dark:text-[#F4F2FF] tabular-nums">
                  {answeredCount} of {session.questions.length}
                </strong>{' '}
                questions. Once submitted, responses cannot be modified.
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#17143A]/8 dark:border-white/10">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmOpen(false)}
                  className="tp-glass-btn px-4 py-2 rounded-xl text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF] cursor-pointer"
                >
                  Review Answers
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void executeSubmit(false)}
                  className="tp-gradient-btn text-white px-5 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Confirm & Submit</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
