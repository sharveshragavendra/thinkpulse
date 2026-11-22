import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Save, Search } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { AuditLogDTO, PrivacyMode } from '../../../shared/types.ts';

export function AuditLogsView({ refreshTick }: { refreshTick: number }) {
  const [logs, setLogs] = useState<AuditLogDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiRequest<{ logs: AuditLogDTO[]; total: number }>(
        `/host/audit-logs?${qs.toString()}`
      );
      setLogs(res.logs);
      setTotal(res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">Audit Logs</h1>
        <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
          Immutable, read-only history of assessment changes, manual grading, student profile edits, and server administration.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-[#5B617A] dark:text-[#A49EC6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by action, actor email, or target type..."
          className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
        />
      </div>

      <div className="tp-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
            <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
            <span>Loading audit history...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#64748B] dark:text-[#A49EC6]">No audit entries matched.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#17143A]/8 dark:border-white/10 bg-white/55 dark:bg-white/5 text-[#5B617A] dark:text-[#C5BFE4]">
                  <th className="py-3 px-5 font-semibold">Timestamp</th>
                  <th className="py-3 px-4 font-semibold">Action</th>
                  <th className="py-3 px-4 font-semibold">Actor</th>
                  <th className="py-3 px-4 font-semibold">Target</th>
                  <th className="py-3 px-5 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17143A]/8 dark:divide-white/10">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/60 dark:hover:bg-white/6 transition-colors">
                    <td className="py-3 px-5 font-mono text-[#64748B] dark:text-[#8E88B0] whitespace-nowrap tabular-nums">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[#17143A] dark:text-[#F4F2FF] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-3 px-4 text-[#4B4772] dark:text-[#C5BFE4]">{log.actorEmail || 'System'}</td>
                    <td className="py-3 px-4 capitalize text-[#4B4772] dark:text-[#C5BFE4]">{log.targetType}</td>
                    <td className="py-3 px-5 text-[#64748B] dark:text-[#A49EC6] max-w-md truncate font-mono">
                      {log.changedFields.length > 0
                        ? `fields: ${log.changedFields.join(', ')}`
                        : JSON.stringify(log.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-[#ECE9FA] dark:border-white/10 text-xs text-[#64748B] dark:text-[#A49EC6] tabular-nums">
              Showing {logs.length} of {total} audit entries
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsView() {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [allowStudentReg, setAllowStudentReg] = useState(true);
  const [defaultPrivacyMode, setDefaultPrivacyMode] = useState<PrivacyMode>('normal');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{
      profile: { displayName: string; department: string | null };
      institution: {
        name: string;
        settings: { allowStudentSelfRegistration?: boolean; defaultPrivacyMode?: PrivacyMode };
      };
    }>('/host/settings')
      .then((res) => {
        setDisplayName(res.profile.displayName);
        setDepartment(res.profile.department || '');
        setInstitutionName(res.institution.name);
        setAllowStudentReg(res.institution.settings?.allowStudentSelfRegistration !== false);
        setDefaultPrivacyMode(res.institution.settings?.defaultPrivacyMode || 'normal');
      })
      .catch(() => setError('Unable to load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest('/host/settings', {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          department: department.trim() || null,
          ...(user?.role === 'platform_admin'
            ? {
                institutionName: institutionName.trim(),
                allowStudentSelfRegistration: allowStudentReg,
                defaultPrivacyMode,
              }
            : {}),
        },
      });
      await refreshProfile();
      setNotice('Settings saved to PostgreSQL.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
        <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
        <span>Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">Settings</h1>
        <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
          Manage your host profile and institution registration preferences.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/55 border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 dark:text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="tp-surface rounded-2xl p-6 space-y-5">
        <div className="space-y-4">
          <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">Host Profile</h2>
          <div>
            <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Display Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Department</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g., School of Computer Science"
              className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
            />
          </div>
        </div>

        {user?.role === 'platform_admin' && (
          <div className="space-y-4 pt-5 border-t border-[#17143A]/8 dark:border-white/10">
            <h2 className="font-display font-bold text-base text-[#17143A] dark:text-[#F4F2FF]">
              Institution Policies (Platform Admin)
            </h2>
            <div>
              <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Institution Name</label>
              <input
                type="text"
                required
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Default Privacy Mode</label>
              <select
                value={defaultPrivacyMode}
                onChange={(e) => setDefaultPrivacyMode(e.target.value as PrivacyMode)}
                className="tp-input w-full rounded-xl px-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
              >
                <option value="normal">Normal Mode</option>
                <option value="anonymous">Anonymous Mode</option>
              </select>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-[#17143A] dark:text-[#E5E0FF] cursor-pointer">
              <input
                type="checkbox"
                checked={allowStudentReg}
                onChange={(e) => setAllowStudentReg(e.target.checked)}
                className="mt-1 accent-[#7C3AED]"
              />
              <span>
                Allow student self-registration on the Student Login screen
                <span className="block text-xs text-[#64748B] dark:text-[#A49EC6]">
                  Public registration is strictly restricted to the Student role; Host and Admin roles can never be self-assigned.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="tp-gradient-btn text-white inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Preferences</span>
          </button>
        </div>
      </form>
    </div>
  );
}
