import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, Clock, Loader2 } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { AssessmentDTO, QuizAnalyticsDTO } from '../../../shared/types.ts';

interface QuizAnalyticsViewProps {
  initialAssessmentId?: string | null;
  refreshTick: number;
}

export function QuizAnalyticsView({ initialAssessmentId, refreshTick }: QuizAnalyticsViewProps) {
  const [quizzes, setQuizzes] = useState<AssessmentDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialAssessmentId || '');
  const [analytics, setAnalytics] = useState<QuizAnalyticsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAssessmentId) setSelectedId(initialAssessmentId);
  }, [initialAssessmentId]);

  useEffect(() => {
    apiRequest<{ assessments: AssessmentDTO[] }>('/host/assessments?type=quiz&limit=50')
      .then((res) => {
        setQuizzes(res.assessments);
        if (!selectedId && res.assessments.length > 0) {
          setSelectedId(res.assessments[0].id);
        } else if (res.assessments.length === 0) {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [refreshTick, selectedId]);

  const loadAnalytics = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ analytics: QuizAnalyticsDTO }>(
        `/host/assessments/${selectedId}/quiz-analytics`
      );
      setAnalytics(res.analytics);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load quiz analytics.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics, refreshTick]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#17143A]">Quiz Analytics</h1>
          <p className="text-sm text-[#64748B] mt-0.5">
            Marks distribution, averages, review completion, and question-level performance.
          </p>
        </div>

        {quizzes.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Select quiz for analytics"
            className="tp-input rounded-xl px-3.5 py-2 text-sm font-semibold text-[#17143A] max-w-xs"
          >
            {quizzes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="tp-surface rounded-2xl p-12 flex items-center justify-center gap-2 text-sm text-[#64748B]">
          <Loader2 className="w-5 h-5 animate-spin text-[#6334E8]" />
          <span>Computing quiz analytics...</span>
        </div>
      ) : !analytics ? (
        <div className="tp-surface rounded-2xl p-12 text-center text-sm text-[#64748B]">
          Create and launch a quiz to view marks analytics here.
        </div>
      ) : (
        <>
          {analytics.isProvisional && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-900">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Provisional statistics:</strong> {analytics.pendingReviewCount} submission(s) still contain ungraded written responses. Averages and score ranges will update once review is complete.
              </span>
            </div>
          )}

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Attempts', value: analytics.attemptCount },
              {
                label: analytics.isProvisional ? 'Average (Provisional)' : 'Average Score',
                value: `${analytics.averageScore} / ${analytics.maxPossibleScore}`,
              },
              { label: 'Highest Score', value: analytics.highestScore },
              { label: 'Lowest Score', value: analytics.lowestScore },
              {
                label: 'Reviewed / Pending',
                value: `${analytics.reviewedCount} / ${analytics.pendingReviewCount}`,
              },
            ].map((k) => (
              <div key={k.label} className="tp-surface tp-glass-tile rounded-2xl p-4">
                <p className="text-xs font-medium text-[#5B617A]">{k.label}</p>
                <p className="font-mono text-2xl font-bold text-[#17143A] mt-1 tabular-nums">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          {/* Score Distribution Chart */}
          <div className="tp-surface rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="font-display font-bold text-base text-[#17143A]">
                Score Distribution
              </h2>
              <p className="text-xs text-[#64748B]">
                Submissions grouped by percentage band ({analytics.privacyMode} mode)
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.distribution} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ECE9FA" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '16px',
                      backgroundColor: 'rgba(255, 255, 255, 0.92)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: '0 12px 28px -12px rgba(45, 27, 118, 0.22)',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Submissions" fill="#6334E8" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Question-level performance table */}
          <div className="tp-surface rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#17143A]/8">
              <h2 className="font-display font-bold text-base text-[#17143A]">
                Question-Level Performance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#17143A]/8 bg-white/55 text-xs font-semibold text-[#5B617A]">
                    <th className="py-3 px-5">Question</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-right">Avg Marks</th>
                    <th className="py-3 px-4 text-right">Accuracy</th>
                    <th className="py-3 px-5 text-right">Pending Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17143A]/8">
                  {analytics.questionStats.map((qs) => (
                    <tr key={qs.questionId} className="hover:bg-white/60 transition-colors">
                      <td className="py-3.5 px-5 font-medium text-[#17143A]">
                        <span className="font-mono text-xs text-[#64748B] mr-2">Q{qs.position + 1}</span>
                        {qs.text}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#64748B] capitalize">
                        {qs.type.replace('_', ' ')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums">
                        {qs.averageAwarded} / {qs.maxPoints}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-semibold text-[#6334E8] tabular-nums">
                        {qs.accuracyRate}%
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-xs tabular-nums">
                        {qs.pendingCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
