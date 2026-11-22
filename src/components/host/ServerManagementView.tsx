import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RotateCcw,
  Server,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../../services/api.ts';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import type { ServerEnvironment, ServerRecordDTO } from '../../../shared/types.ts';

export function ServerManagementView() {
  const [servers, setServers] = useState<ServerRecordDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServerRecordDTO | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(443);
  const [protocol, setProtocol] = useState<'https' | 'http'>('https');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [environment, setEnvironment] = useState<ServerEnvironment>('production');
  const [isEnabled, setIsEnabled] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    type: 'activate' | 'rollback' | 'delete';
    srv: ServerRecordDTO;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ servers: ServerRecordDTO[] }>('/admin/servers');
      setServers(res.servers);
      setForbidden(false);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.toLowerCase().includes('permission')) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load server registry.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openModal = (srv?: ServerRecordDTO) => {
    setError(null);
    if (srv) {
      setEditing(srv);
      setDisplayName(srv.displayName);
      setHost(srv.host);
      setPort(srv.port);
      setProtocol(srv.protocol);
      setApiBaseUrl(srv.apiBaseUrl);
      setEnvironment(srv.environment);
      setIsEnabled(srv.isEnabled);
    } else {
      setEditing(null);
      setDisplayName('');
      setHost('');
      setPort(443);
      setProtocol('https');
      setApiBaseUrl('https://');
      setEnvironment('production');
      setIsEnabled(true);
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('save');
    setError(null);
    setNotice(null);
    try {
      const body = {
        displayName: displayName.trim(),
        host: host.trim(),
        port: Number(port) || 443,
        protocol,
        apiBaseUrl: apiBaseUrl.trim(),
        environment,
        isEnabled,
      };
      if (editing) {
        await apiRequest(`/admin/servers/${editing.id}`, { method: 'PATCH', body });
        setNotice(`Updated "${body.displayName}" (previous config saved for rollback).`);
      } else {
        await apiRequest('/admin/servers', { method: 'POST', body });
        setNotice(`Registered approved server endpoint "${body.displayName}".`);
      }
      setModalOpen(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to save server record.');
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (id: string) => {
    setBusyId(`test-${id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ probe: { healthStatus: string; detail: string } }>(
        `/admin/servers/${id}/test`,
        { method: 'POST' }
      );
      setNotice(`Live health probe result: ${res.probe.healthStatus.toUpperCase()} — ${res.probe.detail}`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Health probe failed.');
    } finally {
      setBusyId(null);
    }
  };

  const executeActivate = async (srv: ServerRecordDTO) => {
    setBusyId(`activate-${srv.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/admin/servers/${srv.id}/activate`, { method: 'POST' });
      setNotice(`Activated "${srv.displayName}" and recorded audit entry.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Activation failed.');
    } finally {
      setBusyId(null);
    }
  };

  const executeRollback = async (srv: ServerRecordDTO) => {
    setBusyId(`rollback-${srv.id}`);
    try {
      await apiRequest(`/admin/servers/${srv.id}/rollback`, { method: 'POST' });
      setNotice(`Rolled back "${srv.displayName}" to previous approved configuration.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setBusyId(null);
    }
  };

  const executeDelete = async (srv: ServerRecordDTO) => {
    setBusyId(`delete-${srv.id}`);
    try {
      await apiRequest(`/admin/servers/${srv.id}`, { method: 'DELETE' });
      setNotice(`Removed "${srv.displayName}".`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to delete server.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmPendingAction = () => {
    if (!pendingAction) return;
    const { type, srv } = pendingAction;
    setPendingAction(null);
    if (type === 'activate') void executeActivate(srv);
    else if (type === 'rollback') void executeRollback(srv);
    else void executeDelete(srv);
  };

  if (forbidden) {
    return (
      <div className="tp-surface rounded-2xl p-10 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
        <h2 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
          Platform Administrator Permission Required
        </h2>
        <p className="text-sm text-[#64748B] dark:text-[#A49EC6] max-w-md mx-auto">
          Ordinary hosts cannot modify application server endpoints. Contact your Platform Administrator to request privileged Server Admin access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#17143A] dark:text-[#F4F2FF]">
            Server Management Portal
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#A49EC6] mt-0.5">
            Privileged registry of approved application API endpoints with controlled backend health checks, auditing, and rollback.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="tp-gradient-btn text-white inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Register Approved Server</span>
        </button>
      </div>

      {/* Deployment Topology Clarification */}
      <div className="rounded-2xl bg-[#F4F1FF] dark:bg-[#8B5CF6]/15 border border-[#DDD9F5] dark:border-[#C4B5FD]/25 px-4 py-3 text-xs text-[#4B4772] dark:text-[#E5E0FF] leading-relaxed">
        <strong>Deployment topology note:</strong> This registry manages approved API endpoints and environments. It does not distribute workloads, create high availability, or migrate PostgreSQL data. Loopback, private RFC1918, link-local, and cloud metadata addresses are blocked server-side, and production endpoints require HTTPS.
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/55 border border-emerald-200 dark:border-emerald-400/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 dark:text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      <div className="tp-surface rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-sm text-[#64748B] dark:text-[#A49EC6]">
            <Loader2 className="w-5 h-5 animate-spin text-[#6334E8] dark:text-[#C4B5FD]" />
            <span>Loading server registry...</span>
          </div>
        ) : servers.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Server className="w-8 h-8 text-[#6334E8] dark:text-[#C4B5FD] mx-auto" />
            <p className="text-sm font-semibold text-[#17143A] dark:text-[#F4F2FF]">No approved servers registered yet</p>
            <p className="text-xs text-[#64748B] dark:text-[#A49EC6]">
              Add an approved public HTTPS application endpoint to test connectivity and track health status.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#ECE9FA] dark:border-white/10 bg-[#FAF9FF] dark:bg-white/5 text-xs font-semibold text-[#64748B] dark:text-[#C5BFE4]">
                  <th className="py-3 px-5">Server & Endpoint</th>
                  <th className="py-3 px-4">Environment</th>
                  <th className="py-3 px-4">Measured Health</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECE9FA] dark:divide-white/10">
                {servers.map((srv) => (
                  <tr key={srv.id} className="hover:bg-[#FAF9FF] dark:hover:bg-white/6 transition-colors">
                    <td className="py-3.5 px-5">
                      <p className="font-semibold text-[#17143A] dark:text-[#F4F2FF]">{srv.displayName}</p>
                      <p className="font-mono text-xs text-[#64748B] dark:text-[#A49EC6] mt-0.5">
                        {srv.apiBaseUrl} · {srv.host}:{srv.port}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs capitalize font-medium text-[#4B4772] dark:text-[#C5BFE4]">
                      {srv.environment}
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      <p
                        className={`font-semibold capitalize ${
                          srv.healthStatus === 'healthy'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : srv.healthStatus === 'degraded'
                            ? 'text-amber-700 dark:text-amber-300'
                            : srv.healthStatus === 'unreachable'
                            ? 'text-rose-700 dark:text-rose-300'
                            : 'text-[#64748B] dark:text-[#A49EC6]'
                        }`}
                      >
                        {srv.healthStatus}
                        {srv.latencyMs !== null ? ` · ${srv.latencyMs}ms` : ''}
                      </p>
                      <p className="text-[11px] text-[#94A3B8] dark:text-[#8E88B0] tabular-nums">
                        {srv.lastCheckedAt
                          ? `Checked ${new Date(srv.lastCheckedAt).toLocaleString()}`
                          : 'Not measured yet'}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold">
                      {srv.isActive ? (
                        <span className="text-[#6334E8] dark:text-[#C4B5FD]">Active Endpoint</span>
                      ) : srv.isEnabled ? (
                        <span className="text-[#64748B] dark:text-[#A49EC6]">Standby</span>
                      ) : (
                        <span className="text-rose-700 dark:text-rose-300">Disabled</span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void handleTest(srv.id)}
                        className="tp-glass-btn inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] cursor-pointer"
                      >
                        <Activity className="w-3.5 h-3.5 text-[#6334E8] dark:text-[#C4B5FD]" />
                        <span>Test</span>
                      </button>

                      {!srv.isActive && srv.isEnabled && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => setPendingAction({ type: 'activate', srv })}
                          className="px-2.5 py-1.5 rounded-lg bg-[#F4F1FF] dark:bg-[#8B5CF6]/22 hover:bg-[#E7E0FF] dark:hover:bg-[#8B5CF6]/35 text-xs font-semibold text-[#6334E8] dark:text-[#DDD6FE] cursor-pointer"
                        >
                          Activate
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openModal(srv)}
                        className="tp-glass-btn px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#4B4772] dark:text-[#E5E0FF] cursor-pointer"
                      >
                        Edit
                      </button>

                      {srv.hasRollback && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => setPendingAction({ type: 'rollback', srv })}
                          title="Rollback to previous approved config"
                          className="p-1.5 rounded-lg text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/60 cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}

                      {!srv.isActive && (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => setPendingAction({ type: 'delete', srv })}
                          title="Remove server"
                          className="p-1.5 rounded-lg text-[#94A3B8] dark:text-[#8E88B0] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/50 dark:bg-black/75 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-[30px] tp-modal-glass p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-[#17143A] dark:text-[#F4F2FF]">
                {editing ? 'Edit Server Endpoint' : 'Register Approved Server'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-xl text-[#4B4772] dark:text-[#C5BFE4] hover:bg-[#F4F1FF] dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-400/30 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                {error}
              </div>
            )}
            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Server Display Name *</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Asia Southeast Primary API"
                  className="tp-input w-full rounded-xl px-3 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Hostname *</label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="api.thinkpulse.example.com"
                    className="tp-input w-full rounded-xl px-3 py-2 text-sm font-mono text-[#17143A] dark:text-[#F4F2FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Port *</label>
                  <input
                    type="number"
                    required
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value) || 443)}
                    className="tp-input w-full rounded-xl px-3 py-2 text-sm font-mono text-[#17143A] dark:text-[#F4F2FF]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Protocol</label>
                  <select
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value as 'https' | 'http')}
                    className="tp-input w-full rounded-xl px-3 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                  >
                    <option value="https">HTTPS</option>
                    <option value="http">HTTP (non-prod only)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">Environment</label>
                  <select
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as ServerEnvironment)}
                    className="tp-input w-full rounded-xl px-3 py-2 text-sm text-[#17143A] dark:text-[#F4F2FF]"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#17143A] dark:text-[#F4F2FF] mb-1">API Base URL *</label>
                <input
                  type="url"
                  required
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.thinkpulse.example.com"
                  className="tp-input w-full rounded-xl px-3 py-2 text-sm font-mono text-[#17143A] dark:text-[#F4F2FF]"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-[#17143A] dark:text-[#E5E0FF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="accent-[#7C3AED]"
                />
                <span>Endpoint enabled for activation</span>
              </label>

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
                  disabled={busyId === 'save'}
                  className="tp-gradient-btn text-white px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {busyId === 'save' ? 'Validating...' : editing ? 'Save Changes' : 'Register Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.type === 'activate'
            ? 'Activate Approved Endpoint?'
            : pendingAction?.type === 'rollback'
            ? 'Rollback Server Configuration?'
            : 'Remove Server Target?'
        }
        description={
          pendingAction?.type === 'activate'
            ? `Set "${pendingAction.srv.displayName}" (${pendingAction.srv.apiBaseUrl}) as the active approved endpoint?`
            : pendingAction?.type === 'rollback'
            ? `Roll back "${pendingAction.srv.displayName}" to its previous approved configuration?`
            : pendingAction
            ? `Remove "${pendingAction.srv.displayName}" from the server registry?`
            : ''
        }
        confirmLabel={
          pendingAction?.type === 'activate'
            ? 'Activate'
            : pendingAction?.type === 'rollback'
            ? 'Rollback'
            : 'Remove'
        }
        tone={pendingAction?.type === 'delete' ? 'danger' : 'primary'}
        onCancel={() => setPendingAction(null)}
        onConfirm={handleConfirmPendingAction}
      />
    </div>
  );
}
