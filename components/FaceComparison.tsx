import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/imageCompression';

const MAX_UPLOAD_BYTES = 1_250_000;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ComparisonResult = {
  name: string;
  previewUrl?: string;
  score: number | null;
  threshold: number | null;
  error?: string;
};

interface DatabaseSubjectMatch {
  subject_id: string;
  subject_code: string | null;
  full_name: string;
  aliases: string;
  category: string;
  threat_level: string;
  offense_summary: string;
  warrant_reference: string;
  case_reference: string;
  last_known_location: string;
  status: string;
  face_token: string;
  confidence: number;
  band: 'high' | 'medium' | 'investigative' | 'below_threshold';
  photo_url: string | null;
}

async function preparePhotoForCompare(file: File): Promise<File> {
  if (file.size === 0) {
    throw new Error(`"${file.name}" is empty.`);
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error(`"${file.name}" must be a JPEG, PNG, or WebP image.`);
  }
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }
  const firstPass = await compressImage(file, 1024, 0.86);
  const finalBlob =
    firstPass.size <= MAX_UPLOAD_BYTES ? firstPass : await compressImage(firstPass, 720, 0.72);
  if (finalBlob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" exceeds 1.25 MB even after compression. Choose a smaller photo.`);
  }
  const safeName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([finalBlob], `${safeName}.jpg`, { type: 'image/jpeg' });
}

type LocalPhotoPreview = {
  url: string | null;
  name: string;
  sizeKb: number;
};

function createFilePreview(file: File): LocalPhotoPreview {
  const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
  return {
    url,
    name: file.name,
    sizeKb: Math.max(1, Math.round(file.size / 1024)),
  };
}

function revokePreviewUrls(previews: (LocalPhotoPreview | null | undefined)[]) {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const item of previews) {
    if (item?.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
  }
}

export default function FaceComparison({
  workspaceId,
  gallery = false,
  searchEnabled = true,
  onOpenEnrollment,
  onOpenHistory,
}: {
  workspaceId: string;
  gallery?: boolean;
  searchEnabled?: boolean;
  onOpenEnrollment?: () => void;
  onOpenHistory?: () => void;
}) {
  const configured = import.meta.env.VITE_FACE_COMPARISON_ENABLED === 'true';
  const [searchTab, setSearchTab] = useState<'database_1n' | 'adhoc_gallery'>(
    gallery ? 'database_1n' : 'adhoc_gallery',
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [probePreview, setProbePreview] = useState<LocalPhotoPreview | null>(null);
  const [adhocRefPreview, setAdhocRefPreview] = useState<LocalPhotoPreview | null>(null);
  const [adhocCandPreviews, setAdhocCandPreviews] = useState<LocalPhotoPreview[]>([]);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const [results, setResults] = useState<ComparisonResult[]>([]);

  // 1:N database search state
  const [dbMatches, setDbMatches] = useState<DatabaseSubjectMatch[]>([]);
  const [dbTelemetry, setDbTelemetry] = useState<{
    quality?: number | null;
    blur?: number | null;
    faces_in_probe?: number;
    thresholds?: Record<string, number>;
    searched?: boolean;
  } | null>(null);

  const operation = useRef<AbortController | null>(null);
  const refInput = useRef<HTMLInputElement | null>(null);
  const candidateInput = useRef<HTMLInputElement | null>(null);
  const probeInput = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef<string[]>([]);

  function clearResultPreviews() {
    for (const url of objectUrls.current) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    }
    objectUrls.current = [];
    setRefPreview(null);
  }

  function clearProbeUpload() {
    setProbePreview(null);
    if (probeInput.current) probeInput.current.value = '';
    setDbMatches([]);
    setDbTelemetry(null);
    setNotice('');
  }

  function clearAdhocRefUpload() {
    setAdhocRefPreview(null);
    if (refInput.current) refInput.current.value = '';
    setResults([]);
    setNotice('');
  }

  function clearAdhocCandUploads() {
    setAdhocCandPreviews([]);
    if (candidateInput.current) candidateInput.current.value = '';
    setResults([]);
    setNotice('');
  }

  function handleProbeSelect(fileList: FileList | null) {
    const file = fileList?.[0];
    setProbePreview(file ? createFilePreview(file) : null);
    setNotice('');
    setDbMatches([]);
    setDbTelemetry(null);
  }

  function handleAdhocRefSelect(fileList: FileList | null) {
    const file = fileList?.[0];
    setAdhocRefPreview(file ? createFilePreview(file) : null);
    setNotice('');
    setResults([]);
  }

  function handleAdhocCandSelect(fileList: FileList | null) {
    const list = fileList ? Array.from(fileList).slice(0, gallery ? 6 : 1) : [];
    setAdhocCandPreviews(list.map(createFilePreview));
    setNotice('');
    setResults([]);
  }

  function trackPreviewUrl(file: File): string | undefined {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    return url;
  }

  useEffect(() => () => revokePreviewUrls([probePreview]), [probePreview]);
  useEffect(() => () => revokePreviewUrls([adhocRefPreview]), [adhocRefPreview]);
  useEffect(() => () => revokePreviewUrls(adhocCandPreviews), [adhocCandPreviews]);

  useEffect(
    () => () => {
      operation.current?.abort();
      clearResultPreviews();
    },
    [],
  );

  async function searchEnrolledDatabase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setProgress('Preparing probe photo and querying Face++ 1:N index…');
    setNotice('');
    setDbMatches([]);
    setDbTelemetry(null);
    clearResultPreviews();

    try {
      const formFields = new FormData(event.currentTarget);
      const rawProbe = probeInput.current?.files?.[0] ?? formFields.get('probe');
      if (!(rawProbe instanceof File) || rawProbe.size === 0) {
        throw new Error('Select a clear JPEG, PNG, or WebP probe image.');
      }
      const preparedProbe = await preparePhotoForCompare(rawProbe);
      controller.signal.throwIfAborted();
      setRefPreview(trackPreviewUrl(preparedProbe) ?? null);

      const { data: sessData, error: sessionErr } = await supabase.auth.getSession();
      controller.signal.throwIfAborted();
      if (sessionErr || !sessData.session) throw new Error('Sign in again to run biometric search.');

      // Best-effort private upload of probe snapshot for search audit history
      let probeSnapshotPath = '';
      try {
        const snapPath = `${workspaceId}/probes/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('lv-subject-photos')
          .upload(snapPath, preparedProbe, { contentType: 'image/jpeg', upsert: false });
        if (!upErr) probeSnapshotPath = snapPath;
      } catch {
        // Non-fatal if bucket upload skipped in unit mock or offline
      }

      const payload = new FormData();
      payload.set('action', 'search_database');
      payload.set('photo', preparedProbe);
      payload.set('case_reference', String(formFields.get('case_reference') || '').trim());
      payload.set('notes', String(formFields.get('notes') || '').trim());
      if (probeSnapshotPath) payload.set('probe_snapshot_path', probeSnapshotPath);

      const reqController = new AbortController();
      const abortParent = () => reqController.abort();
      controller.signal.addEventListener('abort', abortParent, { once: true });
      const timer = setTimeout(() => reqController.abort(), 25_000);
      let response: Response;
      try {
        response = await fetch('/api/face-intelligence', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + sessData.session.access_token,
            'X-Workspace-Id': workspaceId,
          },
          body: payload,
          signal: reqController.signal,
        });
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abortParent);
      }

      const out = await response.json().catch(() => null);
      if (!response.ok || !out) {
        throw new Error(out?.error || 'Face++ database search is unavailable.');
      }

      setDbMatches(Array.isArray(out.matches) ? out.matches : []);
      setDbTelemetry({
        quality: out.telemetry?.quality ?? null,
        blur: out.telemetry?.blur ?? null,
        faces_in_probe: out.telemetry?.faces_in_probe ?? 1,
        thresholds: out.thresholds ?? { '1e-5': 73.9 },
        searched: true,
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setNotice(err instanceof Error ? err.message : 'Face search failed.');
      }
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) {
        setProgress('');
        setBusy(false);
      }
    }
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setProgress('');
    setNotice('');
    setResults([]);
    clearResultPreviews();

    try {
      const photos = new FormData(event.currentTarget);
      const refFromInput = refInput.current?.files?.[0];
      const candFromInput = candidateInput.current?.files ? Array.from(candidateInput.current.files) : [];
      const referenceEntry = refFromInput ?? photos.get('reference');
      const candidateEntries = candFromInput.length > 0 ? candFromInput : photos.getAll('candidate');

      if (!(referenceEntry instanceof File) || referenceEntry.size === 0) {
        throw new Error('Choose a clear reference JPEG, PNG, or WebP photo.');
      }
      if (!gallery && candidateEntries.length !== 1) {
        throw new Error('Choose one photo to compare against the reference photo.');
      }
      if (gallery && (!candidateEntries.length || candidateEntries.length > 6)) {
        throw new Error('Choose between 1 and 6 gallery photos.');
      }
      for (const entry of candidateEntries) {
        if (!(entry instanceof File) || entry.size === 0) {
          throw new Error('Select valid photo files to compare.');
        }
      }

      const preparedRef = await preparePhotoForCompare(referenceEntry);
      controller.signal.throwIfAborted();
      setRefPreview(trackPreviewUrl(preparedRef) ?? null);

      const candidateFiles = candidateEntries as File[];
      const items: ComparisonResult[] = [];

      for (let i = 0; i < candidateFiles.length; i++) {
        const rawCandidate = candidateFiles[i];
        setProgress(
          gallery
            ? `Comparing gallery photo ${i + 1} of ${candidateFiles.length} (${rawCandidate.name})…`
            : 'Comparing photos via Face++…',
        );

        const { data, error: sessionErr } = await supabase.auth.getSession();
        controller.signal.throwIfAborted();
        if (sessionErr || !data.session) throw new Error('Sign in again to compare faces.');

        let preparedCandidate: File;
        try {
          preparedCandidate = await preparePhotoForCompare(rawCandidate);
        } catch (prepErr) {
          if (!gallery) throw prepErr;
          items.push({
            name: rawCandidate.name,
            score: null,
            threshold: null,
            error: prepErr instanceof Error ? prepErr.message : 'Photo could not be processed.',
          });
          setResults([...items]);
          continue;
        }

        const previewUrl = trackPreviewUrl(preparedCandidate);
        const pair = new FormData();
        pair.set('reference', preparedRef);
        pair.set('candidate', preparedCandidate);

        const reqController = new AbortController();
        const abortParent = () => reqController.abort();
        controller.signal.addEventListener('abort', abortParent, { once: true });
        const timer = setTimeout(() => reqController.abort(), 25_000);
        let response: Response;
        try {
          response = await fetch('/api/face-compare', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + data.session.access_token, 'X-Workspace-Id': workspaceId },
            body: pair,
            signal: reqController.signal,
          });
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', abortParent);
        }

        const output = await response.json().catch(() => null);

        if (!response.ok || typeof output?.score !== 'number') {
          const errMessage = output?.error || 'Face comparison is unavailable.';
          if (!gallery || response.status === 401 || response.status === 403 || response.status === 503 || response.status === 429) {
            throw new Error(errMessage);
          }
          items.push({
            name: rawCandidate.name,
            previewUrl,
            score: null,
            threshold: null,
            error: errMessage,
          });
        } else {
          items.push({
            name: rawCandidate.name,
            previewUrl,
            score: output.score,
            threshold: output.threshold ?? null,
          });
        }

        const sorted = [...items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        setResults(sorted);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'Face comparison failed.');
      }
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) {
        setProgress('');
        setBusy(false);
      }
    }
  }

  return (
    <section className="lv-card" aria-label={gallery ? 'Face search & biometric comparison' : 'Face comparison'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>{gallery ? 'Biometric Face Search & Gallery Comparison' : 'Face comparison'}</h2>
        </div>
        {gallery && configured && searchEnabled && (
          <div className="lv-video-actions">
            <button
              type="button"
              className={searchTab === 'database_1n' ? '' : 'lv-secondary'}
              onClick={() => {
                setSearchTab('database_1n');
                setNotice('');
                setResults([]);
              }}
            >
              1:N Agency Database Search
            </button>
            <button
              type="button"
              className={searchTab === 'adhoc_gallery' ? '' : 'lv-secondary'}
              onClick={() => {
                setSearchTab('adhoc_gallery');
                setNotice('');
                setDbMatches([]);
                setDbTelemetry(null);
              }}
            >
              1-vs-6 Ad-Hoc Photo Gallery
            </button>
            {onOpenEnrollment && (
              <button type="button" onClick={onOpenEnrollment}>
                + Enroll Convict / Subject
              </button>
            )}
            {onOpenHistory && (
              <button type="button" className="lv-secondary" onClick={onOpenHistory}>
                Search Audit History
              </button>
            )}
          </div>
        )}
      </div>

      {!configured ? (
        <p className="lv-notice">
          Face comparison is unavailable until the provider is configured (`VITE_FACE_COMPARISON_ENABLED=true` on client
          and `FACEPP_API_KEY` / `FACEPP_API_SECRET` on server).
        </p>
      ) : gallery && searchTab === 'database_1n' ? (
        <>
          <p>
            Search a probe photograph against this agency's entire isolated Face++ FaceSet of enrolled subjects and
            migrated criminal dossiers. Every query is audit-logged with probe quality telemetry.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
              gap: '1.25rem',
              alignItems: 'start',
            }}
          >
            <form
              onSubmit={(event) => void searchEnrolledDatabase(event)}
              onChange={(event) => {
                if ((event.target as HTMLInputElement).name !== 'probe') {
                  setNotice('');
                  setDbMatches([]);
                  setDbTelemetry(null);
                }
              }}
            >
              <label>
                Probe image (JPEG, PNG, or WebP)
                <input
                  ref={probeInput}
                  name="probe"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                  onChange={(e) => handleProbeSelect(e.target.files)}
                />
              </label>
              <div className="lv-form-grid">
                <label>
                  Case / Incident Reference (optional)
                  <input name="case_reference" maxLength={120} placeholder="e.g. INV-2026-091" disabled={busy} />
                </label>
                <label>
                  Search Context / Notes (optional)
                  <input name="notes" maxLength={300} placeholder="e.g. Gate 3 perimeter still" disabled={busy} />
                </label>
              </div>
              <button disabled={busy}>{busy ? 'Searching agency FaceSet…' : 'Search enrolled subject database'}</button>
            </form>

            <aside
              aria-label="Uploaded probe preview"
              className="lv-card"
              style={{
                background: '#091017',
                border: '1px solid #243547',
                minHeight: '220px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.92rem' }}>Probe Photo Preview</strong>
                {probePreview && (
                  <button
                    type="button"
                    className="lv-secondary"
                    style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                    disabled={busy}
                    onClick={clearProbeUpload}
                  >
                    Remove photo
                  </button>
                )}
              </div>

              {probePreview ? (
                <div>
                  {probePreview.url ? (
                    <img
                      src={probePreview.url}
                      alt={`Uploaded probe preview: ${probePreview.name}`}
                      style={{
                        width: '100%',
                        maxHeight: '240px',
                        objectFit: 'contain',
                        borderRadius: '6px',
                        border: '1px solid #76efd6',
                        background: '#05090d',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        padding: '1.25rem',
                        borderRadius: '6px',
                        border: '1px dashed #354858',
                        textAlign: 'center',
                      }}
                    >
                      Selected photo ready for search
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.55rem' }}>
                    <span className="lv-badge">{probePreview.name}</span>
                    <span className="lv-badge">{probePreview.sizeKb} KB</span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => probeInput.current?.click()}
                  disabled={busy}
                  style={{
                    flex: 1,
                    minHeight: '160px',
                    background: 'transparent',
                    border: '1px dashed #354858',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    padding: '1rem',
                    textAlign: 'center',
                  }}
                >
                  Select or upload a probe photograph to preview it here before searching.
                </button>
              )}
            </aside>
          </div>

          {progress && <p role="status">{progress}</p>}
          {notice && <p role="alert" style={{ color: '#ff8b89' }}>{notice}</p>}

          {dbTelemetry?.searched && (
            <div style={{ marginTop: '1rem' }} aria-live="polite">
              <p className="lv-notice">
                Review original photos and case documentation before confirming identity. Similarity bands are investigative leads only.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                {refPreview && (
                  <img
                    src={refPreview}
                    alt="Submitted probe image"
                    style={{ width: '76px', height: '76px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #76efd6' }}
                  />
                )}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {dbTelemetry.quality !== null && dbTelemetry.quality !== undefined && (
                    <span className="lv-badge">Probe quality: {Number(dbTelemetry.quality).toFixed(1)}%</span>
                  )}
                  {dbTelemetry.blur !== null && dbTelemetry.blur !== undefined && (
                    <span className="lv-badge">Blur: {Number(dbTelemetry.blur).toFixed(1)}</span>
                  )}
                  <span className="lv-badge">1e-5 threshold: {(dbTelemetry.thresholds?.['1e-5'] ?? 73.9).toFixed(1)}</span>
                </div>
              </div>

              {dbMatches.length === 0 ? (
                <div className="lv-card" style={{ background: '#0c131b' }}>
                  <p>
                    No enrolled subjects in this workspace's FaceSet matched above Face++ return candidates. Ensure
                    convicts/subjects are enrolled and indexed on Face++ under <strong>Enroll subject</strong>.
                  </p>
                  {onOpenEnrollment && (
                    <button type="button" onClick={onOpenEnrollment}>
                      + Enroll Subject into Face++ Index
                    </button>
                  )}
                </div>
              ) : (
                dbMatches.map((m) => (
                  <article key={m.subject_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}>
                        {m.photo_url && (
                          <img
                            src={m.photo_url}
                            alt={`Enrolled dossier ${m.full_name}`}
                            style={{ width: '84px', height: '92px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #354858' }}
                          />
                        )}
                        <div>
                          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <h3 style={{ margin: 0 }}>{m.full_name}</h3>
                            {m.subject_code && <span className="lv-badge">{m.subject_code}</span>}
                            <span className={`lunar-badge ${m.band === 'high' ? 'high' : m.band === 'medium' ? 'medium' : 'info'}`}>
                              {m.band.toUpperCase()} · {m.confidence.toFixed(1)}%
                            </span>
                            <span className="lv-badge">Threat: {m.threat_level}</span>
                          </div>
                          {m.offense_summary && <p style={{ margin: '0.3rem 0' }}>{m.offense_summary}</p>}
                          <small>
                            {m.warrant_reference && `Warrant: ${m.warrant_reference} · `}
                            {m.case_reference && `Case: ${m.case_reference} · `}
                            {m.last_known_location && `Last seen: ${m.last_known_location}`}
                          </small>
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            {gallery
              ? 'Search up to six authorized gallery photos with a reference photo.'
              : 'Compare two authorized photos.'}{' '}
            Use clear front-facing JPEG, PNG, or WebP images. Large photos are automatically compressed before being
            sent to Face++ for stateless similarity scoring.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
              gap: '1.25rem',
              alignItems: 'start',
            }}
          >
            <form
              onSubmit={(event) => void compare(event)}
              onChange={(event) => {
                const name = (event.target as HTMLInputElement).name;
                if (name !== 'reference' && name !== 'candidate') {
                  setNotice('');
                  setProgress('');
                  setResults([]);
                  clearResultPreviews();
                }
              }}
            >
              <label>
                Reference photo
                <input
                  ref={refInput}
                  name="reference"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                  onChange={(e) => handleAdhocRefSelect(e.target.files)}
                />
              </label>
              <label>
                {gallery ? 'Gallery photos (up to 6)' : 'Photo to compare'}
                <input
                  ref={candidateInput}
                  name="candidate"
                  type="file"
                  multiple={gallery}
                  accept="image/jpeg,image/png,image/webp"
                  required
                  disabled={busy}
                  onChange={(e) => handleAdhocCandSelect(e.target.files)}
                />
              </label>
              <button disabled={busy}>
                {busy ? 'Comparing photos…' : gallery ? 'Search gallery' : 'Compare photos'}
              </button>
            </form>

            <aside
              aria-label="Uploaded comparison previews"
              className="lv-card"
              style={{
                background: '#091017',
                border: '1px solid #243547',
                minHeight: '220px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
              }}
            >
              <strong style={{ fontSize: '0.92rem' }}>Uploaded Photo Previews</strong>
              <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.4rem' }}>
                    <small className="lv-muted">Reference</small>
                    {adhocRefPreview && (
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                        disabled={busy}
                        onClick={clearAdhocRefUpload}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {adhocRefPreview ? (
                    <div>
                      {adhocRefPreview.url ? (
                        <img
                          src={adhocRefPreview.url}
                          alt={`Uploaded reference preview: ${adhocRefPreview.name}`}
                          style={{
                            width: '104px',
                            height: '112px',
                            objectFit: 'cover',
                            borderRadius: '6px',
                            border: '1px solid #76efd6',
                          }}
                        />
                      ) : (
                        <div className="lv-badge">{adhocRefPreview.name}</div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {adhocRefPreview.name}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => refInput.current?.click()}
                      disabled={busy}
                      style={{
                        width: '104px',
                        height: '112px',
                        background: 'transparent',
                        border: '1px dashed #354858',
                        borderRadius: '6px',
                        color: '#94a3b8',
                        fontSize: '0.76rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Upload reference
                    </button>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.4rem' }}>
                    <small className="lv-muted">{gallery ? `Gallery (${adhocCandPreviews.length}/6)` : 'Comparison photo'}</small>
                    {adhocCandPreviews.length > 0 && (
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                        disabled={busy}
                        onClick={clearAdhocCandUploads}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {adhocCandPreviews.length > 0 ? (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {adhocCandPreviews.map((cand, idx) => (
                        <div key={`${cand.name}-${idx}`} style={{ width: '74px' }}>
                          {cand.url ? (
                            <img
                              src={cand.url}
                              alt={`Uploaded comparison preview ${cand.name}`}
                              style={{
                                width: '74px',
                                height: '80px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                border: '1px solid #354858',
                              }}
                            />
                          ) : (
                            <div className="lv-badge">{cand.name}</div>
                          )}
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cand.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => candidateInput.current?.click()}
                      disabled={busy}
                      style={{
                        width: '100%',
                        minHeight: '112px',
                        background: 'transparent',
                        border: '1px dashed #354858',
                        borderRadius: '6px',
                        color: '#94a3b8',
                        fontSize: '0.78rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        padding: '0.5rem',
                      }}
                    >
                      {gallery ? 'Upload up to 6 gallery photos to preview here' : 'Upload comparison photo to preview here'}
                    </button>
                  )}
                </div>
              </div>
            </aside>
          </div>
          {progress && <p role="status">{progress}</p>}
          {notice && <p role="alert" style={{ color: '#ff8b89' }}>{notice}</p>}
          {results.length > 0 && (
            <div aria-live="polite" style={{ marginTop: '1rem' }}>
              <p className="lv-notice">
                Review the original photos before drawing any conclusion. Automated similarity scores never constitute
                positive identification on their own.
              </p>
              {refPreview && (
                <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <img
                    src={refPreview}
                    alt="Reference face"
                    style={{ width: '76px', height: '76px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #76efd6' }}
                  />
                  <small className="lv-muted">Reference photo submitted for comparison</small>
                </div>
              )}
              {results.map((result, index) => (
                <article key={index}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {result.previewUrl && (
                        <img
                          src={result.previewUrl}
                          alt={`Compared photo ${result.name}`}
                          style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #354858' }}
                        />
                      )}
                      <div>
                        <strong>{result.name}</strong>
                        {result.score !== null ? (
                          <div>
                            Similarity score: <strong>{result.score.toFixed(1)}</strong> / 100
                            {result.threshold !== null && ` · Provider 1e-5 threshold: ${result.threshold.toFixed(1)}`}
                          </div>
                        ) : (
                          <div style={{ color: '#ff8b89' }}>{result.error}</div>
                        )}
                      </div>
                    </div>
                    {result.score !== null && result.threshold !== null && (
                      <span className={`lunar-badge ${result.score >= result.threshold ? 'high' : 'info'}`}>
                        {result.score >= result.threshold ? 'Above 1e-5 threshold' : 'Below 1e-5 threshold'}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
