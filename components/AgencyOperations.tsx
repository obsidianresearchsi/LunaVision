import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { getBasemap } from '../services/mapConfig';

type Mode = 'alerts' | 'evidence' | 'rules' | 'fleet' | 'integrations';
type Row = { id: string; [key: string]: any };
const tables = { alerts: 'lv_agency_alerts', evidence: 'lv_agency_evidence', rules: 'lv_agency_rules', fleet: 'lv_cameras' };
const titles = { alerts: 'Alert queue', evidence: 'Evidence register', rules: 'Object detection rules', fleet: 'Device fleet', integrations: 'Connections & configuration' };
const objectLabels = ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'boat', 'airplane', 'train', 'fire hydrant', 'backpack', 'suitcase'];
const pageSize = 30;

export default function AgencyOperations({ workspaceId, mode, canManage, openCamera }: {
  workspaceId: string; mode: Mode; canManage: boolean; openCamera: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
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
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [connections, setConnections] = useState({ cameras: 0, observations: 0, map: 'Not checked', checkedAt: '' });
  const operationLock = useRef(false);
  const pendingEvidence = useRef<Record<string, string | number> | null>(null);
  const pendingFile = useRef<File | null>(null);
  const uploadAttempted = useRef(false);
  const [hasPendingEvidence, setHasPendingEvidence] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true); setFailed(false); setRows([]);
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
          } catch { return 'Tile check failed · check connection or token restrictions'; }
          finally { clearTimeout(timeout); }
        };
        const [results, map] = await Promise.all([Promise.all([
          supabase.from('lv_workspaces').select('id,active').eq('id', workspaceId).single(),
          supabase.from('lv_cameras').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
          supabase.from('lv_video_observations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        ]), mapCheck()]);
        if (results.some(result => result.error) || !results[0].data?.active) throw new Error('Connection check failed');
        if (current) setConnections({ cameras: results[1].count ?? 0, observations: results[2].count ?? 0, map, checkedAt: new Date().toLocaleString() });
      } else {
        let request = supabase.from(tables[mode]).select('*').eq('workspace_id', workspaceId);
        const search = query.trim().replace(/[%_\\]/g, '');
        if (search) request = request.ilike(mode === 'fleet' || mode === 'rules' ? 'name' : 'title', '%' + search + '%');
        if (mode === 'alerts' && filter !== 'all') request = request.eq('status', filter);
        const result = await request.order('created_at', { ascending: false }).order('id', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize);
        if (result.error) throw result.error;
        if (current) { setRows((result.data ?? []).slice(0, pageSize)); setMore((result.data?.length ?? 0) > pageSize); }
      }
    }
    void load().catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [workspaceId, mode, attempt, query, filter, page]);

  useEffect(() => {
    if (mode !== 'evidence') return;
    let current = true;
    setCasesLoading(true); setCasesFailed(false);
    const timer = setTimeout(async () => {
      let request = supabase.from('lv_records').select('id,title').eq('workspace_id', workspaceId).eq('category', 'investigation');
      const search = caseQuery.trim().replace(/[%_\\]/g, '');
      if (search) request = request.ilike('title', '%' + search + '%');
      const { data, error } = await request.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (current) { setCases(data ?? []); setCasesFailed(Boolean(error)); setCasesLoading(false); }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [workspaceId, mode, caseQuery, attempt]);

  async function run(operation: () => Promise<void>, success: string) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true); setNotice('');
    try {
      await operation();
      if (alive.current) { setNotice(success); setAttempt(value => value + 1); }
    } catch (error) {
      if (alive.current) setNotice(error instanceof Error ? error.message : 'The operation failed. Retry after checking your connection.');
    } finally { operationLock.current = false; if (alive.current) setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>, operation: (fields: FormData) => Promise<void>, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    void run(async () => { await operation(fields); if (alive.current) form.reset(); }, success);
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
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'video/mp4': 'mp4' }[file.type];
    const path = `${workspaceId}/${data.user.id}/${crypto.randomUUID()}.${extension}`;
    pendingEvidence.current = {
      target: workspaceId, case_id: String(fields.get('record')), evidence_title: String(fields.get('title')).trim(),
      evidence_notes: String(fields.get('notes')).trim(), path, original_name: file.name,
      mime: file.type, bytes: file.size, file_hash: hash,
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
      try { return await supabase.rpc('lv_register_evidence', pendingEvidence.current!).abortSignal(controller.signal); }
      finally { clearTimeout(timeout); }
    };
    const confirmed = () => {
      pendingEvidence.current = null;
      pendingFile.current = null;
      if (alive.current) setHasPendingEvidence(false);
    };
    // A previous response may have been lost after commit. Confirm it before attempting another upload.
    if (uploadAttempted.current && !(await register()).error) { confirmed(); return; }
    if (pendingFile.current) {
      uploadAttempted.current = true;
      // Reuse the original private path and never overwrite. Even if the upload response is lost,
      // registration can verify the existing object; an actual upload failure remains safely retryable.
      await supabase.storage.from('lv-agency-evidence').upload(String(pendingEvidence.current.path), pendingFile.current,
        { contentType: pendingFile.current.type, upsert: false });
    }
    if ((await register()).error) throw new Error('Upload or registration could not be confirmed. Retry the pending operation; it reuses the same private file path.');
    confirmed();
  }

  async function downloadEvidence(row: Row) {
    const { data, error } = await supabase.storage.from('lv-agency-evidence').download(row.storage_path);
    if (error || !data) throw new Error('This evidence file could not be downloaded.');
    const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== row.sha256) throw new Error('File integrity verification failed. Download cancelled.');
    const url = URL.createObjectURL(data);
    const link = document.createElement('a'); link.href = url; link.download = row.file_name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="lv-card lv-agency-operations">
    <h2>{titles[mode]}</h2>
    <p>{mode === 'rules' ? 'Enabled rules evaluate saved object detections. In Playback or a camera’s analysis view, enable automatic saving to evaluate footage every 15 seconds while the video plays in a visible browser tab. Cooldowns limit repeated alerts per camera; uploaded clips share a separate cooldown. Processing stops when the browser closes.'
      : mode === 'evidence' ? 'Original files are stored privately, linked to an investigation, and verified with SHA-256 on download. Registered files cannot be overwritten or deleted from this console.'
      : mode === 'alerts' ? 'Operator reports and matching saved object observations appear here. Acknowledge an alert before resolving it.'
      : mode === 'fleet' ? 'Manage registered devices and open their actual playback endpoints. Registration does not establish that a camera is online.'
      : 'Connection status is checked against this workspace. Credentials remain in server configuration.'}</p>
    {mode !== 'integrations' && <div className="lv-observation-filters">
      <label>Search {mode}<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      {mode === 'alerts' && <label>Status<select value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}>
        <option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option>
      </select></label>}
    </div>}
    <button type="button" className="lv-secondary" disabled={busy || loading} onClick={() => setAttempt(value => value + 1)}>Refresh</button>
    {notice && <p role="status">{notice}</p>}
    {loading ? <p>Loading workspace records…</p> : failed ? <p role="alert">Records could not be loaded. Use Refresh to retry.</p> : <>
      {mode === 'integrations' ? <div className="lv-console-metrics">
        <article><h3>Supabase</h3><p>Connected · access verified</p></article>
        <article><h3>Camera inventory</h3><p>{connections.cameras} registered endpoints</p></article>
        <article><h3>Detection storage</h3><p>{connections.observations} saved observations</p></article>
        <article><h3>Operations map</h3><p>{connections.map}</p></article>
        <p>Last checked {connections.checkedAt}</p>
      </div> : rows.length === 0 ? <p>No {mode} match this view. Saved records will appear here.</p> : rows.map(row => <article key={row.id}>
        <h3>{row.title ?? row.name}</h3>
        <small>{new Date(row.created_at).toLocaleString()}</small>
        {mode === 'alerts' && <>
          <p>{row.severity} priority · {row.status} · {row.observation_id ? 'Saved detection rule' : 'Operator report'}</p><p>{row.details}</p>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const { error } = await supabase.rpc('lv_transition_alert', { target: row.id, expected: row.status,
              next_status: row.status === 'open' ? 'acknowledged' : row.status === 'acknowledged' ? 'resolved' : 'open' });
            if (error) throw new Error(error.message);
          }, 'Alert updated.')}>
            {row.status === 'open' ? 'Acknowledge' : row.status === 'acknowledged' ? 'Resolve' : 'Reopen'}
          </button>
        </>}
        {mode === 'evidence' && <>
          <p>{cases.find(item => item.id === row.record_id)?.title ?? 'Investigation ' + row.record_id}</p>
          <p>{row.notes}</p><p>{row.file_name} · {(row.byte_size / 1024).toFixed(1)} KB</p>
          <small className="lv-evidence-hash">SHA-256 {row.sha256}</small>
          <button type="button" disabled={busy} onClick={() => void run(() => downloadEvidence(row), 'File integrity verified. Download started.')}>Verify & download</button>
        </>}
        {mode === 'rules' && <>
          <p>{row.object_label} · minimum {Math.round(row.minimum_confidence * 100)}% confidence · {row.severity} priority · {row.cooldown_seconds}s cooldown · {row.enabled ? 'Enabled' : 'Disabled'}</p>
          {canManage && <button type="button" disabled={busy} onClick={() => void run(async () => {
            const { error } = await supabase.rpc('lv_update_agency_rule', { target: row.id, expected_revision: row.revision,
              rule_name: row.name, threshold: row.minimum_confidence, priority: row.severity, active: !row.enabled, repeat_seconds: row.cooldown_seconds });
            if (error) throw new Error(error.message);
          }, 'Rule updated.')}>{row.enabled ? 'Disable rule' : 'Enable rule'}</button>}
          {canManage && <details><summary>Edit rule</summary><form onSubmit={event => submit(event, async fields => {
            const { error } = await supabase.rpc('lv_update_agency_rule', { target: row.id, expected_revision: row.revision,
              rule_name: String(fields.get('name')).trim(), threshold: Number(fields.get('confidence')) / 100,
              priority: fields.get('severity'), active: row.enabled, repeat_seconds: Number(fields.get('cooldown')) });
            if (error) throw new Error(error.message);
          }, 'Rule saved.')}>
            <label>Rule name<input name="name" minLength={2} maxLength={100} defaultValue={row.name} required /></label>
            <label>Minimum confidence (%)<input name="confidence" type="number" min={50} max={100} defaultValue={Math.round(row.minimum_confidence * 100)} required /></label>
            <label>Repeat alert cooldown (seconds)<input name="cooldown" type="number" min={15} max={3600} defaultValue={row.cooldown_seconds} required /></label>
            <Severity initial={row.severity} /><button disabled={busy}>Save rule</button>
          </form></details>}
        </>}
        {mode === 'fleet' && <>
          <p>{row.location || 'Location not specified'}</p><p className="lv-evidence-hash">{row.playback_url}</p>
          <button type="button" onClick={() => openCamera(row.id)}>Open camera</button>
          {canManage && <details><summary>Edit device</summary><form onSubmit={event => submit(event, async fields => {
            const url = new URL(String(fields.get('url')).trim());
            if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use a direct HTTPS URL without credentials or query parameters.');
            const { error } = await supabase.rpc('lv_update_agency_camera', { target: row.id, expected_revision: row.revision,
              device_name: String(fields.get('name')).trim(), device_location: String(fields.get('location')).trim(), endpoint: url.href });
            if (error) throw new Error(error.message);
          }, 'Device saved.')}>
            <label>Device name<input name="name" defaultValue={row.name} minLength={2} maxLength={100} required /></label>
            <label>Location<input name="location" defaultValue={row.location} maxLength={200} /></label>
            <label>Playback URL<input name="url" type="url" defaultValue={row.playback_url} maxLength={2048} required /></label>
            <button disabled={busy}>Save device</button>
          </form></details>}
        </>}
      </article>)}
      {mode !== 'integrations' && <div className="lv-video-actions">
        <button type="button" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>Page {page + 1}</span>
        <button type="button" disabled={busy || !more} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>}
    </>}
    {mode === 'alerts' && <details><summary>Report an alert</summary><form onSubmit={event => submit(event, async fields => {
      const { error } = await supabase.from('lv_agency_alerts').insert({ workspace_id: workspaceId, title: String(fields.get('title')).trim(), details: String(fields.get('details')).trim(), severity: fields.get('severity') });
      if (error) throw new Error('Alert could not be saved. Check your connection and retry.');
    }, 'Alert saved.')}>
      <label>Title<input name="title" minLength={2} maxLength={140} required /></label>
      <label>Details<textarea name="details" maxLength={4000} /></label>
      <Severity /><button disabled={busy || loading || failed}>Save alert</button>
    </form></details>}
    {mode === 'rules' && canManage && <details><summary>Create a detection rule</summary><form onSubmit={event => submit(event, async fields => {
      const { error } = await supabase.from('lv_agency_rules').insert({ workspace_id: workspaceId, name: String(fields.get('name')).trim(), object_label: fields.get('label'), minimum_confidence: Number(fields.get('confidence')) / 100, severity: fields.get('severity'), cooldown_seconds: Number(fields.get('cooldown')) });
      if (error) throw new Error('Rule could not be saved. Check your access and retry.');
    }, 'Rule saved and enabled for future saved observations.')}>
      <label>Rule name<input name="name" minLength={2} maxLength={100} required /></label>
      <label>Object<select name="label">{objectLabels.map(label => <option key={label}>{label}</option>)}</select></label>
      <label>Minimum confidence (%)<input name="confidence" type="number" min={50} max={100} step={1} defaultValue={80} required /></label>
      <label>Repeat alert cooldown (seconds)<input name="cooldown" type="number" min={15} max={3600} defaultValue={60} required /></label>
      <Severity /><button disabled={busy || loading || failed}>Create rule</button>
    </form></details>}
    {mode === 'evidence' && hasPendingEvidence && <div role="status"><p>An evidence upload or registration is awaiting confirmation. Keep this page open until it is confirmed.</p>
      <button type="button" disabled={busy} onClick={() => void run(finishEvidence, 'Evidence registration confirmed.')}>Retry evidence registration</button>
    </div>}
    {mode === 'evidence' && !hasPendingEvidence && !loading && !failed && <details><summary>Register evidence</summary>
      <label>Find investigation by title<input value={caseQuery} onChange={event => setCaseQuery(event.target.value)} /></label>
      <p>{casesLoading ? 'Finding investigations…' : casesFailed ? 'Investigation lookup failed. Refresh to retry.' : cases.length ? 'Choose from the latest 100 matching investigations. Search to find older records.' : caseQuery ? 'No investigations match this search.' : 'Create an investigation in Incidents before registering evidence.'}</p>
      <form onSubmit={event => submit(event, uploadEvidence, 'Evidence registered privately. Original file hash saved.')}>
        <label>Investigation<select name="record" defaultValue="" required disabled={casesLoading || casesFailed}>
          <option value="">Choose an investigation</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <label>Evidence title<input name="title" minLength={2} maxLength={140} required /></label>
        <label>Notes<textarea name="notes" maxLength={4000} /></label>
        <label>Original file · maximum 25 MB<input name="file" type="file" accept="image/jpeg,image/png,application/pdf,video/mp4" required /></label>
        <button disabled={busy || casesLoading || casesFailed || !cases.length}>{busy ? 'Uploading & registering…' : 'Register evidence'}</button>
      </form>
    </details>}
  </section>;
}

function Severity({ initial = 'medium' }: { initial?: string }) {
  return <label>Priority<select name="severity" defaultValue={initial}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>;
}
