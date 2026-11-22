import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquareText,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../../services/api.ts';
import { useRealtime } from '../../hooks/useRealtime.ts';
import type { SubmissionDetailDTO } from '../../../shared/types.ts';

interface StudentResultViewProps {
  submissionId: string;
  onBack: () => void;
}

export function StudentResultView({ submissionId, onBack }: StudentResultViewProps) {
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<{ submission: SubmissionDetailDTO }>(
        `/my/submissions/${submissionId}`
      );
      setDetail(res.submission);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load submission result.');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live refresh when host finishes grading or recalculates answer key
  useRealtime(
    true,
    (evt) => {
      if (
        (evt.type === 'submission.graded' && evt.submissionId === submissionId) ||
        (evt.type === 'submission.recalculated' && evt.assessmentId === detail?.assessmentId)
      ) {
        void load();
      }
    },
    () => void load()
  );

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 flex items-center justify-center gap-2 text-sm text-[#5B617A]">
        <Loader2 className="w-5 h-5 animate-spin text-[#6334E8]" />
        <span>Loading your result...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6334E8] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Student Portal
        </button>
        <div role="alert" className="rounded-2xl bg-rose-50/90 border border-rose-200 p-5 text-sm text-rose-800 flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>{error || 'Result unavailable.'}</span>
        </div>
      </div>
    );
  }

  const isQuiz = detail.assessmentType === 'quiz';
  const pct = Math.max(0, Math.min(100, detail.percentage ?? 0));
  const ringRadius = 30;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - pct / 100);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6334E8] hover:text-[#4F46E5] cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Student Portal
      </button>

      {/* Luminous Frosted Summary Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="tp-glass rounded-[30px] p-6 sm:p-8 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#5B617A]">
              <span>{isQuiz ? 'Quiz Result' : 'Poll Submission Recorded'}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{detail.privacyMode} mode</span>
              {detail.anonId && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-semibold text-[#6334E8]">{detail.anonId}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                Submitted {new Date(detail.submittedAt).toLocaleString()}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#17143A] mt-2">
              {detail.assessmentTitle}
            </h1>
          </div>

          {isQuiz && (
            <div className="flex items-center gap-4 shrink-0">
              {detail.percentage !== null && (
                <div className="relative w-[72px] h-[72px] flex items-center justify-center">
                  <svg className="w-[72px] h-[72px] -rotate-90" viewBox="0 0 72 72" aria-hidden="true">
                    <circle
                      cx="36"
                      cy="36"
                      r={ringRadius}
                      fill="none"
                      stroke="rgba(99, 52, 232, 0.14)"
                      strokeWidth="6"
                    />
                    <motion.circle
                      cx="36"
                      cy="36"
                      r={ringRadius}
                      fill="none"
                      stroke="url(#tpScoreGradient)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      initial={{ strokeDashoffset: ringCircumference }}
                      animate={{ strokeDashoffset: ringDashOffset }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    />
                    <defs>
                      <linearGradient id="tpScoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#6E3DF0" />
                        <stop offset="100%" stopColor="#4F46E5" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className="absolute font-mono text-sm font-bold text-[#17143A] tabular-nums">
                    {detail.percentage}%
                  </span>
                </div>
              )}

              <div className="text-right">
                <p className="text-xs font-medium text-[#5B617A]">
                  {detail.hasPendingWritten ? 'Provisional Score' : 'Final Score'}
                </p>
                <p className="font-mono text-2xl sm:text-3xl font-bold text-[#6334E8] tabular-nums">
                  {detail.totalScore} / {detail.maxScore}
                </p>
              </div>
            </div>
          )}
        </div>

        {isQuiz && detail.hasPendingWritten && (
          <div className="rounded-2xl bg-amber-50/90 border border-amber-200 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-900">
            <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Written responses are pending manual review by your host. Your score and feedback will update automatically once reviewed.
            </span>
          </div>
        )}

        {!isQuiz && (
          <div className="rounded-2xl bg-emerald-50/90 border border-emerald-200 px-4 py-3 flex items-start gap-2.5 text-sm text-emerald-900">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Your poll response has been recorded. Polls do not have marks or correct answers.
            </span>
          </div>
        )}
      </motion.div>

      {/* Question-by-question frosted breakdown */}
      <div className="space-y-4">
        {detail.items.map((item, idx) => {
          const outcome = item.grading?.outcome;
          return (
            <div key={item.questionId} className="tp-surface rounded-[24px] p-5 sm:p-6 space-y-3.5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-[#5B617A] flex items-center gap-2">
                    <span className="font-mono font-semibold text-[#6334E8]">Q{idx + 1}</span>
                    {isQuiz && item.grading && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            outcome === 'correct'
                              ? 'text-emerald-700'
                              : outcome === 'partial'
                              ? 'text-amber-700'
                              : outcome === 'pending'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {outcome === 'correct'
                            ? 'Correct'
                            : outcome === 'partial'
                            ? 'Partial Credit'
                            : outcome === 'pending'
                            ? 'Pending Host Review'
                            : 'Incorrect'}
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display font-semibold text-base text-[#17143A] mt-1">
                    {item.text}
                  </h2>
                </div>

                {isQuiz && item.grading && (
                  <span className="font-mono text-sm font-semibold text-[#17143A] tabular-nums whitespace-nowrap">
                    {item.grading.outcome === 'pending'
                      ? `Pending / ${item.grading.maxPoints}`
                      : `${item.grading.awardedPoints} / ${item.grading.maxPoints}`}
                  </span>
                )}
              </div>

              {(item.type === 'mcq' || item.type === 'multi_select') && (
                <div className="space-y-2">
                  {item.options.map((o) => {
                    const chosen = item.selectedOptionIds.includes(o.id);
                    return (
                      <div
                        key={o.id}
                        className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-sm ${
                          chosen
                            ? isQuiz && o.isCorrect === false
                              ? 'bg-rose-50/85 border-rose-200 text-rose-950'
                              : isQuiz && o.isCorrect
                              ? 'bg-emerald-50/85 border-emerald-200 text-emerald-950'
                              : 'bg-[#6334E8]/10 border-[#6334E8]/40 text-[#17143A]'
                            : isQuiz && o.isCorrect
                            ? 'bg-emerald-50/50 border-emerald-200/80 text-[#17143A]'
                            : 'bg-white/65 border-white/90 text-[#433E68]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {chosen && isQuiz && o.isCorrect && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          )}
                          {chosen && isQuiz && o.isCorrect === false && (
                            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          )}
                          <span className={chosen ? 'font-semibold' : ''}>{o.label}</span>
                        </div>
                        <span className="text-xs text-[#5B617A] whitespace-nowrap">
                          {chosen ? 'Your choice' : isQuiz && o.isCorrect ? 'Correct answer' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {(item.type === 'short_answer' || item.type === 'paragraph') && (
                <div className="rounded-2xl bg-white/65 border border-white/90 p-3.5">
                  <p className="text-xs font-medium text-[#5B617A] mb-1">Your written response</p>
                  <p className="text-sm text-[#17143A] whitespace-pre-wrap">
                    {item.textAnswer || '(No response submitted)'}
                  </p>
                </div>
              )}

              {item.grading?.feedback && (
                <div className="rounded-2xl bg-[#6334E8]/8 border border-[#6334E8]/20 p-3.5 flex items-start gap-2.5">
                  <MessageSquareText className="w-4 h-4 text-[#6334E8] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#17143A]">Host Feedback</p>
                    <p className="text-sm text-[#433E68] mt-0.5 whitespace-pre-wrap">
                      {item.grading.feedback}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
