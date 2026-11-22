import crypto from 'crypto';
import type { Response } from 'express';
import type { RealtimeEvent, RealtimeEventType, UserRole } from '../../shared/types.ts';

interface SseClient {
  id: string;
  userId: string;
  institutionId: string;
  role: UserRole;
  res: Response;
}

interface SseTicket {
  userId: string;
  institutionId: string;
  role: UserRole;
  expiresAt: number;
}

const clients = new Map<string, SseClient>();
const tickets = new Map<string, SseTicket>();

export function issueRealtimeTicket(params: {
  userId: string;
  institutionId: string;
  role: UserRole;
}): string {
  const now = Date.now();
  // Prune expired tickets
  for (const [k, v] of tickets.entries()) {
    if (v.expiresAt < now) tickets.delete(k);
  }
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticket, {
    ...params,
    expiresAt: now + 60_000, // 60 second one-time ticket
  });
  return ticket;
}

export function consumeRealtimeTicket(ticket: string): SseTicket | null {
  const found = tickets.get(ticket);
  if (!found) return null;
  tickets.delete(ticket);
  if (found.expiresAt < Date.now()) return null;
  return found;
}

export function registerSseClient(params: {
  userId: string;
  institutionId: string;
  role: UserRole;
  res: Response;
}): () => void {
  const id = crypto.randomUUID();
  clients.set(id, { ...params, id });

  // Send initial connected comment
  params.res.write(`: connected ${id}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      params.res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      clients.delete(id);
    }
  }, 25_000);

  return () => {
    clearInterval(heartbeat);
    clients.delete(id);
  };
}

export function publishRealtimeEvent(params: {
  type: RealtimeEventType;
  institutionId: string;
  assessmentId?: string;
  sessionId?: string;
  submissionId?: string;
  studentId?: string;
  payload: Record<string, unknown>;
}): void {
  const event: RealtimeEvent = {
    eventId: crypto.randomUUID(),
    type: params.type,
    institutionId: params.institutionId,
    assessmentId: params.assessmentId,
    sessionId: params.sessionId,
    submissionId: params.submissionId,
    studentId: params.studentId,
    payload: params.payload,
    timestamp: new Date().toISOString(),
  };

  const wire = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients.values()) {
    if (client.institutionId !== event.institutionId) continue;

    // Hosts & Platform Admins receive all institution-scoped assessment/session/submission/student events
    if (client.role === 'host' || client.role === 'platform_admin') {
      try {
        client.res.write(wire);
      } catch {
        clients.delete(client.id);
      }
      continue;
    }

    // Students ONLY receive their own graded/recalculated events or active session lifecycle updates
    if (client.role === 'student') {
      const isOwnResult =
        (event.type === 'submission.graded' || event.type === 'submission.recalculated') &&
        event.studentId === client.userId;
      const isSessionLifecycle =
        event.type === 'assessment.session_extended' || event.type === 'assessment.session_ended';

      if (isOwnResult || isSessionLifecycle) {
        // Strip studentId from broadcast payload if not needed
        try {
          client.res.write(wire);
        } catch {
          clients.delete(client.id);
        }
      }
    }
  }
}
