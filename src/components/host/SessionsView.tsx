import React, { useCallback, useEffect, useState } from 'react';
import { Clock, EyeOff, Loader2, QrCode, Square, UserCheck } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { SessionDTO } from '../../../shared/types.ts';

interface SessionsViewProps {
  mode: 'active' | 'past';
  refreshTick: number;
  onOpenSessionModal: (session: SessionDTO) => void;
}

export function SessionsView({ mode, refreshTick, onOpenSessionModal }: SessionsViewProps) {
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ sessions: SessionDTO[] }>(`/host/sessions?status=${mode}&limit=40`);
      setSessions(res.sessions);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load sessions.');
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  const handleEnd = async (id: string) => {
    setEndingId(id);
    try {
      await apiRequest(`/host/sessions/${id}/end`, { method: 'POST' });
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to end session.');
    } finally {
      setEndingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#17143A]">
          {mode === 'active' ? 'Live Sessions' : 'Session History'}
        </h1>
        <p className="text-sm text-[#64748B] mt-0.5">
          {mode === 'active'
            ? 'Monitor running quizzes and polls, six-digit codes, QR token versions, and response counts.'
            : 'Inspect completed and expired classroom sessions with timestamps and total participation.'}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="tp-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#64748B]">
            <Loader2 className="w-5 h-5 animate-spin text-[#6334E8]" />
            <span>Loading sessions...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#64748B]">
            {mode === 'active'
              ? 'No sessions are currently active. Launch a quiz or poll to begin.'
              : 'No past sessions recorded yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#17143A]/8 bg-white/55 text-xs font-semibold text-[#5B617A]">
                  <th className="py-3 px-5">Assessment</th>
                  <th className="py-3 px-4">6-Digit Code</th>
                  <th className="py-3 px-4">Privacy</th>
                  <th className="py-3 px-4">Status / Time</th>
                  <th className="py-3 px-4 text-right">Responses</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17143A]/8">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-white/60 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-[#17143A]">{s.assessmentTitle}</p>
                      <p className="text-xs text-[#5B617A] capitalize">
                        {s.assessmentType} · QR v{s.qrVersion}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-[#6334E8] tracking-widest tabular-nums">
                      {s.joinCode.slice(0, 3)} {s.joinCode.slice(3)}
                    </td>
                    <td className="py-3.5 px-4 text-xs capitalize text-[#4B4772]">
                      <span className="inline-flex items-center gap-1">
                        {s.privacyMode === 'anonymous' ? (
                          <EyeOff className="w-3.5 h-3.5 text-[#6334E8]" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5 text-[#4F46E5]" />
                        )}
                        {s.privacyMode}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      {s.effectiveStatus === 'active' ? (
                        <span className="font-mono font-semibold text-emerald-700 inline-flex items-center gap-1 tabular-nums">
                          <Clock className="w-3.5 h-3.5" />
                          {s.assessmentType === 'poll'
                            ? 'Open until ended'
                            : `${Math.ceil(s.remainingSeconds / 60)} min remaining`}
                        </span>
                      ) : (
                        <span className="text-[#64748B] capitalize tabular-nums">
                          {s.effectiveStatus} · {new Date(s.launchedAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums">
                      {s.submissionCount ?? 0}
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap space-x-2">
                      {s.effectiveStatus === 'active' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenSessionModal(s)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#6334E8]/12 hover:bg-[#6334E8]/20 text-[#6334E8] text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QR & Controls</span>
                          </button>
                          <button
                            type="button"
                            disabled={endingId === s.id}
                            onClick={() => void handleEnd(s.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50/90 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Square className="w-3 h-3" />
                            <span>End</span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
