import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, Download, EyeOff, Loader2, UserCheck } from 'lucide-react';
import { apiRequest, downloadAuthenticatedCsv } from '../../services/api.ts';
import { useTheme } from '../../context/ThemeContext.tsx';
import type { AssessmentDTO, PollAnalyticsDTO } from '../../../shared/types.ts';

interface PollAnalyticsViewProps {
  initialAssessmentId?: string | null;
  refreshTick: number;
}

const CHART_COLORS = ['#7C3AED', '#6366F1', '#A855F7', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899'];

export function PollAnalyticsView({ initialAssessmentId, refreshTick }: PollAnalyticsViewProps) {
  const { isDark } = useTheme();
  const [polls, setPolls] = useState<AssessmentDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string>(initialAssessmentId || '');
  const [analytics, setAnalytics] = useState<PollAnalyticsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAssessmentId) setSelectedId(initialAssessmentId);
  }, [initialAssessmentId]);

  useEffect(() => {
    apiRequest<{ assessments: AssessmentDTO[] }>('/host/assessments?type=poll&limit=50')
      .then((res) => {
        setPolls(res.assessments);
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
      const res = await apiRequest<{ analytics: PollAnalyticsDTO }>(
        `/host/assessments/${selectedId}/poll-results`
      );
      setAnalytics(res.analytics);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load poll results.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics, refreshTick]);

  const handleExportCsv = async () => {
    if (!selectedId || !analytics) return;
    setExporting(true);
    try {
      await downloadAuthenticatedCsv(
        `/host/assessments/${selectedId}/poll-export`,
        `poll_report_${analytics.privacyMode}.csv`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  const tooltipStyles = {
    borderRadius: '16px',
    backgroundColor: isDark ? 'rgba(20, 14, 44, 0.96)' : 'rgba(255, 255, 255, 0.92)',
    backdropFilter: 'blur(12px)',
    border: isDark ? '1px solid rgba(216, 200, 255, 0.22)' : '1px solid rgba(255, 255, 255, 0.9)',
    boxShadow: isDark
      ? '0 14px 32px -10px rgba(0, 0, 0, 0.65)'
      : '0 12px 28px -12px rgba(45, 27, 118, 0.22)',
    color: isDark ? '#F4F2FF' : '#17143A',
    fontSize: '12px',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">Poll Analytics</h1>
          <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
            Live vote counts, respondent percentages, selection-share breakdowns, and text responses.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {polls.length > 0 && (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Select poll"
              className="tp-input rounded-xl px-3.5 py-2 text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF] max-w-xs"
            >
              {polls.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          {analytics && (
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportCsv}
              className="tp-glass-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] cursor-pointer disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />}
              <span>Export CSV</span>
            </button>
          )}
        </div>
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
          <span>Loading live poll votes...</span>
        </div>
      ) : !analytics ? (
        <div className="tp-surface rounded-2xl p-12 text-center text-sm text-[#64748B] dark:text-[#A49EC6]">
          Create and launch a poll to inspect live vote distributions here.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top Poll Summary */}
          <div className="tp-surface rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">{analytics.title}</h2>
              <p className="text-xs text-[#64748B] dark:text-[#A49EC6] flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 capitalize font-medium text-[#4B4772] dark:text-[#C5BFE4]">
                  {analytics.privacyMode === 'anonymous' ? (
                    <EyeOff className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5 text-[#4F46E5] dark:text-[#A5B4FC]" />
                  )}
                  {analytics.privacyMode} mode
                </span>
                <span>·</span>
                <span>{analytics.questions.length} poll questions</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">Total Unique Respondents</p>
              <p className="font-mono text-3xl font-bold text-[#6334E8] dark:text-[#C4B5FD] tabular-nums">
                {analytics.totalUniqueRespondents}
              </p>
            </div>
          </div>

          {/* Per-Question Numerical + Graphical Vote Breakdown */}
          {analytics.questions.map((q) => {
            const isChoice = q.type === 'mcq' || q.type === 'multi_select';
            const isMulti = q.type === 'multi_select';

            return (
              <div key={q.questionId} className="tp-surface rounded-2xl p-6 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ECE9FA] dark:border-white/10 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B] dark:text-[#A49EC6]">
                      <span className="font-mono">Q{q.position + 1}</span>
                      <span>·</span>
                      <span>
                        {q.type === 'mcq'
                          ? 'Single-Choice Poll'
                          : q.type === 'multi_select'
                          ? 'Multiple-Select Poll'
                          : 'Free-Text Poll'}
                      </span>
                      <span>·</span>
                      <span className="tabular-nums">{q.respondentCount} respondents</span>
                      <span>·</span>
                      <span className="tabular-nums">{q.noResponseCount} no response</span>
                    </div>
                    <h3 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF] mt-1">
                      {q.text}
                    </h3>
                  </div>

                  {isChoice && q.topOptionLabels.length > 0 && (
                    <div className="text-right text-xs">
                      <span className="text-[#64748B] dark:text-[#A49EC6]">{q.hasTie ? 'Tied Top Options' : 'Top Option'}</span>
                      <p className="font-semibold text-[#6334E8] dark:text-[#C4B5FD] mt-0.5">
                        {q.topOptionLabels.join(' / ')}
                      </p>
                    </div>
                  )}
                </div>

                {isChoice ? (
                  <>
                    {isMulti && (
                      <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">
                        Multiple-select question ({q.totalSelections} total selections): Respondent % may sum above 100%; Selection Share % reflects each option’s share of all selections cast.
                      </p>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                      {/* Horizontal Bar Chart */}
                      <div className={q.type === 'mcq' ? 'lg:col-span-7 h-60' : 'lg:col-span-12 h-60'}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={q.options}
                            layout="vertical"
                            margin={{ top: 4, right: 24, left: 10, bottom: 4 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke={isDark ? 'rgba(216, 200, 255, 0.14)' : '#ECE9FA'}
                              horizontal={false}
                            />
                            <XAxis
                              type="number"
                              allowDecimals={false}
                              tick={{ fontSize: 12, fill: isDark ? '#C5BFE4' : '#64748B' }}
                            />
                            <YAxis
                              type="category"
                              dataKey="label"
                              width={140}
                              tick={{ fontSize: 12, fill: isDark ? '#F4F2FF' : '#17143A' }}
                            />
                            <Tooltip
                              cursor={{ fill: isDark ? 'rgba(139, 92, 246, 0.12)' : 'rgba(124, 58, 237, 0.08)' }}
                              contentStyle={tooltipStyles}
                              itemStyle={{ color: isDark ? '#DDD6FE' : '#4B4772' }}
                              labelStyle={{ color: isDark ? '#F4F2FF' : '#17143A', fontWeight: 600 }}
                            />
                            <Bar dataKey="votes" name="Votes" radius={[0, 8, 8, 0]}>
                              {q.options.map((o, i) => (
                                <Cell key={o.optionId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Donut Chart for Single-Choice */}
                      {q.type === 'mcq' && q.totalSelections > 0 && (
                        <div className="lg:col-span-5 h-60">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={q.options}
                                dataKey="votes"
                                nameKey="label"
                                innerRadius={52}
                                outerRadius={86}
                                paddingAngle={3}
                              >
                                {q.options.map((o, i) => (
                                  <Cell key={o.optionId} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={tooltipStyles}
                                itemStyle={{ color: isDark ? '#DDD6FE' : '#4B4772' }}
                                labelStyle={{ color: isDark ? '#F4F2FF' : '#17143A', fontWeight: 600 }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Numerical Option Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#ECE9FA] dark:border-white/10 text-[#64748B] dark:text-[#C5BFE4]">
                            <th className="py-2 pr-4 font-semibold">Option</th>
                            <th className="py-2 px-3 text-right font-semibold">Votes / Selections</th>
                            <th className="py-2 px-3 text-right font-semibold">Respondent %</th>
                            {isMulti && (
                              <th className="py-2 pl-3 text-right font-semibold">Selection Share %</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ECE9FA] dark:divide-white/10">
                          {q.options.map((opt) => (
                            <tr key={opt.optionId}>
                              <td className="py-2.5 pr-4 font-medium text-[#17143A] dark:text-[#F4F2FF]">
                                {opt.label}
                                {opt.isTop && (
                                  <span className="ml-2 text-[11px] font-semibold text-[#6334E8] dark:text-[#C4B5FD]">
                                    {q.hasTie ? 'Tied Lead' : 'Top'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-[#17143A] dark:text-[#F4F2FF] tabular-nums">
                                {opt.votes}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-[#17143A] dark:text-[#E5E0FF] tabular-nums">
                                {opt.respondentPercentage}%
                              </td>
                              {isMulti && (
                                <td className="py-2.5 pl-3 text-right font-mono text-[#6334E8] dark:text-[#C4B5FD] tabular-nums">
                                  {opt.selectionSharePercentage}%
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2.5">
                    {q.textResponses.length === 0 ? (
                      <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">No written responses submitted yet.</p>
                    ) : (
                      q.textResponses.map((tr, i) => (
                        <div
                          key={i}
                          className="rounded-2xl bg-white/65 dark:bg-white/6 border border-white/90 dark:border-white/10 px-4 py-3 space-y-1"
                        >
                          <p className="text-sm text-[#17143A] dark:text-[#F4F2FF] whitespace-pre-wrap">{tr.text}</p>
                          <div className="text-[11px] text-[#64748B] dark:text-[#A49EC6] flex items-center gap-2">
                            <span className="font-mono">{tr.participantLabel}</span>
                            <span>·</span>
                            <span className="tabular-nums">
                              {new Date(tr.submittedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
