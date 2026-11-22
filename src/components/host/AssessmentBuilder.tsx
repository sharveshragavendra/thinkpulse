import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import type {
  AssessmentDTO,
  AssessmentType,
  PrivacyMode,
  QuestionDTO,
  QuestionType,
  SessionDTO,
} from '../../../shared/types.ts';

interface AssessmentBuilderProps {
  type: AssessmentType;
  assessmentId?: string | null;
  onBack: () => void;
  onSaved: () => void;
  onLaunched: (session: SessionDTO) => void;
}

function createEmptyQuestion(type: AssessmentType, position: number): QuestionDTO {
  return {
    position,
    type: 'mcq',
    text: '',
    points: type === 'quiz' ? 2 : 0,
    rubric: '',
    settings: { partialCredit: false, required: true },
    options: [
      { position: 0, label: '', isCorrect: type === 'quiz' },
      { position: 1, label: '', isCorrect: false },
    ],
  };
}

export function AssessmentBuilder({
  type,
  assessmentId,
  onBack,
  onSaved,
  onLaunched,
}: AssessmentBuilderProps) {
  const isQuiz = type === 'quiz';
  const [loading, setLoading] = useState(Boolean(assessmentId));
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('normal');
  const [privacyLocked, setPrivacyLocked] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [allowAlias, setAllowAlias] = useState(true);
  const [showMarksToStudents, setShowMarksToStudents] = useState(true);
  const [questions, setQuestions] = useState<QuestionDTO[]>([createEmptyQuestion(type, 0)]);

  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showRecalcBanner, setShowRecalcBanner] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(assessmentId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  useEffect(() => {
    if (!assessmentId) return;
    setLoading(true);
    apiRequest<{ assessment: AssessmentDTO }>(`/host/assessments/${assessmentId}`)
      .then((res) => {
        const a = res.assessment;
        setTitle(a.title);
        setDescription(a.description || '');
        setInstructions(a.instructions || '');
        setPrivacyMode(a.privacyMode);
        setPrivacyLocked(Boolean(a.privacyLocked));
        setDurationMinutes(a.durationMinutes || 15);
        setAllowAlias(a.settings?.allowAlias !== false);
        setShowMarksToStudents(a.settings?.showMarksToStudents !== false);
        setQuestions(
          a.questions && a.questions.length > 0 ? a.questions : [createEmptyQuestion(type, 0)]
        );
        setCurrentId(a.id);
        setDirty(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unable to load assessment.');
      })
      .finally(() => setLoading(false));
  }, [assessmentId, type]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const totalMarks = useMemo(
    () => (isQuiz ? questions.reduce((acc, q) => acc + (Number(q.points) || 0), 0) : 0),
    [isQuiz, questions]
  );

  const validateLocal = (): string | null => {
    if (title.trim().length < 2) return 'Enter a title (at least 2 characters).';
    if (questions.length === 0) return 'Add at least one question.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text.trim()) return `Question ${i + 1} needs question text.`;
      if (isQuiz && (Number.isNaN(q.points) || q.points < 0)) {
        return `Question ${i + 1} cannot have negative marks.`;
      }
      if (q.type === 'mcq' || q.type === 'multi_select') {
        if (q.options.length < 2) return `Question ${i + 1} must have at least 2 options.`;
        if (q.options.some((o) => !o.label.trim())) {
          return `All options in Question ${i + 1} must have labels.`;
        }
        if (isQuiz && !q.options.some((o) => o.isCorrect)) {
          return `Question ${i + 1} must mark at least one correct option.`;
        }
      }
    }
    return null;
  };

  const buildPayload = () => ({
    type,
    title: title.trim(),
    description: description.trim(),
    instructions: instructions.trim(),
    privacyMode,
    ...(isQuiz
      ? { durationMinutes: Math.max(1, Math.min(480, Number(durationMinutes) || 15)) }
      : {}),
    settings: {
      allowAlias,
      showMarksToStudents: isQuiz ? showMarksToStudents : false,
      partialCreditDefault: 'none' as const,
    },
    questions: questions.map((q, idx) => ({
      ...(q.id ? { id: q.id } : {}),
      type: q.type,
      text: q.text.trim(),
      points: isQuiz ? Math.max(0, Number(q.points) || 0) : 0,
      rubric: isQuiz ? q.rubric?.trim() || null : null,
      settings: {
        partialCredit: isQuiz && q.type === 'multi_select' ? Boolean(q.settings?.partialCredit) : false,
        required: q.settings?.required !== false,
      },
      options:
        q.type === 'mcq' || q.type === 'multi_select'
          ? q.options.map((o) => ({
              ...(o.id ? { id: o.id } : {}),
              label: o.label.trim(),
              isCorrect: isQuiz ? Boolean(o.isCorrect) : false,
            }))
          : [],
    })),
  });

  const handleSave = async (): Promise<string | null> => {
    setError(null);
    setNotice(null);
    const localErr = validateLocal();
    if (localErr) {
      setError(localErr);
      return null;
    }

    setSaving(true);
    try {
      const body = buildPayload();
      if (currentId) {
        const res = await apiRequest<{
          id: string;
          recalculationRecommended?: boolean;
        }>(`/host/assessments/${currentId}`, { method: 'PATCH', body });
        setDirty(false);
        setNotice(`${isQuiz ? 'Quiz' : 'Poll'} saved successfully.`);
        if (res.recalculationRecommended) {
          setShowRecalcBanner(true);
        }
        onSaved();
        return res.id;
      } else {
        const res = await apiRequest<{ id: string }>('/host/assessments', {
          method: 'POST',
          body,
        });
        setCurrentId(res.id);
        setDirty(false);
        setNotice(`${isQuiz ? 'Quiz' : 'Poll'} created.`);
        onSaved();
        return res.id;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndLaunch = async () => {
    const id = await handleSave();
    if (!id) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await apiRequest<{ session: SessionDTO }>(`/host/assessments/${id}/launch`, {
        method: 'POST',
        body: isQuiz ? { durationMinutes } : {},
      });
      onLaunched(res.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to launch session.');
    } finally {
      setLaunching(false);
    }
  };

  const handleRecalculate = async () => {
    if (!currentId) return;
    setRecalculating(true);
    setError(null);
    try {
      const res = await apiRequest<{ recalculatedCount: number }>(
        `/host/assessments/${currentId}/recalculate`,
        { method: 'POST', body: { resetManualGrades: false } }
      );
      setShowRecalcBanner(false);
      setNotice(
        `Recalculated objective grades across ${res.recalculatedCount} submission(s). Manually graded written responses were preserved.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Recalculation failed.');
    } finally {
      setRecalculating(false);
    }
  };

  const updateQuestion = (idx: number, patch: Partial<QuestionDTO>) => {
    setDirty(true);
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== idx) return q;
        const next = { ...q, ...patch };
        if (
          (next.type === 'mcq' || next.type === 'multi_select') &&
          next.options.length < 2
        ) {
          next.options = [
            { position: 0, label: '', isCorrect: isQuiz },
            { position: 1, label: '', isCorrect: false },
          ];
        }
        return next;
      })
    );
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    setDirty(true);
    setQuestions((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy.map((q, i) => ({ ...q, position: i }));
    });
  };

  const removeQuestion = (idx: number) => {
    if (questions.length <= 1) return;
    setDirty(true);
    setQuestions((prev) => prev.filter((_, i) => i !== idx).map((q, i) => ({ ...q, position: i })));
  };

  const handleBackClick = () => {
    if (dirty) {
      setConfirmLeaveOpen(true);
      return;
    }
    onBack();
  };

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
        <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
        <span>Loading {isQuiz ? 'quiz' : 'poll'} editor...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Sticky Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBackClick}
            className="tp-glass-btn p-2 rounded-xl text-[#17143A] dark:text-[#F4F2FF] cursor-pointer"
            aria-label="Back to list"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-[#17143A] dark:text-[#F4F2FF]">
              {currentId ? `Edit ${isQuiz ? 'Quiz' : 'Poll'}` : `Create ${isQuiz ? 'Quiz' : 'Poll'}`}
            </h1>
            <div className="flex items-center gap-2 text-xs text-[#64748B] dark:text-[#A49EC6] mt-0.5 tabular-nums">
              <span>{questions.length} {questions.length === 1 ? 'question' : 'questions'}</span>
              {isQuiz && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-semibold text-[#6334E8] dark:text-[#C4B5FD]">{totalMarks} total marks</span>
                </>
              )}
              {!isQuiz && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Vote & response mode (no marks)</span>
                </>
              )}
              {dirty && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-amber-700 dark:text-amber-300 font-medium">Unsaved changes</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="tp-glass-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] cursor-pointer"
          >
            <Eye className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
            <span>Preview Student View</span>
          </button>
          <button
            type="button"
            disabled={saving || launching}
            onClick={() => void handleSave()}
            className="tp-glass-btn inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />}
            <span>Save Draft</span>
          </button>
          <button
            type="button"
            disabled={saving || launching}
            onClick={() => void handleSaveAndLaunch()}
            className="tp-gradient-btn text-white inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-60 cursor-pointer"
          >
            {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>Save & Launch</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/55 border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {showRecalcBanner && isQuiz && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/55 border border-amber-200 dark:border-amber-400/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold">Answer key updated on a quiz with existing submissions</p>
            <p className="text-xs mt-0.5">
              Recalculate objective scores atomically now? Manually graded written responses will be preserved.
            </p>
          </div>
          <button
            type="button"
            disabled={recalculating}
            onClick={handleRecalculate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            {recalculating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>Recalculate All Submissions</span>
          </button>
        </div>
      )}

      {/* Configuration Surface */}
      <div className="tp-surface rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1.5">
                {isQuiz ? 'Quiz Title' : 'Poll Title'} *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                placeholder={isQuiz ? 'e.g., Week 6 Relational Databases Quiz' : 'e.g., Lecture Pace & Topic Feedback Poll'}
                className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1.5">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Short context shown to students before joining..."
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1.5">
                  Instructions (optional)
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => {
                    setInstructions(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="Any rules, time guidance, or rubric notes..."
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-4">
            {/* Explicit Privacy Mode Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF]">Privacy Mode *</label>
                {privacyLocked && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    <Lock className="w-3 h-3" />
                    Locked after submission
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={privacyLocked}
                  onClick={() => {
                    setPrivacyMode('normal');
                    setDirty(true);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                    privacyMode === 'normal'
                      ? 'bg-[#F4F1FF] dark:bg-[#8B5CF6]/22 border-[#6334E8] dark:border-[#A78BFA] text-[#17143A] dark:text-[#F4F2FF]'
                      : 'bg-white dark:bg-[#171133]/75 border-[#DDD9F5] dark:border-white/12 text-[#64748B] dark:text-[#A49EC6]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <UserCheck className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                    <span>Normal</span>
                  </div>
                  <p className="text-[11px] mt-1 leading-tight">Linked to student profile</p>
                </button>
                <button
                  type="button"
                  disabled={privacyLocked}
                  onClick={() => {
                    setPrivacyMode('anonymous');
                    setDirty(true);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                    privacyMode === 'anonymous'
                      ? 'bg-[#F4F1FF] dark:bg-[#8B5CF6]/22 border-[#6334E8] dark:border-[#A78BFA] text-[#17143A] dark:text-[#F4F2FF]'
                      : 'bg-white dark:bg-[#171133]/75 border-[#DDD9F5] dark:border-white/12 text-[#64748B] dark:text-[#A49EC6]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <EyeOff className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                    <span>Anonymous</span>
                  </div>
                  <p className="text-[11px] mt-1 leading-tight">Hidden from host & exports</p>
                </button>
              </div>
            </div>

            {isQuiz ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={durationMinutes}
                    onChange={(e) => {
                      setDurationMinutes(Math.max(1, Number(e.target.value) || 1));
                      setDirty(true);
                    }}
                    className="tp-input w-full rounded-xl px-3 py-2 text-sm font-mono tabular-nums text-[#17143A] dark:text-[#F4F2FF]"
                  />
                </div>

                <div className="flex flex-col justify-end space-y-2 pb-1">
                  {privacyMode === 'anonymous' && (
                    <label className="inline-flex items-center gap-2 text-xs text-[#17143A] dark:text-[#E5E0FF] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowAlias}
                        onChange={(e) => {
                          setAllowAlias(e.target.checked);
                          setDirty(true);
                        }}
                        className="rounded border-[#DDD9F5] dark:border-white/25 text-[#6334E8] accent-[#7C3AED]"
                      />
                      <span>Allow optional alias</span>
                    </label>
                  )}
                  <label className="inline-flex items-center gap-2 text-xs text-[#17143A] dark:text-[#E5E0FF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showMarksToStudents}
                      onChange={(e) => {
                        setShowMarksToStudents(e.target.checked);
                        setDirty(true);
                      }}
                      className="rounded border-[#DDD9F5] dark:border-white/25 text-[#6334E8] accent-[#7C3AED]"
                    />
                    <span>Show per-question marks</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                {privacyMode === 'anonymous' && (
                  <label className="inline-flex items-center gap-2 text-xs text-[#17143A] dark:text-[#E5E0FF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowAlias}
                      onChange={(e) => {
                        setAllowAlias(e.target.checked);
                        setDirty(true);
                      }}
                      className="rounded border-[#DDD9F5] dark:border-white/25 text-[#6334E8] accent-[#7C3AED]"
                    />
                    <span>Allow optional alias</span>
                  </label>
                )}
                <p className="text-[11px] text-[#55587D] dark:text-[#A49EC6]">
                  Polls stay open until you manually end the live session.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Questions Editor */}
      <div className="space-y-4">
        {questions.map((q, idx) => (
          <div key={idx} className="tp-surface rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#ECE9FA] dark:border-white/10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs font-bold text-[#6334E8] dark:text-[#C4B5FD]">Question {idx + 1}</span>
                <select
                  value={q.type}
                  onChange={(e) => updateQuestion(idx, { type: e.target.value as QuestionType })}
                  className="tp-input rounded-xl px-3 py-1.5 text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF]"
                >
                  <option value="mcq">{isQuiz ? 'Multiple Choice (MCQ)' : 'Single-Choice Poll'}</option>
                  <option value="multi_select">Multiple Select</option>
                  <option value="short_answer">Short Text Response</option>
                  <option value="paragraph">Paragraph Response</option>
                </select>

                {isQuiz && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-[#64748B] dark:text-[#A49EC6]">Marks:</label>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={q.points}
                      onChange={(e) =>
                        updateQuestion(idx, { points: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="tp-input w-20 rounded-xl px-2.5 py-1 text-xs font-mono tabular-nums text-[#17143A] dark:text-[#F4F2FF]"
                    />
                  </div>
                )}

                {isQuiz && q.type === 'multi_select' && (
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#4B4772] dark:text-[#C5BFE4] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(q.settings?.partialCredit)}
                      onChange={(e) =>
                        updateQuestion(idx, {
                          settings: { ...q.settings, partialCredit: e.target.checked },
                        })
                      }
                      className="accent-[#7C3AED]"
                    />
                    <span>Partial credit</span>
                  </label>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveQuestion(idx, -1)}
                  aria-label="Move question up"
                  className="p-1.5 rounded-lg text-[#64748B] dark:text-[#A49EC6] hover:text-[#17143A] dark:hover:text-white hover:bg-[#F4F1FF] dark:hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={idx === questions.length - 1}
                  onClick={() => moveQuestion(idx, 1)}
                  aria-label="Move question down"
                  className="p-1.5 rounded-lg text-[#64748B] dark:text-[#A49EC6] hover:text-[#17143A] dark:hover:text-white hover:bg-[#F4F1FF] dark:hover:bg-white/10 disabled:opacity-35 cursor-pointer"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={questions.length <= 1}
                  onClick={() => removeQuestion(idx)}
                  aria-label="Delete question"
                  className="p-1.5 rounded-lg text-[#64748B] dark:text-[#A49EC6] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 disabled:opacity-35 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <input
                type="text"
                value={q.text}
                onChange={(e) => updateQuestion(idx, { text: e.target.value })}
                placeholder="Enter your question prompt..."
                className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>

            {(q.type === 'mcq' || q.type === 'multi_select') && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-[#64748B] dark:text-[#A49EC6]">
                    {isQuiz
                      ? q.type === 'mcq'
                        ? 'Options — mark the correct option(s)'
                        : 'Options — select all correct answers'
                      : 'Poll Options (no correct answers)'}
                  </p>
                </div>

                {q.options.map((opt, oIdx) => (
                  <div key={oIdx} className="flex items-center gap-2.5">
                    {isQuiz && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextOpts = q.options.map((o, i) => {
                            if (q.type === 'mcq') {
                              return { ...o, isCorrect: i === oIdx };
                            }
                            return i === oIdx ? { ...o, isCorrect: !o.isCorrect } : o;
                          });
                          updateQuestion(idx, { options: nextOpts });
                        }}
                        aria-label={`Mark option ${oIdx + 1} as correct`}
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          opt.isCorrect
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white dark:bg-[#171133] border-[#CBD5E1] dark:border-white/20 text-transparent hover:border-[#6334E8] dark:hover:border-[#A78BFA]'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    )}

                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => {
                        const nextOpts = q.options.map((o, i) =>
                          i === oIdx ? { ...o, label: e.target.value } : o
                        );
                        updateQuestion(idx, { options: nextOpts });
                      }}
                      placeholder={`Option ${oIdx + 1}`}
                      className="tp-input flex-1 rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                    />

                    <button
                      type="button"
                      disabled={q.options.length <= 2}
                      onClick={() => {
                        const nextOpts = q.options
                          .filter((_, i) => i !== oIdx)
                          .map((o, i) => ({ ...o, position: i }));
                        updateQuestion(idx, { options: nextOpts });
                      }}
                      aria-label="Remove option"
                      className="p-2 rounded-lg text-[#94A3B8] dark:text-[#8E88B0] hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {q.options.length < 12 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateQuestion(idx, {
                        options: [
                          ...q.options,
                          { position: q.options.length, label: '', isCorrect: false },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD] hover:text-[#4F46E5] dark:hover:text-[#DDD6FE] pt-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Option</span>
                  </button>
                )}
              </div>
            )}

            {isQuiz && (q.type === 'short_answer' || q.type === 'paragraph') && (
              <div>
                <label className="block text-xs font-medium text-[#64748B] dark:text-[#A49EC6] mb-1">
                  Reference answer / Grading rubric (visible only to hosts during review)
                </label>
                <textarea
                  rows={2}
                  value={q.rubric || ''}
                  onChange={(e) => updateQuestion(idx, { rubric: e.target.value })}
                  placeholder="Key points expected for full marks..."
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setDirty(true);
            setQuestions((prev) => [...prev, createEmptyQuestion(type, prev.length)]);
          }}
          className="w-full py-3.5 rounded-2xl border-2 border-dashed border-[#C7BDF2] dark:border-[#A78BFA]/35 hover:border-[#6334E8] dark:hover:border-[#C4B5FD] bg-white/60 dark:bg-[#191237]/50 hover:bg-white dark:hover:bg-[#23194D]/75 text-sm font-semibold text-[#6334E8] dark:text-[#C4B5FD] flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Question</span>
        </button>
      </div>

      {/* Student Preview Modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/50 dark:bg-black/75 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-[30px] tp-modal-glass">
            <div className="sticky top-0 tp-glass-bar px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD]">Student View Preview</p>
                <h3 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
                  {title || `Untitled ${isQuiz ? 'Quiz' : 'Poll'}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="p-2 rounded-xl text-[#4B4772] dark:text-[#C5BFE4] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {description && <p className="text-sm text-[#4B4772] dark:text-[#C5BFE4]">{description}</p>}
              {questions.map((q, i) => (
                <div key={i} className="bg-white dark:bg-[#171133]/85 rounded-2xl border border-[#DDD9F5] dark:border-white/12 p-5 space-y-3">
                  <div className="flex justify-between gap-3">
                    <p className="font-semibold text-sm text-[#17143A] dark:text-[#F4F2FF]">
                      {i + 1}. {q.text || '(Question text empty)'}
                    </p>
                    {isQuiz && showMarksToStudents && (
                      <span className="font-mono text-xs text-[#6334E8] dark:text-[#C4B5FD] shrink-0">
                        {q.points} marks
                      </span>
                    )}
                  </div>
                  {(q.type === 'mcq' || q.type === 'multi_select') ? (
                    <div className="space-y-2">
                      {q.options.map((o, oi) => (
                        <div
                          key={oi}
                          className="px-3.5 py-2 rounded-xl border border-[#ECE9FA] dark:border-white/10 bg-white/70 dark:bg-white/5 text-sm text-[#4B4772] dark:text-[#E5E0FF]"
                        >
                          {o.label || `(Option ${oi + 1})`}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-12 rounded-xl border border-[#ECE9FA] dark:border-white/10 bg-[#FAF9FF] dark:bg-white/5 px-3 py-2 text-xs text-[#94A3B8] dark:text-[#8E88B0]">
                      Student written response field
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmLeaveOpen}
        title="Unsaved Changes"
        description="You have unsaved changes in this editor. Leave without saving?"
        confirmLabel="Leave Editor"
        cancelLabel="Stay & Edit"
        tone="danger"
        onCancel={() => setConfirmLeaveOpen(false)}
        onConfirm={() => {
          setConfirmLeaveOpen(false);
          onBack();
        }}
      />
    </div>
  );
}
