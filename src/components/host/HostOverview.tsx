import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CloudUpload,
  Copy,
  EyeOff,
  PieChart,
  Plus,
  QrCode,
  Radio,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { HostOverviewDTO, SessionDTO } from '../../../shared/types.ts';

interface HostOverviewProps {
  refreshTick: number;
  onNavigate: (tab: string) => void;
  onOpenSessionModal: (session: SessionDTO) => void;
  onQuickCreate: (type: 'quiz' | 'poll') => void;
}

export function HostOverview({
  refreshTick,
  onNavigate,
  onOpenSessionModal,
  onQuickCreate,
}: HostOverviewProps) {
  const [data, setData] = useState<HostOverviewDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest<HostOverviewDTO>('/host/overview');
      setData(res);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load overview metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const handleCopyCode = async (session: SessionDTO) => {
    try {
      await navigator.clipboard.writeText(session.joinCode);
      setCopiedId(session.id);
      setTimeout(() => setCopiedId((curr) => (curr === session.id ? null : curr)), 1600);
    } catch {
      // ignore clipboard restriction
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-40 rounded-[28px] tp-glass animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-36 rounded-[24px] tp-surface animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 h-72 rounded-[28px] tp-surface animate-pulse" />
          <div className="lg:col-span-5 h-72 rounded-[28px] tp-surface animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        role="alert"
        className="rounded-[24px] bg-rose-50/90 backdrop-blur-md border border-rose-200 p-5 text-sm text-rose-800 flex items-center gap-2.5"
      >
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span>{error || 'Overview unavailable.'}</span>
      </div>
    );
  }

  const kpis = [
    { label: 'Total Students', value: data.metrics.totalStudents, tab: 'students', icon: Users },
    { label: 'Quizzes', value: data.metrics.totalQuizzes, tab: 'quizzes', icon: ClipboardList },
    { label: 'Polls', value: data.metrics.totalPolls, tab: 'polls', icon: PieChart },
    { label: 'Active Sessions', value: data.metrics.activeSessions, tab: 'live', icon: Radio },
    { label: 'Submissions', value: data.metrics.totalSubmissions, tab: 'history', icon: CloudUpload },
    { label: 'Pending Reviews', value: data.metrics.pendingReviews, tab: 'quizzes', icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-5">
      {/* Hero Purple Liquid-Glass Command Banner */}
      <section className="tp-glass rounded-[28px] px-6 py-6 sm:px-8 sm:py-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative overflow-hidden">
        {/* Internal luminous diagonal glass highlight matching reference */}
        <div
          className="pointer-events-none absolute -right-12 -top-16 w-80 h-80 rounded-full opacity-45 blur-3xl"
          style={{
            background: 'radial-gradient(circle, rgba(147, 51, 234, 0.42) 0%, rgba(196, 181, 253, 0.16) 60%, transparent 74%)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-xl">
          <h1
            className="font-display font-extrabold text-[28px] sm:text-[34px] tracking-tight leading-[1.12]"
            style={{ textWrap: 'balance' }}
          >
            <span className="text-[#0F1035]">Host Command </span>
            <span className="text-[#7C3AED]">Centre</span>
          </h1>
          <p className="text-sm sm:text-[15px] text-[#3E3963] mt-2 leading-relaxed">
            Monitor live classroom participation, launch rotating QR sessions, and review student responses in real time.
          </p>
        </div>

        {/* Right Action Stack: Quick Quiz top pill + New Poll / New Quiz row */}
        <div className="relative z-10 flex flex-col items-start lg:items-end justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onQuickCreate('quiz')}
            className="tp-gradient-btn text-white inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Quick Quiz</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onQuickCreate('poll')}
              className="tp-glass-btn inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-semibold text-[#0F1035] whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#7C3AED]" />
              <span>New Poll</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickCreate('quiz')}
              className="tp-gradient-btn text-white inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Quiz</span>
            </button>
          </div>
        </div>
      </section>

      {/* 6-Column Real Database KPI Liquid Glass Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onNavigate(card.tab)}
              className="group tp-surface tp-glass-tile rounded-[24px] p-5 text-left cursor-pointer flex flex-col justify-between gap-4 relative overflow-hidden"
            >
              <div className="flex items-center justify-between gap-2 relative z-10">
                <span className="w-10 h-10 rounded-full bg-[#7C3AED]/12 text-[#7C3AED] flex items-center justify-center shrink-0 group-hover:bg-[#7C3AED] group-hover:text-white transition-colors shadow-xs">
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <ArrowUpRight className="w-4 h-4 text-[#43446B] group-hover:text-[#7C3AED] transition-colors" />
              </div>
              <div className="relative z-10">
                <p className="font-display text-[28px] font-extrabold text-[#0F1035] tabular-nums leading-none">
                  {card.value}
                </p>
                <p className="text-[13px] font-medium text-[#3E3963] mt-2 truncate">{card.label}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Split Panels: Active Live Sessions & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Active Live Sessions Liquid Glass Panel */}
        <section className="lg:col-span-7 tp-surface rounded-[28px] overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-[#17143A]/8 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-base text-[#0F1035]">
                Active Live Sessions
              </h2>
              <p className="text-xs text-[#55587D] mt-0.5 tabular-nums">
                {data.activeSessionsList.length} running right now
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('live')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:text-[#5B21B6] cursor-pointer whitespace-nowrap"
            >
              <span>View all</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {data.activeSessionsList.length === 0 ? (
            <div className="flex-1 px-6 py-11 flex flex-col items-center justify-center text-center space-y-3.5">
              <div className="w-14 h-14 rounded-full bg-[#7C3AED]/12 text-[#7C3AED] flex items-center justify-center shadow-xs">
                <QrCode className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-[15px] font-bold text-[#0F1035]">No active sessions running</p>
                <p className="text-xs text-[#43446B] max-w-xs mx-auto leading-relaxed">
                  Launch a quiz or poll to generate a unique six-digit code and rotating QR for students.
                </p>
              </div>
              <div className="pt-1.5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onQuickCreate('quiz')}
                  className="tp-gradient-btn text-white px-6 py-2.5 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Create Quiz
                </button>
                <button
                  type="button"
                  onClick={() => onQuickCreate('poll')}
                  className="tp-glass-btn text-[#0F1035] px-6 py-2.5 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Create Poll
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#17143A]/8 flex-1">
              {data.activeSessionsList.map((s) => (
                <div
                  key={s.id}
                  className="px-6 py-4 flex flex-wrap items-center justify-between gap-4 hover:bg-white/55 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-[#0F1035] truncate">
                      {s.assessmentTitle}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#55587D] mt-1">
                      <span className="font-mono font-bold text-[#7C3AED] tabular-nums">
                        {s.joinCode.slice(0, 3)} {s.joinCode.slice(3)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize inline-flex items-center gap-1">
                        {s.privacyMode === 'anonymous' ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <UserCheck className="w-3 h-3" />
                        )}
                        {s.privacyMode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{s.submissionCount ?? 0} responses</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="w-3 h-3" />
                        {s.assessmentType === 'poll'
                          ? 'Open until ended'
                          : `${Math.ceil(s.remainingSeconds / 60)}m left`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyCode(s)}
                      title="Copy 6-digit code"
                      className="tp-glass-btn p-2 rounded-full text-[#43446B] cursor-pointer"
                      aria-label={`Copy join code ${s.joinCode}`}
                    >
                      {copiedId === s.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSessionModal(s)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#7C3AED]/12 hover:bg-[#7C3AED]/20 text-[#7C3AED] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>QR & Controls</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity Liquid Glass Panel */}
        <section className="lg:col-span-5 tp-surface rounded-[28px] overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-[#17143A]/8 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display font-bold text-base text-[#0F1035]">Recent Activity</h2>
              <p className="text-xs text-[#55587D] mt-0.5">Latest institutional audit trail</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#7C3AED] hover:text-[#5B21B6] cursor-pointer whitespace-nowrap"
            >
              <span>Audit logs</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {data.recentActivity.length === 0 ? (
            <div className="flex-1 p-10 flex items-center justify-center text-center text-xs text-[#55587D]">
              Institution activity will appear here as assessments, grades, and records are updated.
            </div>
          ) : (
            <div className="divide-y divide-[#17143A]/8 flex-1">
              {data.recentActivity.map((log) => (
                <div
                  key={log.id}
                  className="px-6 py-4 text-xs space-y-1 hover:bg-white/55 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-[13px] text-[#0F1035] truncate">
                      {log.action}
                    </span>
                    <span className="text-[11px] font-medium text-[#55587D] tabular-nums shrink-0">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[#55587D] truncate">
                    {log.actorEmail || 'System'} · {log.targetType}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
