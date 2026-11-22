import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, UserPlus, X } from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import type { UserProfile } from '../../../shared/types.ts';

interface StudentDatabaseViewProps {
  refreshTick: number;
  onInspectStudentEmail: (email: string) => void;
}

export function StudentDatabaseView({
  refreshTick,
  onInspectStudentEmail,
}: StudentDatabaseViewProps) {
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Provision student form
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [classSection, setClassSection] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '40' });
      if (search.trim()) qs.set('search', search.trim());
      const res = await apiRequest<{ students: UserProfile[]; total: number }>(
        `/host/students?${qs.toString()}`
      );
      setStudents(res.students);
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

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/host/students', {
        method: 'POST',
        body: {
          displayName: displayName.trim(),
          email: email.trim(),
          password,
          classSection: classSection.trim() || undefined,
          department: department.trim() || undefined,
        },
      });
      setModalOpen(false);
      setDisplayName('');
      setEmail('');
      setPassword('');
      setClassSection('');
      setDepartment('');
      void load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to add student.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">Student Database</h1>
          <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
            Authorized institution student directory. Click any student to inspect Normal-mode academic activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModalOpen(true);
          }}
          className="tp-gradient-btn text-white inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Provision Student</span>
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-[#5B617A] dark:text-[#A49EC6] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students by name, email, ID, or class..."
          className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A] dark:text-[#F4F2FF]"
        />
      </div>

      <div className="tp-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
            <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
            <span>Loading directory...</span>
          </div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF]">No students registered yet</p>
            <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">
              Provision student accounts here or let students register through the Student Login portal.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#17143A]/8 dark:border-white/10 bg-white/55 dark:bg-white/5 text-xs font-semibold text-[#5B617A] dark:text-[#C5BFE4]">
                  <th className="py-3 px-5">Student</th>
                  <th className="py-3 px-4">Student ID</th>
                  <th className="py-3 px-4">Class / Dept</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#17143A]/8 dark:divide-white/10">
                {students.map((st) => (
                  <tr key={st.id} className="hover:bg-white/60 dark:hover:bg-white/6 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-[#17143A] dark:text-[#F4F2FF]">{st.displayName}</p>
                      <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">{st.email}</p>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-[#4B4772] dark:text-[#C5BFE4]">
                      {st.studentCode || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#4B4772] dark:text-[#C5BFE4]">
                      {[st.classSection, st.department].filter(Boolean).join(' · ') || 'Unassigned'}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold capitalize">
                      <span className={st.status === 'active' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
                        {st.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => onInspectStudentEmail(st.email)}
                        className="text-xs font-semibold text-[#6334E8] dark:text-[#C4B5FD] hover:underline cursor-pointer"
                      >
                        Open in Data Retrieval →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-[#ECE9FA] dark:border-white/10 text-xs text-[#64748B] dark:text-[#A49EC6] tabular-nums">
              Showing {students.length} of {total} students
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/50 dark:bg-black/75 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-[30px] tp-modal-glass p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">Provision Student Account</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-[#4B4772] dark:text-[#C5BFE4] hover:bg-white/80 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div role="alert" className="rounded-2xl bg-rose-50/90 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {error}
              </div>
            )}
            <form onSubmit={handleProvision} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Full name *</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Email address *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Initial password (min 8 chars) *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Class / Section</label>
                  <input
                    type="text"
                    value={classSection}
                    onChange={(e) => setClassSection(e.target.value)}
                    placeholder="CS-204 A"
                    className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Department</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Computer Science"
                    className="tp-input w-full rounded-xl px-3.5 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#17143A]/8 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="tp-glass-btn px-4 py-2 rounded-xl text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="tp-gradient-btn text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Creating...' : 'Create Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
