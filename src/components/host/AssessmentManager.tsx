import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  Copy,
  Edit3,
  EyeOff,
  Loader2,
  Play,
  Plus,
  QrCode,
  Search,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import type { AssessmentDTO, AssessmentType, SessionDTO } from '../../../shared/types.ts';

interface AssessmentManagerProps {
  type: AssessmentType;
  refreshTick: number;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onReview: (assessment: AssessmentDTO) => void;
  onAnalytics: (assessment: AssessmentDTO) => void;
  onOpenSessionModal: (session: SessionDTO) => void;
}

export function AssessmentManager({
  type,
  refreshTick,
  onCreate,
  onEdit,
  onReview,
  onAnalytics,
  onOpenSessionModal,
}: AssessmentManagerProps) {
  const isQuiz = type === 'quiz';
  const [items, setItems] = useState<AssessmentDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'active' | 'expired'>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AssessmentDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ type, limit: '30' });
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiRequest<{ assessments: AssessmentDTO[]; total: number }>(
        `/host/assessments?${qs.toString()}`
      );
      setItems(res.assessments);
      setTotal(res.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load list.');
    } finally {
      setLoading(false);
    }
  }, [type, statusFilter, search]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const handleLaunch = async (a: AssessmentDTO) => {
    setBusyId(a.id);
    setError(null);
    try {
      const res = await apiRequest<{ session: SessionDTO }>(`/host/assessments/${a.id}/launch`, {
        method: 'POST',
        body: a.type === 'quiz' ? { durationMinutes: a.durationMinutes } : {},
      });
      onOpenSessionModal(res.session);
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to launch session.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (a: AssessmentDTO) => {
    setBusyId(a.id);
    try {
      await apiRequest(`/host/assessments/${a.id}/duplicate`, { method: 'POST' });
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to duplicate.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (a: AssessmentDTO) => {
    setPendingDelete(null);
    setBusyId(a.id);
    try {
      await apiRequest(`/host/assessments/${a.id}`, { method: 'DELETE' });
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">
            {isQuiz ? 'Quiz Generator' : 'Poll Generator'}
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
            {isQuiz
              ? 'Author marks-based quizzes with automatic objective grading, rubrics, and live QR launch.'
              : 'Create vote- and response-based classroom polls with real-time charts and CSV exports.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="tp-gradient-btn text-white inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{isQuiz ? 'New Quiz' : 'New Poll'}</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#5B617A] dark:text-[#A49EC6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${isQuiz ? 'quizzes' : 'polls'} by title...`}
            className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-white/60 dark:bg-[#191237]/75 backdrop-blur-md border border-white/85 dark:border-white/12 rounded-xl self-start shadow-xs">
          {(['all', 'draft', 'active', 'expired'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                statusFilter === st
                  ? 'tp-gradient-btn text-white'
                  : 'text-[#5B617A] dark:text-[#C5BFE4] hover:text-[#17143A] dark:hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {/* List Table */}
      <div className="tp-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-14 rounded-xl bg-[#F4F1FF] dark:bg-white/6 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF]">
              No {isQuiz ? 'quizzes' : 'polls'} found
            </p>
            <p className="text-xs text-[#64748B] dark:text-[#A49EC6] max-w-sm mx-auto">
              Create your first {isQuiz ? 'marks-based quiz' : 'classroom poll'} to generate a unique six-digit entry code and official QR.
            </p>
            <button
              type="button"
              onClick={onCreate}
              className="tp-gradient-btn text-white inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create {isQuiz ? 'Quiz' : 'Poll'}</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#17143A]/8 dark:border-white/10 bg-white/55 dark:bg-white/5 text-xs font-semibold text-[#5B617A] dark:text-[#C5BFE4]">
                  <th className="py-3 px-5">Title & Details</th>
                  <th className="py-3 px-4">Privacy</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Responses</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17143A]/8 dark:divide-white/10 text-sm">
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-white/60 dark:hover:bg-white/6 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-[#17143A] dark:text-[#F4F2FF]">{a.title}</p>
                      <div className="text-xs text-[#64748B] dark:text-[#A49EC6] mt-0.5 flex items-center gap-2 tabular-nums">
                        <span>{a.questionCount ?? 0} questions</span>
                        {isQuiz && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{a.totalPoints ?? 0} marks</span>
                            <span aria-hidden="true">·</span>
                            <span>{a.durationMinutes} min</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B4772] dark:text-[#C5BFE4] capitalize">
                        {a.privacyMode === 'anonymous' ? (
                          <EyeOff className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5 text-[#4F46E5] dark:text-[#A5B4FC]" />
                        )}
                        {a.privacyMode}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold capitalize ${
                          a.status === 'active'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : a.status === 'expired'
                            ? 'text-[#64748B] dark:text-[#8E88B0]'
                            : 'text-[#6334E8] dark:text-[#C4B5FD]'
                        }`}
                      >
                        {a.status === 'active' && a.activeSession
                          ? `Active · ${a.activeSession.joinCode}`
                          : a.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      <span className="font-semibold text-[#17143A] dark:text-[#F4F2FF]">{a.submissionCount ?? 0}</span>
                      {isQuiz && (a.pendingReviewCount ?? 0) > 0 && (
                        <span className="block text-[11px] text-amber-700 dark:text-amber-300">
                          {a.pendingReviewCount} pending
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {a.activeSession ? (
                          <button
                            type="button"
                            onClick={() => onOpenSessionModal(a.activeSession!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-emerald-800 dark:text-emerald-300 border border-transparent dark:border-emerald-400/25 text-xs font-semibold cursor-pointer"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Live QR</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === a.id}
                            onClick={() => void handleLaunch(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F4F1FF] dark:bg-[#8B5CF6]/20 hover:bg-[#E7E0FF] dark:hover:bg-[#8B5CF6]/32 text-[#6334E8] dark:text-[#DDD6FE] text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {busyId === a.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            <span>Launch</span>
                          </button>
                        )}

                        {isQuiz && (
                          <button
                            type="button"
                            onClick={() => onReview(a)}
                            title="Review & grade submissions"
                            className="p-1.5 rounded-lg text-[#4B4772] dark:text-[#C5BFE4] hover:text-[#6334E8] dark:hover:text-[#DDD6FE] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
                          >
                            <CheckSquare className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onAnalytics(a)}
                          title="View analytics"
                          className="p-1.5 rounded-lg text-[#4B4772] dark:text-[#C5BFE4] hover:text-[#6334E8] dark:hover:text-[#DDD6FE] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
                        >
                          <BarChart3 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onEdit(a.id)}
                          title="Edit"
                          className="p-1.5 rounded-lg text-[#4B4772] dark:text-[#C5BFE4] hover:text-[#6334E8] dark:hover:text-[#DDD6FE] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDuplicate(a)}
                          title="Duplicate draft"
                          className="p-1.5 rounded-lg text-[#4B4772] dark:text-[#C5BFE4] hover:text-[#6334E8] dark:hover:text-[#DDD6FE] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
                        >
                          <Copy className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setPendingDelete(a)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-[#94A3B8] dark:text-[#8E88B0] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-[#ECE9FA] dark:border-white/10 text-xs text-[#64748B] dark:text-[#A49EC6] tabular-nums">
              Showing {items.length} of {total} {isQuiz ? 'quizzes' : 'polls'}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${isQuiz ? 'Quiz' : 'Poll'}?`}
        description={
          pendingDelete
            ? `Delete "${pendingDelete.title}" and all associated sessions and responses? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void confirmDelete(pendingDelete);
        }}
      />
    </div>
  );
}
