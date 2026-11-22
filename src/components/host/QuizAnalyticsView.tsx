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
import { useTheme } from '../../context/ThemeContext.tsx';
import type { AssessmentDTO, QuizAnalyticsDTO } from '../../../shared/types.ts';

interface QuizAnalyticsViewProps {
  initialAssessmentId?: string | null;
  refreshTick: number;
}

export function QuizAnalyticsView({ initialAssessmentId, refreshTick }: QuizAnalyticsViewProps) {
  const { isDark } = useTheme();
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
          <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">Quiz Analytics</h1>
          <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
            Marks distribution, averages, review completion, and question-level performance.
          </p>
        </div>

        {quizzes.length > 0 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="Select quiz for analytics"
            className="tp-input rounded-xl px-3.5 py-2 text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF] max-w-xs"
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
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="tp-surface rounded-2xl p-12 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
          <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
          <span>Computing quiz analytics...</span>
        </div>
      ) : !analytics ? (
        <div className="tp-surface rounded-2xl p-12 text-center text-sm text-[#64748B] dark:text-[#A49EC6]">
          Create and launch a quiz to view marks analytics here.
        </div>
      ) : (
        <>
          {analytics.isProvisional && (
            <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/55 border border-amber-200 dark:border-amber-400/30 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-900 dark:text-amber-200">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
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
                <p className="text-xs font-medium text-[#5B617A] dark:text-[#A49EC6]">{k.label}</p>
                <p className="font-mono text-2xl font-bold text-[#17143A] dark:text-[#F4F2FF] mt-1 tabular-nums">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          {/* Score Distribution Chart */}
          <div className="tp-surface rounded-2xl p-6 space-y-4">
            <div>
              <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">
                Score Distribution
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">
                Submissions grouped by percentage band ({analytics.privacyMode} mode)
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.distribution} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? 'rgba(216, 200, 255, 0.14)' : '#ECE9FA'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 12, fill: isDark ? '#C5BFE4' : '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: isDark ? '#C5BFE4' : '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: isDark ? 'rgba(139, 92, 246, 0.12)' : 'rgba(124, 58, 237, 0.08)' }}
                    contentStyle={{
                      borderRadius: '16px',
                      backgroundColor: isDark ? 'rgba(20, 14, 44, 0.96)' : 'rgba(255, 255, 255, 0.92)',
                      backdropFilter: 'blur(12px)',
                      border: isDark ? '1px solid rgba(216, 200, 255, 0.22)' : '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: isDark
                        ? '0 14px 32px -10px rgba(0, 0, 0, 0.65)'
                        : '0 12px 28px -12px rgba(45, 27, 118, 0.22)',
                      color: isDark ? '#F4F2FF' : '#17143A',
                      fontSize: '12px',
                    }}
                    itemStyle={{ color: isDark ? '#DDD6FE' : '#4B4772' }}
                    labelStyle={{ color: isDark ? '#F4F2FF' : '#17143A', fontWeight: 600 }}
                  />
                  <Bar
                    dataKey="count"
                    name="Submissions"
                    fill={isDark ? '#8B5CF6' : '#6334E8'}
                    radius={[10, 10, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Question-level performance table */}
          <div className="tp-surface rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#17143A]/8 dark:border-white/10">
              <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">
                Question-Level Performance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#17143A]/8 dark:border-white/10 bg-white/55 dark:bg-white/5 text-xs font-semibold text-[#5B617A] dark:text-[#C5BFE4]">
                    <th className="py-3 px-5">Question</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-right">Avg Marks</th>
                    <th className="py-3 px-4 text-right">Accuracy</th>
                    <th className="py-3 px-5 text-right">Pending Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17143A]/8 dark:divide-white/10">
                  {analytics.questionStats.map((qs) => (
                    <tr key={qs.questionId} className="hover:bg-white/60 dark:hover:bg-white/6 transition-colors">
                      <td className="py-3.5 px-5 font-medium text-[#17143A] dark:text-[#F4F2FF]">
                        <span className="font-mono text-xs text-[#64748B] dark:text-[#A49EC6] mr-2">Q{qs.position + 1}</span>
                        {qs.text}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#64748B] dark:text-[#A49EC6] capitalize">
                        {qs.type.replace('_', ' ')}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-[#17143A] dark:text-[#E5E0FF] tabular-nums">
                        {qs.averageAwarded} / {qs.maxPoints}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD] tabular-nums">
                        {qs.accuracyRate}%
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono text-xs text-[#17143A] dark:text-[#E5E0FF] tabular-nums">
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
