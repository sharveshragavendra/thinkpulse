import { useEffect, useRef } from 'react';
import { apiRequest, getAuthToken } from '../services/api.ts';
import type { RealtimeEvent, RealtimeEventType } from '../../shared/types.ts';

const ALL_EVENT_TYPES: RealtimeEventType[] = [
  'assessment.session_launched',
  'assessment.session_extended',
  'assessment.session_ended',
  'assessment.qr_rotated',
  'submission.created',
  'submission.graded',
  'submission.recalculated',
  'poll.responses_updated',
  'student.profile_updated',
];

export function useRealtime(
  enabled: boolean,
  onEvent: (event: RealtimeEvent) => void,
  onReconnect?: () => void
) {
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  const seenIdsRef = useRef<Set<string>>(new Set());

  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!enabled || !getAuthToken()) return;

    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = async () => {
      if (closed || !getAuthToken()) return;
      try {
        const { ticket } = await apiRequest<{ ticket: string }>('/realtime/ticket', {
          method: 'POST',
        });
        if (closed) return;

        source = new EventSource(`/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`);

        source.onopen = () => {
          if (attempt > 0) {
            onReconnectRef.current?.();
          }
          attempt = 0;
        };

        for (const eventType of ALL_EVENT_TYPES) {
          source.addEventListener(eventType, (evt) => {
            try {
              const parsed = JSON.parse((evt as MessageEvent).data) as RealtimeEvent;
              if (seenIdsRef.current.has(parsed.eventId)) return;
              seenIdsRef.current.add(parsed.eventId);
              if (seenIdsRef.current.size > 500) {
                const first = seenIdsRef.current.values().next().value;
                if (first) seenIdsRef.current.delete(first);
              }
              onEventRef.current(parsed);
            } catch {
              // ignore malformed frame
            }
          });
        }

        source.onerror = () => {
          source?.close();
          source = null;
          if (!closed) {
            attempt += 1;
            const delay = Math.min(15000, 1000 * Math.pow(1.6, attempt));
            retryTimer = setTimeout(connect, delay);
          }
        };
      } catch {
        if (!closed) {
          attempt += 1;
          const delay = Math.min(15000, 1500 * Math.pow(1.6, attempt));
          retryTimer = setTimeout(connect, delay);
        }
      }
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [enabled]);
}
