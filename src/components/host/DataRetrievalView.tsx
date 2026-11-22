import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import type { StudentRetrievalResultDTO } from '../../../shared/types.ts';

interface DataRetrievalViewProps {
  initialEmail?: string | null;
}

export function DataRetrievalView({ initialEmail }: DataRetrievalViewProps) {
  const [emailQuery, setEmailQuery] = useState(initialEmail || '');
  const [result, setResult] = useState<StudentRetrievalResultDTO | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);

  // Strict allowlisted editable fields
  const [displayName, setDisplayName] = useState('');
  const [classSection, setClassSection] = useState('');
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');

  const runSearch = useCallback(async (targetEmail: string) => {
    const clean = targetEmail.trim().toLowerCase();
    if (!clean) return;
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<StudentRetrievalResultDTO>(
        `/host/students/search?email=${encodeURIComponent(clean)}`
      );
      setResult(data);
      setDisplayName(data.student.displayName);
      setClassSection(data.student.classSection || '');
      setDepartment(data.student.department || '');
      setNotes(data.student.notes || '');
      setStatus((data.student.status === 'suspended' ? 'suspended' : 'active'));
    } catch (err: unknown) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Student lookup failed.');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (initialEmail) {
      setEmailQuery(initialEmail);
      void runSearch(initialEmail);
    }
  }, [initialEmail, runSearch]);

  const commitProfileSave = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ changedFields: string[] }>(`/host/students/${result.student.id}`, {
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          classSection: classSection.trim() || null,
          department: department.trim() || null,
          notes: notes.trim() || null,
          status,
          expectedUpdatedAt: result.student.updatedAt,
        },
      });
      await runSearch(result.student.email);
      setNotice(
        res.changedFields.length > 0
          ? `Committed to PostgreSQL and logged in Audit Trail (${res.changedFields.join(', ')}).`
          : 'No fields changed.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save profile update.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result) return;
    if (status !== result.student.status) {
      setConfirmStatusOpen(true);
      return;
    }
    void commitProfileSave();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#17143A]">Student Data Retrieval</h1>
        <p className="text-sm text-[#64748B] mt-0.5">
          Search a student by email within your institution scope to inspect Normal-mode academic records and edit allowlisted profile fields.
        </p>
      </div>

      {/* Email Search Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(emailQuery);
        }}
        className="tp-surface rounded-2xl p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#5B617A] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="email"
            required
            value={emailQuery}
            onChange={(e) => setEmailQuery(e.target.value)}
            placeholder="Enter exact student email address (e.g., student@institution.edu)"
            className="tp-input w-full rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-[#17143A]"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="tp-gradient-btn text-white px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span>Retrieve Student Record</span>
        </button>
      </form>

      <div className="rounded-2xl bg-[#F4F1FF] border border-[#DDD9F5] px-4 py-3 flex items-start gap-2.5 text-xs text-[#4B4772]">
        <ShieldCheck className="w-4 h-4 text-[#6334E8] shrink-0 mt-0.5" />
        <span>
          <strong>Privacy invariant enforced:</strong> Data Retrieval searches strictly within your institution scope and returns <strong>Normal-mode records only</strong>. Anonymous-mode submissions cannot be revealed or reidentified here.
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Editable Allowlisted Profile Card */}
          <div className="lg:col-span-5 space-y-5">
            <form onSubmit={handleSaveProfile} className="tp-surface rounded-2xl p-5 space-y-4">
              <div className="border-b border-[#ECE9FA] pb-3">
                <h2 className="font-display font-bold text-base text-[#17143A]">
                  Student Profile (Allowlisted Fields)
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Verified email, role, ID & credentials are read-only.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-white/60 border border-white/90 rounded-2xl p-3.5">
                <div>
                  <span className="text-[#5B617A]">Email (locked)</span>
                  <p className="font-semibold text-[#17143A] truncate">{result.student.email}</p>
                </div>
                <div>
                  <span className="text-[#5B617A]">Student ID (locked)</span>
                  <p className="font-mono font-semibold text-[#17143A]">
                    {result.student.studentCode || '—'}
                  </p>
                </div>
                <div>
                  <span className="text-[#5B617A]">Institution</span>
                  <p className="font-medium text-[#17143A]">{result.student.institutionName}</p>
                </div>
                <div>
                  <span className="text-[#5B617A]">Registered</span>
                  <p className="font-mono text-[#17143A] tabular-nums">
                    {new Date(result.student.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#17143A] mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] mb-1">Class / Section</label>
                  <input
                    type="text"
                    value={classSection}
                    onChange={(e) => setClassSection(e.target.value)}
                    className="tp-input w-full rounded-xl px-3.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] mb-1">Department</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="tp-input w-full rounded-xl px-3.5 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#17143A] mb-1">Account Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#17143A] mb-1">Academic Notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional faculty notes..."
                  className="tp-input w-full rounded-xl px-3.5 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full tp-gradient-btn text-white py-2.5 px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save & Record Audit Entry</span>
              </button>
            </form>

            {/* Student Audit History */}
            <div className="tp-surface rounded-2xl p-5 space-y-3">
              <h3 className="font-display font-bold text-sm text-[#17143A]">
                Profile Edit Audit Trail
              </h3>
              {result.auditHistory.length === 0 ? (
                <p className="text-xs text-[#64748B]">No profile edits recorded.</p>
              ) : (
                <div className="space-y-2.5 max-h-56 overflow-y-auto">
                  {result.auditHistory.map((log) => (
                    <div key={log.id} className="text-xs border-b border-[#ECE9FA] pb-2 last:border-0">
                      <div className="flex justify-between gap-2">
                        <span className="font-mono font-semibold text-[#17143A]">{log.action}</span>
                        <span className="text-[11px] text-[#94A3B8] tabular-nums">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[#64748B] mt-0.5">
                        By {log.actorEmail || 'System'}
                        {log.changedFields.length > 0 ? ` · Fields: ${log.changedFields.join(', ')}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Normal-Mode Academic Records */}
          <div className="lg:col-span-7 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Normal Quizzes', value: result.normalModeSummary.totalQuizAttempts },
                { label: 'Normal Polls', value: result.normalModeSummary.totalPollParticipations },
                {
                  label: 'Avg Quiz %',
                  value:
                    result.normalModeSummary.averageQuizPercentage !== null
                      ? `${result.normalModeSummary.averageQuizPercentage}%`
                      : '—',
                },
                { label: 'Pending Reviews', value: result.normalModeSummary.pendingReviews },
              ].map((m) => (
                <div key={m.label} className="tp-surface rounded-2xl p-3.5">
                  <p className="text-[11px] text-[#64748B]">{m.label}</p>
                  <p className="font-mono text-xl font-bold text-[#17143A] mt-1 tabular-nums">{m.value}</p>
                </div>
              ))}
            </div>

            <div className="tp-surface rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#ECE9FA]">
                <h2 className="font-display font-bold text-base text-[#17143A]">
                  Normal-Mode Participation & Responses
                </h2>
              </div>

              {result.activity.length === 0 ? (
                <div className="p-10 text-center text-xs text-[#64748B]">
                  This student has no Normal-mode quiz or poll submissions yet.
                </div>
              ) : (
                <div className="divide-y divide-[#ECE9FA]">
                  {result.activity.map((act) => (
                    <div key={act.submissionId} className="p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm text-[#17143A]">{act.assessmentTitle}</p>
                          <p className="text-xs text-[#64748B] capitalize tabular-nums">
                            {act.assessmentType} · Code {act.joinCode} ·{' '}
                            {new Date(act.submittedAt).toLocaleString()}
                          </p>
                        </div>
                        {act.assessmentType === 'quiz' ? (
                          <div className="text-right">
                            <p className="font-mono font-bold text-sm text-[#6334E8] tabular-nums">
                              {act.totalScore} / {act.maxScore}
                            </p>
                            <p className="text-[11px] text-[#64748B] capitalize">
                              {act.status.replace('_', ' ')}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-emerald-700">Poll recorded</span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {act.answers.map((ans, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl bg-[#FAF9FF] border border-[#ECE9FA] px-3.5 py-2.5 text-xs space-y-1"
                          >
                            <div className="flex justify-between gap-3">
                              <span className="font-medium text-[#17143A]">
                                Q{idx + 1}. {ans.questionText}
                              </span>
                              {ans.maxPoints !== null && (
                                <span className="font-mono text-[#6334E8] shrink-0 tabular-nums">
                                  {ans.awardedPoints} / {ans.maxPoints}
                                </span>
                              )}
                            </div>
                            <p className="text-[#4B4772]">Answer: {ans.answerDisplay}</p>
                            {ans.feedback && (
                              <p className="text-[#6334E8]">Feedback: {ans.feedback}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmStatusOpen}
        title="Confirm Account Status Change"
        description={
          result
            ? `Change account status to "${status}" for ${result.student.email}? This update is recorded in the institutional audit trail.`
            : ''
        }
        confirmLabel="Confirm Status Change"
        tone={status === 'suspended' ? 'danger' : 'primary'}
        onCancel={() => setConfirmStatusOpen(false)}
        onConfirm={() => {
          setConfirmStatusOpen(false);
          void commitProfileSave();
        }}
      />
    </div>
  );
}
