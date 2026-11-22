import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  UserCheck,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type {
  AssessmentDTO,
  SubmissionDetailDTO,
  SubmissionSummaryDTO,
} from '../../../shared/types.ts';

interface ReviewPanelProps {
  assessment: AssessmentDTO;
  refreshTick: number;
  onBack: () => void;
}

export function ReviewPanel({ assessment, refreshTick, onBack }: ReviewPanelProps) {
  const [submissions, setSubmissions] = useState<SubmissionSummaryDTO[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [gradeInputs, setGradeInputs] = useState<
    Record<string, { awardedPoints: number; feedback: string }>
  >({});

  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await apiRequest<{ submissions: SubmissionSummaryDTO[] }>(
        `/host/assessments/${assessment.id}/submissions?limit=50`
      );
      setSubmissions(res.submissions);
      if (!selectedId && res.submissions.length > 0) {
        setSelectedId(res.submissions[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load submissions.');
    } finally {
      setLoadingList(false);
    }
  }, [assessment.id, selectedId]);

  const loadDetail = useCallback(async (subId: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await apiRequest<{ submission: SubmissionDetailDTO }>(`/host/submissions/${subId}`);
      setDetail(res.submission);
      const nextInputs: Record<string, { awardedPoints: number; feedback: string }> = {};
      for (const item of res.submission.items) {
        nextInputs[item.questionId] = {
          awardedPoints: item.grading?.awardedPoints ?? 0,
          feedback: item.grading?.feedback ?? '',
        };
      }
      setGradeInputs(nextInputs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load submission detail.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, refreshTick]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  const liveDraftTotal = useMemo(() => {
    if (!detail) return 0;
    return detail.items.reduce((sum, item) => {
      const val = gradeInputs[item.questionId]?.awardedPoints ?? item.grading?.awardedPoints ?? 0;
      return sum + Math.min(item.points, Math.max(0, Number(val) || 0));
    }, 0);
  }, [detail, gradeInputs]);

  const handleSaveGrades = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const grades = detail.items.map((item) => {
        const entry = gradeInputs[item.questionId];
        return {
          questionId: item.questionId,
          awardedPoints: Math.min(item.points, Math.max(0, Number(entry?.awardedPoints) || 0)),
          feedback: entry?.feedback?.trim() || null,
        };
      });

      const res = await apiRequest<{ totalScore: number; maxScore: number; status: string }>(
        `/host/submissions/${detail.id}/grades`,
        { method: 'PATCH', body: { grades } }
      );
      setNotice(
        `Saved atomically. Updated score: ${res.totalScore} / ${res.maxScore} (${res.status === 'reviewed' ? 'Reviewed' : 'Pending review'}).`
      );
      await Promise.all([loadList(), loadDetail(detail.id)]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save grading.');
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculateAll = async () => {
    setRecalculating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ recalculatedCount: number }>(
        `/host/assessments/${assessment.id}/recalculate`,
        { method: 'POST', body: { resetManualGrades: false } }
      );
      setNotice(
        `Recalculated objective answers across ${res.recalculatedCount} submission(s). Manually graded written responses were preserved.`
      );
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Recalculation failed.');
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="tp-glass rounded-[26px] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to quizzes"
            className="tp-glass-btn p-2.5 rounded-xl text-[#17143A] dark:text-[#F4F2FF] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs font-medium text-[#433E68] dark:text-[#C5BFE4] flex items-center gap-1.5">
              <span>Submission Review & Grading</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{assessment.privacyMode} mode</span>
            </p>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-[#17143A] dark:text-[#F4F2FF] tracking-tight">
              {assessment.title}
            </h1>
          </div>
        </div>

        <button
          type="button"
          disabled={recalculating}
          onClick={handleRecalculateAll}
          className="tp-glass-btn inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          {recalculating ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
          ) : (
            <RefreshCw className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
          )}
          <span>Recalculate Objective Grades</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-rose-50/90 dark:bg-rose-950/60 backdrop-blur-md border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/55 backdrop-blur-md border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 dark:text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Frosted Submission List */}
        <div className="lg:col-span-4 tp-surface rounded-[24px] overflow-hidden lg:sticky lg:top-[84px]">
          <div className="px-4 py-3.5 border-b border-[#17143A]/8 dark:border-white/10 bg-white/45 dark:bg-white/5 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#17143A] dark:text-[#F4F2FF] tabular-nums">
              Submissions ({submissions.length})
            </span>
            {assessment.privacyMode === 'anonymous' ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#6334E8] dark:text-[#C4B5FD] font-semibold">
                <EyeOff className="w-3 h-3" /> Anonymous IDs only
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#4F46E5] dark:text-[#A5B4FC] font-semibold">
                <UserCheck className="w-3 h-3" /> Student identity
              </span>
            )}
          </div>

          {loadingList ? (
            <div className="p-4 space-y-2.5">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-14 rounded-xl bg-white/50 dark:bg-white/6 animate-pulse" />
              ))}
            </div>
          ) : submissions.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#5B617A] dark:text-[#A49EC6]">
              No submissions recorded for this quiz yet.
            </div>
          ) : (
            <div className="divide-y divide-[#17143A]/8 dark:divide-white/10 max-h-[650px] overflow-y-auto">
              {submissions.map((s) => {
                const active = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(s.id);
                      setNotice(null);
                    }}
                    className={`w-full text-left px-4 py-3.5 transition-all cursor-pointer ${
                      active
                        ? 'bg-[#6334E8]/12 dark:bg-[#8B5CF6]/22 ring-1 ring-inset ring-[#6334E8]/30 dark:ring-[#C4B5FD]/35'
                        : 'hover:bg-white/55 dark:hover:bg-white/6'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-[#17143A] dark:text-[#F4F2FF] truncate">
                        {s.participantLabel}
                      </p>
                      <span className="font-mono text-xs font-bold text-[#6334E8] dark:text-[#C4B5FD] tabular-nums shrink-0">
                        {s.totalScore} / {s.maxScore}
                      </span>
                    </div>
                    {s.participantEmail && (
                      <p className="text-xs text-[#5B617A] dark:text-[#A49EC6] truncate mt-0.5">{s.participantEmail}</p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-[#5B617A] dark:text-[#8E88B0] mt-1.5">
                      <span className="tabular-nums">{new Date(s.submittedAt).toLocaleString()}</span>
                      <span
                        className={`font-semibold flex items-center gap-1 ${
                          s.status === 'pending_review'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {s.status === 'pending_review' && <Clock className="w-3 h-3" />}
                        {s.status === 'pending_review' ? 'Pending' : 'Reviewed'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Grading Detail */}
        <div className="lg:col-span-8 space-y-4">
          {loadingDetail ? (
            <div className="tp-surface rounded-[24px] p-12 flex items-center justify-center gap-2.5 text-sm text-[#433E68] dark:text-[#C5BFE4]">
              <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
              <span>Loading submission answers...</span>
            </div>
          ) : !detail ? (
            <div className="tp-surface rounded-[24px] p-12 text-center text-sm text-[#5B617A] dark:text-[#A49EC6]">
              Select a submission from the left to inspect answers and save marks.
            </div>
          ) : (
            <>
              <div className="tp-surface rounded-[24px] p-5 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#17143A]/8 dark:border-white/10">
                  <div>
                    <h2 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
                      {detail.participantLabel}
                    </h2>
                    <p className="text-xs text-[#5B617A] dark:text-[#A49EC6] mt-0.5">
                      {detail.participantEmail ? `${detail.participantEmail} · ` : ''}
                      Submitted {new Date(detail.submittedAt).toLocaleString()}
                      {detail.autoSubmitted ? ' · Auto-submitted at expiry' : ''}
                    </p>
                  </div>
                  <div className="tp-glass-inset rounded-2xl px-4 py-2.5 text-right">
                    <p className="font-mono text-2xl font-bold text-[#6334E8] dark:text-[#C4B5FD] tabular-nums leading-none">
                      {detail.totalScore} / {detail.maxScore}
                    </p>
                    <p className="text-[11px] font-medium text-[#433E68] dark:text-[#C5BFE4] mt-1">
                      {detail.status === 'pending_review' ? 'Pending manual review' : 'Reviewed'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {detail.items.map((item, idx) => {
                    const entry = gradeInputs[item.questionId] ?? {
                      awardedPoints: item.grading?.awardedPoints ?? 0,
                      feedback: item.grading?.feedback ?? '',
                    };
                    const isWritten = item.type === 'short_answer' || item.type === 'paragraph';

                    return (
                      <div
                        key={item.questionId}
                        className="tp-glass-inset rounded-2xl p-4 sm:p-5 space-y-3.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="font-mono text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD]">
                              Q{idx + 1} · <span className="capitalize text-[#5B617A] dark:text-[#A49EC6] font-sans font-medium">{item.type.replace('_', ' ')}</span>
                            </span>
                            <p className="font-semibold text-sm text-[#17143A] dark:text-[#F4F2FF] mt-0.5">{item.text}</p>
                          </div>
                          <span className="font-mono text-xs text-[#6334E8] dark:text-[#C4B5FD] font-bold shrink-0 tabular-nums">
                            Max {item.points}
                          </span>
                        </div>

                        {!isWritten ? (
                          <div className="space-y-1.5">
                            {item.options.map((o) => {
                              const selected = item.selectedOptionIds.includes(o.id);
                              return (
                                <div
                                  key={o.id}
                                  className={`px-3.5 py-2.5 rounded-xl text-xs border flex items-center justify-between backdrop-blur-sm ${
                                    selected
                                      ? o.isCorrect
                                        ? 'bg-emerald-50/85 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-400/35 text-emerald-950 dark:text-emerald-200 font-semibold'
                                        : 'bg-rose-50/85 dark:bg-rose-950/60 border-rose-200 dark:border-rose-400/35 text-rose-950 dark:text-rose-200 font-semibold'
                                      : o.isCorrect
                                      ? 'bg-emerald-50/45 dark:bg-emerald-950/35 border-emerald-200/80 dark:border-emerald-400/25 text-[#17143A] dark:text-emerald-100'
                                      : 'bg-white/55 dark:bg-white/5 border-white/80 dark:border-white/10 text-[#5B617A] dark:text-[#A49EC6]'
                                  }`}
                                >
                                  <span>{o.label}</span>
                                  <span className="whitespace-nowrap">
                                    {selected ? 'Selected' : ''}
                                    {selected && o.isCorrect ? ' · Correct' : o.isCorrect ? 'Correct key' : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="rounded-xl bg-white/75 dark:bg-[#140E2E]/85 border border-white/90 dark:border-white/12 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] dark:shadow-none">
                              <p className="text-[11px] font-semibold text-[#5B617A] dark:text-[#A49EC6] mb-1">
                                Participant Answer (Immutable)
                              </p>
                              <p className="text-sm text-[#17143A] dark:text-[#F4F2FF] whitespace-pre-wrap leading-relaxed">
                                {item.textAnswer || '(Blank response)'}
                              </p>
                            </div>
                            {item.rubric && (
                              <div className="rounded-xl bg-[#6334E8]/8 dark:bg-[#8B5CF6]/18 border border-[#6334E8]/20 dark:border-[#C4B5FD]/25 p-3.5">
                                <p className="text-[11px] font-semibold text-[#6334E8] dark:text-[#C4B5FD] mb-0.5">
                                  Grading Rubric / Reference Answer
                                </p>
                                <p className="text-xs text-[#433E68] dark:text-[#E5E0FF] whitespace-pre-wrap leading-relaxed">
                                  {item.rubric}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Marks & Feedback Editor */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-3 border-t border-[#17143A]/8 dark:border-white/10">
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-semibold text-[#433E68] dark:text-[#C5BFE4] mb-1">
                              Awarded Marks (0 – {item.points})
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                max={item.points}
                                step="0.5"
                                value={entry.awardedPoints}
                                onChange={(e) =>
                                  setGradeInputs((prev) => ({
                                    ...prev,
                                    [item.questionId]: {
                                      ...entry,
                                      awardedPoints: Math.min(
                                        item.points,
                                        Math.max(0, Number(e.target.value) || 0)
                                      ),
                                    },
                                  }))
                                }
                                className="tp-input w-full rounded-xl px-3 py-1.5 text-sm font-mono tabular-nums text-[#17143A] dark:text-[#F4F2FF]"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setGradeInputs((prev) => ({
                                    ...prev,
                                    [item.questionId]: { ...entry, awardedPoints: item.points },
                                  }))
                                }
                                className="tp-glass-btn px-2.5 py-1.5 rounded-xl text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                              >
                                Full
                              </button>
                            </div>
                          </div>

                          <div className="sm:col-span-8">
                            <label className="block text-[11px] font-semibold text-[#433E68] dark:text-[#C5BFE4] mb-1">
                              Feedback for participant
                            </label>
                            <input
                              type="text"
                              value={entry.feedback}
                              onChange={(e) =>
                                setGradeInputs((prev) => ({
                                  ...prev,
                                  [item.questionId]: { ...entry, feedback: e.target.value },
                                }))
                              }
                              placeholder="Optional grading notes or explanation..."
                              className="tp-input w-full rounded-xl px-3 py-1.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sticky Floating Frosted Grading Save Dock */}
              <div className="sticky bottom-4 z-20 tp-glass rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#433E68] dark:text-[#C5BFE4]">Draft Score Preview</span>
                  <span className="font-mono text-lg font-bold text-[#6334E8] dark:text-[#C4B5FD] tabular-nums">
                    {liveDraftTotal} / {detail.maxScore}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveGrades}
                  className="tp-gradient-btn text-white inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap disabled:opacity-60 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Save Grading & Notify Participant</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
