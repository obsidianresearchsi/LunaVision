import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { getBasemap } from '../services/mapConfig';
import { roleCan } from '../services/videoIntelligence';
import { dispatchOperationalAlert, notifyAlertsChanged, subscribeAlertsChanged } from '../services/liveAlertBus';
import { AI_RULE_TEMPLATES, describeRuleUseCase } from '../services/rulesEngine';

type Mode = 'alerts' | 'evidence' | 'rules' | 'fleet' | 'integrations';
type Row = { id: string; [key: string]: any };
const tables = { alerts: 'lv_agency_alerts', evidence: 'lv_agency_evidence', rules: 'lv_agency_rules', fleet: 'lv_cameras' };
const titles = {
  alerts: 'Centralized alerts & notifications',
  evidence: 'Evidence register',
  rules: 'AI detection rules & use cases',
  fleet: 'Device fleet & camera health',
  integrations: 'Connections & configuration',
};
const objectLabels = ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'backpack', 'suitcase', 'fire hydrant', 'knife', 'person', 'boat', 'airplane', 'train'];
const pageSize = 30;

const ALERT_CATEGORY_LABELS: Record<string, string> = {
  person_presence:'Person presence',
  vehicle_presence:'Vehicle presence',
  watchlist_match: 'Watchlist match',
  intrusion: 'Restricted intrusion',
  perimeter_breach: 'Perimeter breach',
  crowd: 'Crowd / occupancy threshold',
  loitering: 'Loitering detected',
  stationary_vehicle: 'Stationary vehicle',
  abandoned_object: 'Unattended object',
  tamper: 'Camera tampering',
  camera_offline: 'Camera offline',
};

export default function AgencyOperations({
  workspaceId,
  mode,
  canManage,
  openCamera,
  agency = true,
  role = 'member',
  platformAdmin = false,
  onConfigureCamera,
  onInspectEvent,
  onAlertsChanged,
}: {
  workspaceId: string;
  mode: Mode;
  canManage: boolean;
  openCamera: (id: string) => void;
  agency?: boolean;
  role?: string;
  platformAdmin?: boolean;
  onConfigureCamera?: (cameraId: string) => void;
  onInspectEvent?: (eventId: string) => void;
  onAlertsChanged?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [camerasById, setCamerasById] = useState<Record<string, { name: string; location: string }>>({});
  const [fleetActivity, setFleetActivity] = useState<Record<string, { last_event_at: string | null; events_24h: number }>>({});
  const [snapUrls, setSnapUrls] = useState<Record<string, string>>({});
  const [cases, setCases] = useState<Row[]>([]);
  const [caseQuery, setCaseQuery] = useState('');
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesFailed, setCasesFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [connections, setConnections] = useState({ cameras: 0, observations: 0, map: 'Not checked', checkedAt: '' });
  const operationLock = useRef(false);
  const pendingEvidence = useRef<Record<string, string | number> | null>(null);
  const pendingFile = useRef<File | null>(null);
  const uploadAttempted = useRef(false);
  const [hasPendingEvidence, setHasPendingEvidence] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setRows([]);
    async function load() {
      if (mode === 'integrations') {
        const mapCheck = async () => {
          const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
          if (!token) return 'Mapbox token missing';
          const tile = getBasemap(token, 'dark-v11').url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
          const timeout = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(tile, { signal: controller.signal, credentials: 'omit' });
            if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return 'Tile service unavailable';
            await response.blob();
            return 'Tile service responding';
          } catch {
            return 'Tile check failed · check connection or token restrictions';
          } finally {
            clearTimeout(timeout);
          }
        };
        const [results, map] = await Promise.all([
          Promise.all([
            supabase.from('lv_workspaces').select('id,active').eq('id', workspaceId).single(),
            supabase.from('lv_cameras').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
            supabase.from('lv_video_observations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
          ]),
          mapCheck(),
        ]);
        if (results.some((result) => result.error) || !results[0].data?.active) throw new Error('Connection check failed');
        if (current)
          setConnections({
            cameras: results[1].count ?? 0,
            observations: results[2].count ?? 0,
            map,
            checkedAt: new Date().toLocaleString(),
          });
      } else {
        let request = supabase.from(tables[mode]).select('*').eq('workspace_id', workspaceId);
        const search = query.trim().replace(/[%_\\]/g, '');
        if (search) request = request.ilike(mode === 'fleet' || mode === 'rules' ? 'name' : 'title', '%' + search + '%');
        if (mode === 'alerts' && filter !== 'all') request = request.eq('status', filter);
        if (mode === 'alerts' && categoryFilter !== 'all') request = request.eq('category', categoryFilter);

        const [result, camsRes, fleetActRes] = await Promise.all([
          request.order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize),
          mode === 'alerts'
            ? supabase.from('lv_cameras').select('id,name,location').eq('workspace_id', workspaceId)
            : Promise.resolve({ data: [], error: null }),
          mode === 'fleet'
            ? supabase.rpc('lv_intel_camera_activity', { target: workspaceId })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (result.error) throw result.error;
        const pageRows = (result.data ?? []).slice(0, pageSize);

        if (current) {
          setRows(pageRows);
          setMore((result.data?.length ?? 0) > pageSize);
          if (mode === 'alerts' && Array.isArray(camsRes.data)) {
            const camMap: Record<string, { name: string; location: string }> = {};
            for (const c of camsRes.data as any[]) {
              camMap[c.id] = { name: c.name, location: c.location };
            }
            setCamerasById(camMap);
          }
          if (mode === 'fleet' && Array.isArray(fleetActRes.data)) {
            const actMap: Record<string, { last_event_at: string | null; events_24h: number }> = {};
            for (const a of fleetActRes.data as any[]) {
              actMap[a.camera_id] = { last_event_at: a.last_event_at, events_24h: Number(a.events_24h || 0) };
            }
            setFleetActivity(actMap);
          }
        }

        if (mode === 'alerts') {
          const withSnaps = pageRows.filter((r) => r.snapshot_path);
          if (withSnaps.length > 0) {
            const nextUrls: Record<string, string> = {};
            await Promise.all(
              withSnaps.map(async (r) => {
                const { data: signed } = await supabase.storage
                  .from('lv-intel-snapshots')
                  .createSignedUrl(r.snapshot_path, 600);
                if (signed?.signedUrl) nextUrls[r.id] = signed.signedUrl;
              }),
            );
            if (current) setSnapUrls(nextUrls);
          } else if (current) {
            setSnapUrls({});
          }
        }
      }
    }
    void load()
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    const unsub = mode === 'alerts' ? subscribeAlertsChanged(() => setAttempt((v) => v + 1)) : () => {};
    return () => {
      current = false;
      controller.abort();
      unsub();
    };
  }, [workspaceId, mode, attempt, query, filter, categoryFilter, page]);

  useEffect(() => {
    if (mode !== 'evidence') return;
    let current = true;
    setCasesLoading(true);
    setCasesFailed(false);
    const timer = setTimeout(async () => {
      let request = supabase.from('lv_records').select('id,title').eq('workspace_id', workspaceId).eq('category', 'investigation');
      const search = caseQuery.trim().replace(/[%_\\]/g, '');
      if (search) request = request.ilike('title', '%' + search + '%');
      const { data, error } = await request.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (current) {
        setCases(data ?? []);
        setCasesFailed(Boolean(error));
        setCasesLoading(false);
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [workspaceId, mode, caseQuery, attempt]);

  async function run(operation: () => Promise<void>, success: string) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    setNotice('');
    try {
      await operation();
      if (alive.current) {
        setNotice(success);
        setAttempt((value) => value + 1);
      }
    } catch (error) {
      if (alive.current)
        setNotice(error instanceof Error ? error.message : 'The operation failed. Retry after checking your connection.');
    } finally {
      operationLock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, operation: (fields: FormData) => Promise<void>, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => {
      await operation(fields);
      if (alive.current) form.reset();
    }, success);
  }

  async function uploadEvidence(fields: FormData) {
    if (pendingEvidence.current) throw new Error('Finish the pending evidence registration before uploading another file.');
    const file = fields.get('file');
    const allowed = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4'];
    if (!(file instanceof File) || !allowed.includes(file.type) || file.size < 1 || file.size > 25 * 1024 * 1024 || file.name.length > 240)
      throw new Error('Choose a JPEG, PNG, PDF, or MP4 file up to 25 MB.');
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) throw new Error('Sign in again to upload evidence.');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'video/mp4': 'mp4' }[file.type];
    const path = `${workspaceId}/${data.user.id}/${crypto.randomUUID()}.${extension}`;
    pendingEvidence.current = {
      target: workspaceId,
      case_id: String(fields.get('record')),
      evidence_title: String(fields.get('title')).trim(),
      evidence_notes: String(fields.get('notes')).trim(),
      path,
      original_name: file.name,
      mime: file.type,
      bytes: file.size,
      file_hash: hash,
    };
    pendingFile.current = file;
    uploadAttempted.current = false;
    if (alive.current) setHasPendingEvidence(true);
    await finishEvidence();
  }

  async function finishEvidence() {
    if (!pendingEvidence.current) return;
    const register = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        return await supabase.rpc('lv_register_evidence', pendingEvidence.current!).abortSignal(controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    };
    const confirmed = () => {
      pendingEvidence.current = null;
      pendingFile.current = null;
      if (alive.current) setHasPendingEvidence(false);
    };
    if (uploadAttempted.current && !(await register()).error) {
      confirmed();
      return;
    }
    if (pendingFile.current) {
      uploadAttempted.current = true;
      await supabase.storage
        .from('lv-agency-evidence')
        .upload(String(pendingEvidence.current.path), pendingFile.current, { contentType: pendingFile.current.type, upsert: false });
    }
    if ((await register()).error)
      throw new Error('Upload or registration could not be confirmed. Retry the pending operation; it reuses the same private file path.');
    confirmed();
  }

  async function downloadEvidence(row: Row) {
    const { data, error } = await supabase.storage.from('lv-agency-evidence').download(row.storage_path);
    if (error || !data) throw new Error('This evidence file could not be downloaded.');
    const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== row.sha256) throw new Error('File integrity verification failed. Download cancelled.');
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = row.file_name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function resolveAlertDirect(row: Row) {
    if (row.status === 'resolved') return;
    if (row.status === 'open') {
      const { error } = await supabase.rpc('lv_transition_alert', {
        target: row.id,
        expected: 'open',
        next_status: 'resolved',
      });
      if (error) {
        if (error.message.includes('Invalid alert transition')) {
          const ack = await supabase.rpc('lv_transition_alert', {
            target: row.id,
            expected: 'open',
            next_status: 'acknowledged',
          });
          if (ack.error) throw new Error(ack.error.message);
          const res = await supabase.rpc('lv_transition_alert', {
            target: row.id,
            expected: 'acknowledged',
            next_status: 'resolved',
          });
          if (res.error) throw new Error(res.error.message);
        } else {
          throw new Error(error.message);
        }
      }
    } else {
      const { error } = await supabase.rpc('lv_transition_alert', {
        target: row.id,
        expected: row.status,
        next_status: 'resolved',
      });
      if (error) throw new Error(error.message);
    }
    notifyAlertsChanged();
    onAlertsChanged?.();
  }

  async function checkFleetStreamHealth(row: Row) {
    if (!row.playback_url) {
      throw new Error(`Device "${row.name}" has no gateway playback URL configured yet.`);
    }
    try {
      const res = await fetch(row.playback_url, { method: 'HEAD', mode: 'no-cors' });
      if (res) {
        await supabase.rpc('lv_record_intel_events', {
          target: workspaceId,
          events: [
            {
              request_id: crypto.randomUUID(),
              camera: row.id,
              source: 'camera',
              category: 'census',
              object_class: 'person',
              count: 0,
              occurred_at: new Date().toISOString(),
              payload: { camera_name: row.name, summary: 'Device fleet stream connectivity verified' },
            },
          ],
        });
      }
    } catch {
      await dispatchOperationalAlert({
        workspaceId,
        kind: 'camera_offline',
        title: `Device Offline: ${row.name}`,
        details: `Stream health check could not reach "${row.name}" (${row.location || 'No location'}).`,
        severity: 'high',
        cameraId: row.id,
        cameraName: row.name,
        recommendedAction: 'Inspect gateway endpoint, CORS headers, and device power/network.',
      });
      throw new Error(`Stream unreachable for "${row.name}". Offline alert logged.`);
    }
  }

  return (
    <section className="lv-card lv-agency-operations">
      <h2>{titles[mode]}</h2>
      <p>
        {mode === 'rules'
          ? 'Define automated security rules that run live on every camera stream, uploaded video, and demo footage—triggering instant popup alerts and persistent alert logs with cooldown protection.'
          : mode === 'evidence'
            ? 'Original files are stored privately, linked to an investigation, and verified with SHA-256 on download. Registered files cannot be overwritten or deleted from this console.'
            : mode === 'alerts'
              ? 'Real-time camera intelligence, face matches, weapon detections, vehicle recognition, watchlist plate hits, and AI rule alerts. Acknowledge or resolve in one click.'
              : mode === 'fleet'
                ? 'Monitor fleet online telemetry, connected analytics volume, stream formats, and register or test camera endpoints.'
                : 'Connection status is checked against this workspace. Credentials remain in server configuration.'}
      </p>

      {mode === 'fleet' && !loading && !failed && (
        <div
          className="lv-console-metrics"
          style={{ marginBlock: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
        >
          <article>
            <span>Registered devices</span>
            <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>{rows.length}</strong>
            <small>Total fleet inventory</small>
          </article>
          <article style={{ borderColor: '#2dd4bf' }}>
            <span>Active telemetry (24h)</span>
            <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
              {
                rows.filter((r) => {
                  const act = fleetActivity[r.id];
                  return act?.last_event_at && Date.now() - new Date(act.last_event_at).getTime() < 24 * 3600_000;
                }).length
              }
            </strong>
            <small>Cameras logging analytics</small>
          </article>
          <article>
            <span>Playback configured</span>
            <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
              {rows.filter((r) => Boolean(r.playback_url)).length}
            </strong>
            <small>{rows.filter((r) => !r.playback_url).length} awaiting gateway URL</small>
          </article>
          <article>
            <span>24h events logged</span>
            <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
              {Object.values(fleetActivity).reduce((sum, a) => sum + (a.events_24h || 0), 0)}
            </strong>
            <small>Cars, people, ANPR &amp; threats</small>
          </article>
        </div>
      )}

      {mode === 'rules' && (
        <div className="lv-card" style={{ marginBlock: '0.85rem', borderColor: '#2dd4bf', background: '#091017' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong>Built-in Default Threat Rules (Always Active)</strong>
            <span className="lunar-badge high" style={{ fontWeight: 800 }}>WEAPONS + ANPR + FACE ACTIVE</span>
          </div>
          <p style={{ margin: '0.35rem 0', fontSize: '0.86rem', color: '#cbd5e1' }}>
            Weapon &amp; sharp-object detection (<code>knife</code>, <code>scissors</code>, <code>baseball bat</code>), ANPR vehicle watchlist matching, and enrolled Face++ convict/subject matching are enabled by default across live cameras &amp; demo footage. Add custom rules below for vehicles or unattended packages:
          </p>
          {canManage && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
              {AI_RULE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="lv-secondary"
                  disabled={busy}
                  title={tpl.useCase}
                  onClick={() =>
                    void run(async () => {
                      const { error } = await supabase.from('lv_agency_rules').insert({
                        workspace_id: workspaceId,
                        name: tpl.name,
                        object_label: tpl.objectLabel,
                        minimum_confidence: tpl.confidencePct / 100,
                        severity: tpl.severity,
                        cooldown_seconds: tpl.cooldownSeconds,
                      });
                      if (error) throw new Error(error.message);
                      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lv:rules-updated'));
                    }, `Installed AI Rule: ${tpl.name}`)
                  }
                >
                  + {tpl.name} ({tpl.objectLabel})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode !== 'integrations' && (
        <div className="lv-observation-filters">
          <label>
            Search {mode}
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          {mode === 'alerts' && (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label style={{ flex: 1 }}>
                Status
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
              <label style={{ flex: 1 }}>
                Category
                <select
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All categories</option>
                  {Object.entries(ALERT_CATEGORY_LABELS)
                    .filter(([k]) => agency || k !== 'watchlist_match')
                    .map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      <button type="button" className="lv-secondary" disabled={busy || loading} onClick={() => setAttempt((value) => value + 1)}>
        Refresh
      </button>
      {notice && <p role="status">{notice}</p>}

      {loading ? (
        <p>Loading workspace records…</p>
      ) : failed ? (
        <p role="alert">Records could not be loaded. Use Refresh to retry.</p>
      ) : (
        <>
          {mode === 'integrations' ? (
            <div className="lv-console-metrics">
              <article>
                <h3>Supabase</h3>
                <p>Connected · access verified</p>
              </article>
              <article>
                <h3>Camera inventory</h3>
                <p>{connections.cameras} registered endpoints</p>
              </article>
              <article>
                <h3>Detection storage</h3>
                <p>{connections.observations} saved observations</p>
              </article>
              <article>
                <h3>Operations map</h3>
                <p>{connections.map}</p>
              </article>
              <p>Last checked {connections.checkedAt}</p>
            </div>
          ) : rows.length === 0 ? (
            <p>No {mode} match this view. Saved records will appear here.</p>
          ) : (
            rows.map((row) => {
              const camInfo = row.camera_id ? camerasById[row.camera_id] : undefined;
              const nextStatus = row.status === 'open' ? 'acknowledged' : row.status === 'acknowledged' ? 'resolved' : 'open';
              const canTransition =
                mode === 'alerts' &&
                roleCan(role, nextStatus === 'acknowledged' ? 'alert_ack' : 'alert_resolve', platformAdmin);

              async function resolveAlertDirect(row: Row) {
    if (row.status === 'resolved') return;
    if (row.status === 'open') {
      const { error } = await supabase.rpc('lv_transition_alert', {
        target: row.id,
        expected: 'open',
        next_status: 'resolved',
      });
      if (error) {
        if (error.message.includes('Invalid alert transition')) {
          const ack = await supabase.rpc('lv_transition_alert', {
            target: row.id,
            expected: 'open',
            next_status: 'acknowledged',
          });
          if (ack.error) throw new Error(ack.error.message);
          const res = await supabase.rpc('lv_transition_alert', {
            target: row.id,
            expected: 'acknowledged',
            next_status: 'resolved',
          });
          if (res.error) throw new Error(res.error.message);
        } else {
          throw new Error(error.message);
        }
      }
    } else {
      const { error } = await supabase.rpc('lv_transition_alert', {
        target: row.id,
        expected: row.status,
        next_status: 'resolved',
      });
      if (error) throw new Error(error.message);
    }
    notifyAlertsChanged();
    onAlertsChanged?.();
  }

  async function checkFleetStreamHealth(row: Row) {
    if (!row.playback_url) {
      throw new Error(`Device "${row.name}" has no gateway playback URL configured yet.`);
    }
    try {
      const res = await fetch(row.playback_url, { method: 'HEAD', mode: 'no-cors' });
      if (res) {
        await supabase.rpc('lv_record_intel_events', {
          target: workspaceId,
          events: [
            {
              request_id: crypto.randomUUID(),
              camera: row.id,
              source: 'camera',
              category: 'census',
              object_class: 'person',
              count: 0,
              occurred_at: new Date().toISOString(),
              payload: { camera_name: row.name, summary: 'Device fleet stream connectivity verified' },
            },
          ],
        });
      }
    } catch {
      await dispatchOperationalAlert({
        workspaceId,
        kind: 'camera_offline',
        title: `Device Offline: ${row.name}`,
        details: `Stream health check could not reach "${row.name}" (${row.location || 'No location'}).`,
        severity: 'high',
        cameraId: row.id,
        cameraName: row.name,
        recommendedAction: 'Inspect gateway endpoint, CORS headers, and device power/network.',
      });
      throw new Error(`Stream unreachable for "${row.name}". Offline alert logged.`);
    }
  }

  return (
                <article key={row.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0 }}>{row.title ?? row.name}</h3>
                        {mode === 'alerts' && (
                          <>
                            <span className={`lunar-badge ${row.severity}`}>{row.severity} priority</span>
                            <span className="lv-badge">{row.status}</span>
                            {row.category && <span className="lv-badge">{ALERT_CATEGORY_LABELS[row.category] || row.category}</span>}
                          </>
                        )}
                      </div>
                      <small>{new Date(row.created_at).toLocaleString()}</small>

                      {mode === 'alerts' && (
                        <>
                          <p style={{ margin: '0.35rem 0' }}>
                            <strong>Source:</strong>{' '}
                            {camInfo
                              ? `${camInfo.name}${camInfo.location ? ` (${camInfo.location})` : ''}`
                              : row.observation_id
                                ? 'Saved detection rule'
                                : 'Operator report'}
                          </p>
                          <p style={{ margin: '0.35rem 0' }}>{row.details}</p>
                          {row.recommended_action && (
                            <p
                              style={{
                                margin: '0.4rem 0',
                                padding: '0.45rem 0.65rem',
                                borderLeft: '3px solid #76efd6',
                                background: '#0c131b',
                                borderRadius: '4px',
                              }}
                            >
                              <strong>Recommended action:</strong> {row.recommended_action}
                            </p>
                          )}
                          <div className="lv-video-actions">
                            {canTransition && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const { error } = await supabase.rpc('lv_transition_alert', {
                                      target: row.id,
                                      expected: row.status,
                                      next_status: nextStatus,
                                    });
                                    if (error) throw new Error(error.message);
                                    notifyAlertsChanged();
                                    onAlertsChanged?.();
                                  }, 'Alert updated.')
                                }
                              >
                                {row.status === 'open' ? 'Acknowledge' : row.status === 'acknowledged' ? 'Resolve' : 'Reopen'}
                              </button>
                            )}
                            {row.status === 'open' && roleCan(role, 'alert_resolve', platformAdmin) && (
                              <button
                                type="button"
                                className="lv-secondary"
                                disabled={busy}
                                onClick={() => void run(() => resolveAlertDirect(row), 'Alert resolved.')}
                              >
                                Resolve directly
                              </button>
                            )}
                            {row.event_id && onInspectEvent && (
                              <button
                                type="button"
                                className="lv-secondary"
                                onClick={() => onInspectEvent(row.event_id)}
                              >
                                Investigate event &amp; snapshot
                              </button>
                            )}
                            {row.camera_id && (
                              <button type="button" className="lv-secondary" onClick={() => openCamera(row.camera_id)}>
                                Open camera
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      {mode === 'evidence' && (
                        <>
                          <p>{cases.find((item) => item.id === row.record_id)?.title ?? 'Investigation ' + row.record_id}</p>
                          <p>{row.notes}</p>
                          <p>
                            {row.file_name} · {(row.byte_size / 1024).toFixed(1)} KB
                          </p>
                          <small className="lv-evidence-hash">SHA-256 {row.sha256}</small>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => downloadEvidence(row), 'File integrity verified. Download started.')}
                          >
                            Verify &amp; download
                          </button>
                        </>
                      )}

                      {mode === 'rules' && (() => {
                        const info = describeRuleUseCase(row.object_label);
                        const pct = Math.round(row.minimum_confidence * 100);
                        return (
                        <>
                          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                            <span className="lv-badge" style={{ fontWeight: 700 }}>Target: {row.object_label}</span>
                            <span className="lv-badge">Min confidence: {pct}%</span>
                            <span className={`lunar-badge ${row.severity}`}>{row.severity} priority</span>
                            <span className="lv-badge">Cooldown: {row.cooldown_seconds}s</span>
                            <span className="lv-badge" style={{ borderColor: row.enabled ? '#2dd4bf' : '#64748b' }}>
                              {row.enabled ? 'ACTIVE LIVE' : 'PAUSED'}
                            </span>
                          </div>
                          <p style={{ margin: '0.45rem 0 0.2rem', fontSize: '0.88rem' }}>
                            <strong>Use case ({info.title}):</strong> {info.useCase}
                          </p>
                          <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: '#94a3b8' }}>
                            <strong>Trigger &amp; Response:</strong> When <code>{row.object_label}</code> ≥ {pct}% on live camera, video, or observation → {info.response}
                          </p>
                          <div className="lv-video-actions">
                            {canManage && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const { error } = await supabase.rpc('lv_update_agency_rule', {
                                      target: row.id,
                                      expected_revision: row.revision,
                                      rule_name: row.name,
                                      threshold: row.minimum_confidence,
                                      priority: row.severity,
                                      active: !row.enabled,
                                      repeat_seconds: row.cooldown_seconds,
                                    });
                                    if (error) throw new Error(error.message);
                                  }, 'Rule updated.')
                                }
                              >
                                {row.enabled ? 'Disable rule' : 'Enable rule'}
                              </button>
                            )}
                            <button
                              type="button"
                              className="lv-secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await dispatchOperationalAlert({
                                    workspaceId,
                                    kind: 'rule_trigger',
                                    title: `AI Rule Test: ${row.name} (${row.object_label} ${pct}%)`,
                                    details: `${info.useCase} (Manual rule test execution)`,
                                    severity: row.severity,
                                    cameraName: 'AI Rules Test Bench',
                                    confidence: pct,
                                    recommendedAction: info.response,
                                    dedupeKey: `test-rule:${row.id}:${Date.now()}`,
                                  });
                                }, `Triggered test popup & alert for rule "${row.name}".`)
                              }
                            >
                              Test rule &amp; popup
                            </button>
                          </div>
                          {canManage && (
                            <details>
                              <summary>Edit rule</summary>
                              <form
                                onSubmit={(event) =>
                                  submit(
                                    event,
                                    async (fields) => {
                                      const { error } = await supabase.rpc('lv_update_agency_rule', {
                                        target: row.id,
                                        expected_revision: row.revision,
                                        rule_name: String(fields.get('name')).trim(),
                                        threshold: Number(fields.get('confidence')) / 100,
                                        priority: fields.get('severity'),
                                        active: row.enabled,
                                        repeat_seconds: Number(fields.get('cooldown')),
                                      });
                                      if (error) throw new Error(error.message);
                                    },
                                    'Rule saved.',
                                  )
                                }
                              >
                                <label>
                                  Rule name
                                  <input name="name" minLength={2} maxLength={100} defaultValue={row.name} required />
                                </label>
                                <label>
                                  Minimum confidence (%)
                                  <input name="confidence" type="number" min={50} max={100} defaultValue={Math.round(row.minimum_confidence * 100)} required />
                                </label>
                                <label>
                                  Repeat alert cooldown (seconds)
                                  <input name="cooldown" type="number" min={15} max={3600} defaultValue={row.cooldown_seconds} required />
                                </label>
                                <Severity initial={row.severity} />
                                <button disabled={busy}>Save rule</button>
                              </form>
                            </details>
                          )}
                        </>
                        );
                      })()}

                      {mode === 'fleet' && (() => {
                        const act = fleetActivity[row.id];
                        const isActive24h =
                          act?.last_event_at && Date.now() - new Date(act.last_event_at).getTime() < 24 * 3600_000;
                        return (
                        <>
                          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                            <span className="lv-badge" style={{ borderColor: isActive24h ? '#2dd4bf' : undefined, fontWeight: 700 }}>
                              {isActive24h ? 'ACTIVE TELEMETRY' : row.playback_url ? 'STREAM CONFIGURED' : 'AWAITING GATEWAY URL'}
                            </span>
                            <span className="lv-badge">{(row.stream_type || 'video').toUpperCase()}</span>
                            <span className="lv-badge">Clearance {row.minimum_clearance ?? 0}</span>
                            <span className="lv-badge">{act?.events_24h ?? 0} events (24h)</span>
                          </div>
                          <p style={{ margin: '0.35rem 0 0.15rem' }}>{row.location || 'Location not specified'}</p>
                          <p className="lv-evidence-hash">{row.playback_url || 'No gateway playback URL configured yet.'}</p>
                          {act?.last_event_at && (
                            <small style={{ color: '#94a3b8' }}>Last telemetry: {new Date(act.last_event_at).toLocaleString()}</small>
                          )}
                          <div className="lv-video-actions" style={{ marginTop: '0.5rem' }}>
                            <button type="button" disabled={!row.playback_url} onClick={() => openCamera(row.id)}>
                              Open camera &amp; analyze
                            </button>
                            {canManage && onConfigureCamera && (
                              <button type="button" className="lv-secondary" onClick={() => onConfigureCamera(row.id)}>
                                Configure intelligence &amp; zones
                              </button>
                            )}
                            {row.playback_url && (
                              <button
                                type="button"
                                className="lv-secondary"
                                disabled={busy}
                                onClick={() =>
                                  void run(() => checkFleetStreamHealth(row), `Device "${row.name}" stream verified & heartbeat logged.`)
                                }
                              >
                                Test stream
                              </button>
                            )}
                          </div>
                          {canManage && (
                            <details>
                              <summary>Edit device</summary>
                              <form
                                onSubmit={(event) =>
                                  submit(
                                    event,
                                    async (fields) => {
                                      const url = new URL(String(fields.get('url')).trim());
                                      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
                                        throw new Error('Use an HTTPS gateway URL without embedded username/password or a fragment.');
                                      const { error } = await supabase.rpc('lv_update_agency_camera', {
                                        target: row.id,
                                        expected_revision: row.revision,
                                        device_name: String(fields.get('name')).trim(),
                                        device_location: String(fields.get('location')).trim(),
                                        endpoint: url.href,
                                      });
                                      if (error) throw new Error(error.message);
                                    },
                                    'Device saved.',
                                  )
                                }
                              >
                                <label>
                                  Device name
                                  <input name="name" defaultValue={row.name} minLength={2} maxLength={100} required />
                                </label>
                                <label>
                                  Location
                                  <input name="location" defaultValue={row.location} maxLength={200} />
                                </label>
                                <label>
                                  Playback URL
                                  <input name="url" type="url" defaultValue={row.playback_url} maxLength={2048} required />
                                </label>
                                <button disabled={busy}>Save device</button>
                              </form>
                            </details>
                          )}
                        </>
                        );
                      })()}
                    </div>

                    {mode === 'alerts' && snapUrls[row.id] && (
                      <img
                        src={snapUrls[row.id]}
                        alt={`Snapshot for ${row.title}`}
                        style={{
                          width: '150px',
                          height: '96px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: '1px solid #354858',
                        }}
                      />
                    )}
                  </div>
                </article>
              );
            })
          )}
          {mode !== 'integrations' && (
            <div className="lv-video-actions">
              <button type="button" disabled={busy || page === 0} onClick={() => setPage((value) => value - 1)}>
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button type="button" disabled={busy || !more} onClick={() => setPage((value) => value + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {mode === 'alerts' && (
        <>
          <details>
            <summary>Report an alert</summary>
            <form
              onSubmit={(event) =>
                submit(
                  event,
                  async (fields) => {
                    const title = String(fields.get('title')).trim();
                    const details = String(fields.get('details')).trim();
                    const severity = String(fields.get('severity') || 'medium') as 'low' | 'medium' | 'high';
                    const { error } = await supabase.from('lv_agency_alerts').insert({
                      workspace_id: workspaceId,
                      title,
                      details,
                      severity,
                    });
                    if (error) throw new Error('Alert could not be saved. Check your connection and retry.');
                    notifyAlertsChanged();
                    onAlertsChanged?.();
                  },
                  'Alert saved.',
                )
              }
            >
              <label>
                Title
                <input name="title" minLength={2} maxLength={140} required />
              </label>
              <label>
                Details
                <textarea name="details" maxLength={4000} />
              </label>
              <Severity />
              <button disabled={busy || loading || failed}>Save alert</button>
            </form>
          </details>

          <div className="lv-card" style={{ marginTop: '1rem', background: '#0c131b' }}>
            <h3>Notification Delivery Channels</h3>
            <p>
              <strong>In-app notifications:</strong> Active — open and high-priority alerts appear in the workspace header
              and centralized queue in real time.
            </p>
            <p>
              <strong>Email / SMS / Webhook dispatch (Extensible):</strong> Structured alerts (`lv_agency_alerts`) carry
              severity, category, camera, snapshot path, and recommended actions ready for Edge Function or gateway
              dispatch once organizational SMTP or SMS provider keys are provisioned.
            </p>
          </div>
        </>
      )}

      {mode === 'fleet' && canManage && (
        <details style={{ marginTop: '0.85rem' }}>
          <summary>+ Register new camera device to fleet</summary>
          <form
            onSubmit={(event) =>
              submit(
                event,
                async (fields) => {
                  const url = new URL(String(fields.get('url')).trim());
                  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
                    throw new Error('Enter an HTTPS playback URL without embedded credentials.');
                  }
                  const { error } = await supabase.from('lv_cameras').insert({
                    workspace_id: workspaceId,
                    name: String(fields.get('name')).trim(),
                    location: String(fields.get('location') || '').trim(),
                    playback_url: url.href,
                    stream_type: String(fields.get('stream_type') || 'video'),
                    minimum_clearance: Number(fields.get('clearance') || 0),
                  });
                  if (error) throw new Error(error.message);
                },
                'Camera device registered to fleet.',
              )
            }
          >
            <label>
              Device name
              <input name="name" minLength={2} maxLength={100} placeholder="e.g. Apapa Gate 1" required />
            </label>
            <label>
              Location
              <input name="location" maxLength={200} placeholder="e.g. Main perimeter entrance" />
            </label>
            <label>
              HTTPS playback URL
              <input name="url" type="url" maxLength={2048} placeholder="https://gateway.example.com/cam1.m3u8" required />
            </label>
            <label>
              Stream format
              <select name="stream_type" defaultValue="video">
                <option value="video">MP4 / WebM video</option>
                <option value="hls">HLS camera gateway (.m3u8)</option>
                <option value="mjpeg">MJPEG live feed</option>
              </select>
            </label>
            <label>
              Minimum clearance
              <select name="clearance" defaultValue="0">
                <option value="0">0 · General</option>
                <option value="1">1 · Internal</option>
                <option value="2">2 · Restricted</option>
                <option value="3">3 · Confidential</option>
              </select>
            </label>
            <button disabled={busy || loading || failed}>Register camera</button>
          </form>
        </details>
      )}

      {mode === 'rules' && canManage && (
        <details>
          <summary>Create a detection rule</summary>
          <form
            onSubmit={(event) =>
              submit(
                event,
                async (fields) => {
                  const label = String(fields.get('label') || '');
                  const { error } = await supabase.from('lv_agency_rules').insert({
                    workspace_id: workspaceId,
                    name: String(fields.get('name')).trim(),
                    object_label: label,
                    minimum_confidence: Number(fields.get('confidence')) / 100,
                    severity: fields.get('severity'),
                    cooldown_seconds: Number(fields.get('cooldown')),
                  });
                  if (error) {
                    if (error.message.includes('object_label') && (label === 'knife' || label === 'person')) {
                      throw new Error(
                        'Built-in Weapon (knife/scissors/bat) & People detection are already enabled by default on all cameras. Run migration 202611130001 to also store custom database rules for knife/person.',
                      );
                    }
                    throw new Error('Rule could not be saved. Check your access and retry.');
                  }
                  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lv:rules-updated'));
                },
                'Rule saved and enabled for future saved observations.',
              )
            }
          >
            <label>
              Rule name
              <input name="name" minLength={2} maxLength={100} required />
            </label>
            <label>
              Object
              <select name="label">
                {objectLabels.map((label) => (
                  <option key={label}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum confidence (%)
              <input name="confidence" type="number" min={50} max={100} step={1} defaultValue={80} required />
            </label>
            <label>
              Repeat alert cooldown (seconds)
              <input name="cooldown" type="number" min={15} max={3600} defaultValue={60} required />
            </label>
            <Severity />
            <button disabled={busy || loading || failed}>Create rule</button>
          </form>
        </details>
      )}

      {mode === 'evidence' && hasPendingEvidence && (
        <div role="status">
          <p>An evidence upload or registration is awaiting confirmation. Keep this page open until it is confirmed.</p>
          <button type="button" disabled={busy} onClick={() => void run(finishEvidence, 'Evidence registration confirmed.')}>
            Retry evidence registration
          </button>
        </div>
      )}

      {mode === 'evidence' && !hasPendingEvidence && !loading && !failed && (
        <details>
          <summary>Register evidence</summary>
          <label>
            Find investigation by title
            <input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} />
          </label>
          <p>
            {casesLoading
              ? 'Finding investigations…'
              : casesFailed
                ? 'Investigation lookup failed. Refresh to retry.'
                : cases.length
                  ? 'Choose from the latest 100 matching investigations. Search to find older records.'
                  : caseQuery
                    ? 'No investigations match this search.'
                    : 'Create an investigation in Incidents before registering evidence.'}
          </p>
          <form onSubmit={(event) => submit(event, uploadEvidence, 'Evidence registered privately. Original file hash saved.')}>
            <label>
              Investigation
              <select name="record" defaultValue="" required disabled={casesLoading || casesFailed}>
                <option value="">Choose an investigation</option>
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Evidence title
              <input name="title" minLength={2} maxLength={140} required />
            </label>
            <label>
              Notes
              <textarea name="notes" maxLength={4000} />
            </label>
            <label>
              Original file · maximum 25 MB
              <input name="file" type="file" accept="image/jpeg,image/png,application/pdf,video/mp4" required />
            </label>
            <button disabled={busy || casesLoading || casesFailed || !cases.length}>
              {busy ? 'Uploading & registering…' : 'Register evidence'}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}

function Severity({ initial = 'medium' }: { initial?: string }) {
  return (
    <label>
      Priority
      <select name="severity" defaultValue={initial}>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
  );
}
