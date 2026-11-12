import { supabase } from './supabase';

export type LiveAlertKind =
  | 'person_presence'
  | 'vehicle_presence'
  | 'watchlist_match'
  | 'face_match'
  | 'weapon'
  | 'vehicle_recognition'
  | 'rule_trigger'
  | 'intrusion'
  | 'tamper'
  | 'camera_offline';

export interface LiveAlertPayload {
  id: string;
  workspaceId: string;
  kind: LiveAlertKind;
  title: string;
  details: string;
  severity: 'low' | 'medium' | 'high';
  cameraId?: string | null;
  cameraName?: string;
  plate?: string;
  faceName?: string;
  subjectCode?: string | null;
  confidence?: number | null;
  recommendedAction?: string;
  snapshotUrl?: string;
  eventId?: string;
  occurredAt: string;
}

const LIVE_ALERT_EVENT = 'lv:live-alert';
const ALERTS_UPDATED_EVENT = 'lv:alerts-updated';
const recentDedupe = new Map<string, number>();
const presenceIds=new Set<string>();

export function notifyAlertsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ALERTS_UPDATED_EVENT));
}

export function subscribeAlertsChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = () => handler();
  window.addEventListener(ALERTS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(ALERTS_UPDATED_EVENT, listener);
}

export function emitLiveAlert(
  input: Omit<LiveAlertPayload, 'id' | 'occurredAt'> & { id?: string; occurredAt?: string; dedupeKey?: string },
): LiveAlertPayload | null {
  if(input.id&&['person_presence','vehicle_presence'].includes(input.kind)){
    if(presenceIds.has(input.id))return null;presenceIds.add(input.id);
    if(presenceIds.size>1000)presenceIds.delete(presenceIds.values().next().value!);
  }
  const now = Date.now();
  const key = input.dedupeKey || `${input.workspaceId}:${input.kind}:${input.title}:${input.plate || input.faceName || ''}`;
  const last = recentDedupe.get(key);
  if (last !== undefined && now - last < 10_000) {
    return null;
  }
  recentDedupe.set(key, now);
  if (recentDedupe.size > 150) {
    for (const [k, ts] of recentDedupe.entries()) {
      if (now - ts > 60_000) recentDedupe.delete(k);
    }
  }

  const payload: LiveAlertPayload = {
    id: input.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `alert-${now}`),
    workspaceId: input.workspaceId,
    kind: input.kind,
    title: input.title,
    details: input.details,
    severity: input.severity,
    cameraId: input.cameraId ?? null,
    cameraName: input.cameraName,
    plate: input.plate,
    faceName: input.faceName,
    subjectCode: input.subjectCode,
    confidence: input.confidence,
    recommendedAction: input.recommendedAction,
    snapshotUrl: input.snapshotUrl,
    eventId: input.eventId,
    occurredAt: input.occurredAt || new Date(now).toISOString(),
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<LiveAlertPayload>(LIVE_ALERT_EVENT, { detail: payload }));
  }
  return payload;
}

export function subscribeLiveAlerts(handler: (alert: LiveAlertPayload) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (evt: Event) => {
    const custom = evt as CustomEvent<LiveAlertPayload>;
    if (custom.detail) handler(custom.detail);
  };
  window.addEventListener(LIVE_ALERT_EVENT, listener);
  return () => window.removeEventListener(LIVE_ALERT_EVENT, listener);
}

export async function dispatchOperationalAlert(opts: {
  workspaceId: string;
  kind: LiveAlertKind;
  title: string;
  details: string;
  severity: 'low' | 'medium' | 'high';
  cameraId?: string | null;
  cameraName?: string;
  plate?: string;
  faceName?: string;
  subjectCode?: string | null;
  confidence?: number | null;
  recommendedAction?: string;
  snapshotUrl?: string;
  eventId?: string;
  dedupeKey?: string;
  persistAlert?: boolean;
}): Promise<LiveAlertPayload | null> {
  const emitted = emitLiveAlert(opts);
  if (!emitted) return null;

  if (opts.persistAlert !== false) {
    try {
      const safeDetails = [
        opts.details,
        opts.cameraName ? `Source: ${opts.cameraName}` : '',
        opts.recommendedAction ? `Action: ${opts.recommendedAction}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 4000);

      // Uses base insert-granted columns (workspace_id, title, details, severity) so it works across all DB revisions.
      const { error } = await supabase.from('lv_agency_alerts').insert({
        workspace_id: opts.workspaceId,
        title: opts.title.slice(0, 140),
        details: safeDetails,
        severity: opts.severity,
      });
      if (!error) notifyAlertsChanged();
    } catch {
      // UI popup still fires even if DB persistence fails offline or in unit mocks
    }
  }

  return emitted;
}

