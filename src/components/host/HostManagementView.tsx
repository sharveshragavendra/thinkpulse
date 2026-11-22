import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import type { HostAccessRecordDTO } from '../../../shared/types.ts';

export function HostManagementView({ refreshTick }: { refreshTick: number }) {
  const [hosts, setHosts] = useState<HostAccessRecordDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<HostAccessRecordDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHosts = useCallback(async () => {
    try {
      const res = await apiRequest<{ hosts: HostAccessRecordDTO[] }>('/host/hosts');
      setHosts(res.hosts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load authorized hosts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHosts();
  }, [loadHosts, refreshTick]);

  const handleAddHost = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ host: HostAccessRecordDTO }>('/host/hosts', {
        method: 'POST',
        body: {
          email: trimmedEmail,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        },
      });
      setEmail('');
      setDisplayName('');
      setNotice(
        res.host.hasSignedIn
          ? `${res.host.email} has been upgraded to Host access immediately.`
          : `${res.host.email} has been granted Host access. They will enter Host Command Centre when they sign in with Google.`
      );
      await loadHosts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to add host.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemove) return;
    const targetEmail = pendingRemove.email;
    setPendingRemove(null);
    setRemovingEmail(targetEmail);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/host/hosts', {
        method: 'DELETE',
        body: { email: targetEmail },
      });
      setNotice(`Host access revoked for ${targetEmail}.`);
      await loadHosts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to remove host.');
    } finally {
      setRemovingEmail(null);
    }
  };

  const getInitials = (name: string, fallbackEmail: string) => {
    const source = name.trim() || fallbackEmail;
    return source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">
          Host Access
        </h1>
        <p className="text-sm text-[#55587D] dark:text-[#A49EC6] mt-0.5">
          Add new hosts by entering their email ID. Authorized emails automatically sign in to the Host Command Centre.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/55 border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* Add New Host Form Card */}
      <form onSubmit={handleAddHost} className="tp-surface rounded-[26px] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-2xl bg-[#7C3AED]/12 dark:bg-[#8B5CF6]/22 text-[#7C3AED] dark:text-[#C4B5FD] flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4" />
          </span>
          <div>
            <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">
              Add New Host
            </h2>
            <p className="text-xs text-[#55587D] dark:text-[#A49EC6]">
              Enter the Google email ID of the instructor or coordinator you want to grant Host permissions.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
          <div className="md:col-span-5">
            <label
              htmlFor="tp-new-host-email"
              className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1.5"
            >
              Host Email ID <span className="text-rose-600 dark:text-rose-400">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#5B617A] dark:text-[#A49EC6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="tp-new-host-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="faculty@bitsathy.ac.in"
                className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>
          </div>

          <div className="md:col-span-4">
            <label
              htmlFor="tp-new-host-name"
              className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1.5"
            >
              Name <span className="text-[#6F6B94] dark:text-[#8E88B0] font-normal">(optional)</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#5B617A] dark:text-[#A49EC6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="tp-new-host-name"
                type="text"
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., Dr. Karthik"
                className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full tp-gradient-btn text-white inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              <span>Add Host</span>
            </button>
          </div>
        </div>
      </form>

      {/* Authorized Hosts Table */}
      <section className="tp-surface rounded-[26px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#17143A]/8 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#7C3AED] dark:text-[#C4B5FD]" />
            <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">
              Authorized Hosts
            </h2>
          </div>
          <span className="text-xs font-semibold text-[#55587D] dark:text-[#A49EC6] tabular-nums">
            {hosts.length} {hosts.length === 1 ? 'host' : 'hosts'}
          </span>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#55587D] dark:text-[#A49EC6]">
            <Loader2 className="w-5 h-5 animate-spin text-[#7C3AED] dark:text-[#C4B5FD]" />
            <span>Loading authorized hosts...</span>
          </div>
        ) : hosts.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#55587D] dark:text-[#A49EC6]">
            No hosts configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#17143A]/8 dark:border-white/10 bg-white/55 dark:bg-white/5 text-xs text-[#55587D] dark:text-[#C5BFE4]">
                  <th className="py-3 px-6 font-semibold">Host</th>
                  <th className="py-3 px-4 font-semibold">Role</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Added By</th>
                  <th className="py-3 px-6 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17143A]/8 dark:divide-white/10">
                {hosts.map((host) => (
                  <tr
                    key={host.email}
                    className="hover:bg-white/60 dark:hover:bg-white/6 transition-colors"
                  >
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-xs shrink-0 ${
                            host.isPrimary
                              ? 'bg-[#7C3AED]/15 dark:bg-[#8B5CF6]/28 text-[#6D28D9] dark:text-[#E9D5FF]'
                              : 'bg-indigo-500/12 dark:bg-indigo-500/22 text-indigo-700 dark:text-indigo-200'
                          }`}
                          aria-hidden="true"
                        >
                          {getInitials(host.displayName, host.email)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-[#17143A] dark:text-[#F4F2FF] truncate">
                              {host.displayName}
                            </p>
                            {host.isCurrentUser && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#7C3AED]/12 dark:bg-[#8B5CF6]/25 text-[#6D28D9] dark:text-[#DDD6FE]">
                                You
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#55587D] dark:text-[#A49EC6] font-mono truncate">
                            {host.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {host.isPrimary ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#7C3AED]/14 dark:bg-[#8B5CF6]/25 text-[#6D28D9] dark:text-[#E9D5FF] border border-[#7C3AED]/20 dark:border-[#A78BFA]/30">
                          <Crown className="w-3.5 h-3.5" />
                          <span>Primary Host</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-400/25">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Host</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {host.hasSignedIn ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/55 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-400/30">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/55 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-400/30">
                          Pending Sign-In
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-xs text-[#55587D] dark:text-[#A49EC6]">
                      {host.isPrimary ? (
                        <span>System Primary</span>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="truncate max-w-[200px]">{host.addedByEmail || 'Host'}</p>
                          {host.addedAt && (
                            <p className="text-[11px] text-[#7B76A0] dark:text-[#8E88B0] tabular-nums">
                              {new Date(host.addedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      {host.isPrimary ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#7B76A0] dark:text-[#8E88B0]">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Protected</span>
                        </span>
                      ) : host.isCurrentUser ? (
                        <span className="text-xs font-medium text-[#7B76A0] dark:text-[#8E88B0]">
                          Current session
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={removingEmail === host.email}
                          onClick={() => setPendingRemove(host)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50/80 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200/80 dark:border-rose-400/25 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {removingEmail === host.email ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>Remove</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Revoke Host Access?"
        description={
          pendingRemove
            ? `${pendingRemove.email} will lose Host Command Centre access immediately and revert to Student mode on sign-in.`
            : ''
        }
        confirmLabel="Revoke Access"
        tone="danger"
        onConfirm={() => void handleConfirmRemove()}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
