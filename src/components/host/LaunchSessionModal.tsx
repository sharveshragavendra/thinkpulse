import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Download,
  EyeOff,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Square,
  UserCheck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiRequest } from '../../services/api.ts';
import type { SessionDTO } from '../../../shared/types.ts';

interface LaunchSessionModalProps {
  session: SessionDTO | null;
  onClose: () => void;
  onSessionUpdated: (updated: SessionDTO) => void;
}

function formatCountdown(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LaunchSessionModal({
  session,
  onClose,
  onSessionUpdated,
}: LaunchSessionModalProps) {
  const [remaining, setRemaining] = useState(session?.remainingSeconds ?? 0);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrFullscreen, setQrFullscreen] = useState(false);

  useEffect(() => {
    if (!session) {
      setQrFullscreen(false);
      return;
    }
    setRemaining(session.remainingSeconds);
    setError(null);
  }, [session]);

  useEffect(() => {
    if (!qrFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setQrFullscreen(false);
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        }
      }
    };
    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        setQrFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFsChange);
    };
  }, [qrFullscreen]);

  const enterQrFullscreen = () => {
    setQrFullscreen(true);
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch(() => {
          // Graceful fallback: fixed inset-0 overlay remains active inside iframes
        });
      }
    } catch {
      // ignore iframe fullscreen restriction
    }
  };

  const exitQrFullscreen = () => {
    setQrFullscreen(false);
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  const isPoll = session?.assessmentType === 'poll';

  useEffect(() => {
    if (!session || session.effectiveStatus !== 'active' || session.assessmentType === 'poll') return;
    const t = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [session]);

  const isActive = Boolean(session && session.effectiveStatus === 'active' && (isPoll || remaining > 0));

  const handleCopyCode = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restriction
    }
  };

  const handleDownloadQr = () => {
    if (!session?.qrDataUrl) return;
    const a = document.createElement('a');
    a.href = session.qrDataUrl;
    a.download = `ThinkPulse_QR_${session.joinCode}_v${session.qrVersion}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleRotateQr = async () => {
    if (!session) return;
    setBusyAction('rotate');
    setError(null);
    try {
      const res = await apiRequest<{ session: SessionDTO }>(`/host/sessions/${session.id}/qr/rotate`, {
        method: 'POST',
      });
      onSessionUpdated(res.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to rotate QR.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExtend = async (minutes: number) => {
    if (!session) return;
    setBusyAction(`extend-${minutes}`);
    setError(null);
    try {
      const res = await apiRequest<{ session: SessionDTO }>(`/host/sessions/${session.id}/extend`, {
        method: 'POST',
        body: { additionalMinutes: minutes },
      });
      onSessionUpdated(res.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to extend session.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnd = async () => {
    if (!session) return;
    setBusyAction('end');
    setError(null);
    try {
      const res = await apiRequest<{ session: SessionDTO }>(`/host/sessions/${session.id}/end`, {
        method: 'POST',
      });
      onSessionUpdated(res.session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to end session.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <AnimatePresence>
      {session && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/50 dark:bg-black/75 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl rounded-[30px] tp-modal-glass overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-[#17143A]/8 dark:border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#5B617A] dark:text-[#A49EC6]">
                  {session.assessmentType === 'poll' ? 'Live Poll Session' : 'Live Quiz Session'} · QR v{session.qrVersion}
                </p>
                <h2 id="launch-modal-title" className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF] truncate">
                  {session.assessmentTitle || 'Active Session'}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close session launch modal"
                className="p-2 rounded-xl text-[#5B617A] dark:text-[#C5BFE4] hover:text-[#17143A] dark:hover:text-white hover:bg-white/80 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {error && (
                <div role="alert" className="rounded-2xl bg-rose-50/90 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                {/* Crystal Framed Official QR Code */}
                <div className="md:col-span-5 flex flex-col items-center justify-center p-5 rounded-3xl bg-white/75 dark:bg-[#1A133A]/80 border border-white/95 dark:border-white/14 shadow-sm relative">
                  <span className="absolute top-3 left-3 w-3.5 h-3.5 border-t-2 border-l-2 border-[#6334E8]/60 dark:border-[#C4B5FD]/70 rounded-tl-sm" />
                  <span className="absolute top-3 right-3 w-3.5 h-3.5 border-t-2 border-r-2 border-[#6334E8]/60 dark:border-[#C4B5FD]/70 rounded-tr-sm" />
                  <span className="absolute bottom-11 left-3 w-3.5 h-3.5 border-b-2 border-l-2 border-[#6334E8]/60 dark:border-[#C4B5FD]/70 rounded-bl-sm" />
                  <span className="absolute bottom-11 right-3 w-3.5 h-3.5 border-b-2 border-r-2 border-[#6334E8]/60 dark:border-[#C4B5FD]/70 rounded-br-sm" />

                  {session.qrDataUrl ? (
                    <img
                      src={session.qrDataUrl}
                      alt={`Official ThinkPulse QR code for session ${session.joinCode}`}
                      onClick={enterQrFullscreen}
                      title="Click to view QR full screen"
                      className="w-48 h-48 rounded-2xl bg-white p-2.5 shadow-xs cursor-pointer hover:scale-[1.02] transition-transform"
                    />
                  ) : (
                    <div className="w-48 h-48 rounded-2xl bg-[#EFEBF9] dark:bg-white/8 flex items-center justify-center text-xs text-[#5B617A] dark:text-[#A49EC6]">
                      QR unavailable
                    </div>
                  )}
                  <div className="mt-3.5 flex flex-wrap items-center justify-center gap-3">
                    {session.qrDataUrl && (
                      <button
                        type="button"
                        onClick={enterQrFullscreen}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#6334E8]/12 dark:bg-[#8B5CF6]/25 hover:bg-[#6334E8]/20 dark:hover:bg-[#8B5CF6]/35 text-xs font-semibold text-[#6334E8] dark:text-[#DDD6FE] transition-colors cursor-pointer"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Full Screen</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD] hover:text-[#4F46E5] dark:hover:text-[#E9D5FF] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PNG</span>
                    </button>
                  </div>
                </div>

                {/* 6-Digit Code & Live Status */}
                <div className="md:col-span-7 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-[#5B617A] dark:text-[#A49EC6] mb-1.5">Six-Digit Entry Code</p>
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-3xl sm:text-4xl font-bold tracking-[0.2em] text-[#17143A] dark:text-[#F4F2FF] bg-white/85 dark:bg-[#140E2E]/90 border border-white dark:border-white/14 shadow-inner px-5 py-3 rounded-2xl tabular-nums">
                        {session.joinCode.slice(0, 3)} {session.joinCode.slice(3)}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="tp-glass-btn px-3.5 py-3 rounded-2xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        aria-label="Copy 6-digit code"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span className="text-emerald-700 dark:text-emerald-300">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-white/65 dark:bg-white/6 border border-white/95 dark:border-white/10 p-3.5">
                      <p className="text-xs text-[#5B617A] dark:text-[#A49EC6]">{isPoll ? 'Session Status' : 'Time Remaining'}</p>
                      <p className="font-mono font-bold text-lg text-[#17143A] dark:text-[#F4F2FF] mt-0.5 flex items-center gap-1.5 tabular-nums">
                        <Clock className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
                        <span>
                          {isPoll
                            ? isActive
                              ? 'Open until ended'
                              : 'Ended'
                            : isActive
                            ? formatCountdown(remaining)
                            : 'Expired'}
                        </span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/65 dark:bg-white/6 border border-white/95 dark:border-white/10 p-3.5">
                      <p className="text-xs text-[#5B617A] dark:text-[#A49EC6]">Privacy Mode</p>
                      <p className="font-semibold text-sm text-[#17143A] dark:text-[#F4F2FF] mt-1 flex items-center gap-1.5 capitalize">
                        {session.privacyMode === 'anonymous' ? (
                          <EyeOff className="w-4 h-4 text-[#6334E8] dark:text-[#C4B5FD]" />
                        ) : (
                          <UserCheck className="w-4 h-4 text-[#4F46E5] dark:text-[#A5B4FC]" />
                        )}
                        <span>{session.privacyMode}</span>
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-[#5B617A] dark:text-[#A49EC6] leading-relaxed">
                    {session.privacyMode === 'anonymous'
                      ? 'Direct QR join enabled — participants can scan this QR with any camera or QR scanner without Google Sign-In. Rotating the QR immediately invalidates previous codes.'
                      : 'Google Sign-In required — students join via the Student Portal QR scanner or 6-digit code. Rotating the QR immediately invalidates previous codes.'}
                  </p>
                </div>
              </div>

              {/* Host Live Session Controls */}
              <div className="pt-4 border-t border-[#17143A]/8 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!isActive || busyAction !== null}
                    onClick={handleRotateQr}
                    className="tp-glass-btn inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] disabled:opacity-50 cursor-pointer"
                  >
                    {busyAction === 'rotate' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                    )}
                    <span>Rotate QR</span>
                  </button>

                  {!isPoll && (
                    <>
                      <button
                        type="button"
                        disabled={session.status === 'ended' || busyAction !== null}
                        onClick={() => handleExtend(5)}
                        className="tp-glass-btn px-3.5 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] disabled:opacity-50 cursor-pointer"
                      >
                        +5 min
                      </button>
                      <button
                        type="button"
                        disabled={session.status === 'ended' || busyAction !== null}
                        onClick={() => handleExtend(15)}
                        className="tp-glass-btn px-3.5 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] disabled:opacity-50 cursor-pointer"
                      >
                        +15 min
                      </button>
                    </>
                  )}
                </div>

                {isActive && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleEnd}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-sm shadow-rose-600/25 disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>End Session Now</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Dedicated Full-Screen QR-Only Projection View */}
          {qrFullscreen && session.qrDataUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="fixed inset-0 z-[70] bg-white flex items-center justify-center p-6 sm:p-10"
              role="dialog"
              aria-modal="true"
              aria-label="Full screen QR code"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={exitQrFullscreen}
                aria-label="Exit full screen QR"
                className="fixed top-5 right-5 z-10 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#17143A]/8 hover:bg-[#17143A]/15 text-[#17143A] text-xs font-semibold transition-colors cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
                <span>Exit Full Screen</span>
              </button>

              <img
                src={session.qrDataUrl}
                alt={`Full screen QR code for session ${session.joinCode}`}
                className="w-[min(88vw,88vh)] h-[min(88vw,88vh)] max-w-[780px] max-h-[780px] object-contain select-none"
                style={{ imageRendering: 'pixelated' }}
              />
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
