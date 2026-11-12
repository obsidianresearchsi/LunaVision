import React, { FormEvent, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { basemap, commandBasemap } from '../services/mapConfig';
import { supabase } from '../services/supabase';
import { formatLocationWithCoords, parseSubjectLocation } from '../services/locationUtils';
import { CameraStream } from './CameraStream';

type MapItem = {
  id: string;
  kind: 'camera' | 'investigation' | 'subject';
  title: string;
  detail: string;
  rawLocation?: string;
  status?: string;
  latitude: number | null;
  longitude: number | null;
  // Camera preview details
  playbackUrl?: string | null;
  streamType?: 'video' | 'hls' | 'mjpeg';
  sourceConfigured?: boolean;
  // Subject dossier details
  subjectCode?: string | null;
  subjectCategory?: string;
  threatLevel?: string;
  aliases?: string;
  offenseSummary?: string;
  warrantRef?: string;
  caseRef?: string;
  nationalId?: string;
  physicalMarks?: string;
  notes?: string;
  primaryPhotoPath?: string | null;
  faceIndexed?: boolean;
};

const statuses = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const colors = { camera: '#76efd6', investigation: '#ffc485', subject: '#f43f5e' };
const MAP_LIST_PAGE_SIZE = 8;

export default function AgencyCommandMap({
  workspaceId,
  canManageCameras,
  openCamera,
  onOpenSubject,
  commandView = false,
}: {
  workspaceId: string;
  canManageCameras: boolean;
  openCamera: (id: string) => void;
  onOpenSubject?: () => void;
  commandView?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const markerIndex = useRef(new Map<string, L.CircleMarker>());
  const initialFit = useRef(false);
  const [items, setItems] = useState<MapItem[]>([]);
  const [query, setQuery] = useState('');
  const [layer, setLayer] = useState('all');
  const [status, setStatus] = useState('all');
  const [mapPage, setMapPage] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [previewCameraId, setPreviewCameraId] = useState('');
  const [feedState, setFeedState] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [subjectPhotos, setSubjectPhotos] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const selected = items.find(item => item.id === selectedId);
  const needle = query.trim().toLowerCase();
  const visible = items.filter(item => (layer === 'all' || layer === item.kind)
    && (item.kind !== 'investigation' || status === 'all' || item.status === status)
    && `${item.title} ${item.detail} ${item.aliases || ''} ${item.offenseSummary || ''} ${item.warrantRef || ''} ${item.caseRef || ''}`.toLowerCase().includes(needle));
  const totalMapPages = Math.max(1, Math.ceil(visible.length / MAP_LIST_PAGE_SIZE));
  const safeMapPage = Math.min(mapPage, totalMapPages - 1);
  const pagedVisible = visible.slice(safeMapPage * MAP_LIST_PAGE_SIZE, (safeMapPage + 1) * MAP_LIST_PAGE_SIZE);

  useEffect(() => {
    setMapPage(0);
  }, [query, layer, status, workspaceId]);

  useEffect(() => {
    if (selected?.kind === 'camera' && selected.playbackUrl) {
      setPreviewCameraId(selected.id);
      setFeedState('connecting');
    } else if (selected?.kind !== 'camera') {
      setPreviewCameraId('');
    }
  }, [selected?.id, selected?.kind, selected?.playbackUrl]);

  useEffect(() => {
    if (!selected || selected.kind !== 'subject' || !selected.primaryPhotoPath) return;
    if (subjectPhotos[selected.id]) return;
    const storageApi = (supabase as any)?.storage;
    if (!storageApi?.from) return;
    let active = true;
    void storageApi
      .from('lv-subject-photos')
      .createSignedUrl(selected.primaryPhotoPath, 300)
      .then(({ data }: { data?: { signedUrl?: string } }) => {
        if (!active || !data?.signedUrl) return;
        setSubjectPhotos(prev => ({ ...prev, [selected.id]: data.signedUrl! }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [selected?.id, selected?.kind, selected?.primaryPhotoPath, subjectPhotos]);

  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current).setView([9.08, 8.68], 5);
    const satellite = L.tileLayer(basemap.url, basemap.options).addTo(instance);
    satellite.on('tileerror', () => setTileError(true));
    satellite.on('tileload', () => setTileError(false));
    if (basemap.url !== commandBasemap.url) {
      const dark = L.tileLayer(commandBasemap.url, commandBasemap.options);
      dark.on('tileerror', () => setTileError(true));
      dark.on('tileload', () => setTileError(false));
      L.control.layers({ Satellite: satellite, 'Dark map': dark }).addTo(instance);
    }
    map.current = instance;
    markers.current = L.layerGroup().addTo(instance);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => instance.invalidateSize()) : null;
    observer?.observe(host.current);
    return () => { observer?.disconnect(); instance.remove(); map.current = null; markers.current = null; initialFit.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      supabase.from('lv_cameras').select('id,name,location,latitude,longitude,playback_url,stream_type,source_configured').eq('workspace_id', workspaceId).order('name'),
      supabase.from('lv_records').select('id,title,status,latitude,longitude').eq('workspace_id', workspaceId)
        .eq('category', 'investigation').order('created_at', { ascending: false }),
      supabase.from('lv_agency_subjects').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
    ]).then(([cameras, records, subjectsRes]) => {
      if (!active) return;
      setLoading(false);
      if (cameras.error || records.error) { setLoadError(true); return; }
      const subjectRows = !subjectsRes.error && Array.isArray(subjectsRes.data) ? subjectsRes.data : [];
      setItems([
        ...cameras.data.map(camera => ({
          id: camera.id,
          kind: 'camera' as const,
          title: camera.name,
          detail: camera.location,
          latitude: camera.latitude,
          longitude: camera.longitude,
          playbackUrl: (camera as any).playback_url ?? null,
          streamType: ((camera as any).stream_type as 'video' | 'hls' | 'mjpeg') ?? 'video',
          sourceConfigured: Boolean((camera as any).source_configured),
        })),
        ...records.data.map(record => ({ id: record.id, kind: 'investigation' as const, title: record.title,
          detail: statuses[record.status as keyof typeof statuses] ?? record.status, status: record.status,
          latitude: record.latitude, longitude: record.longitude })),
        ...subjectRows.map((subject: Record<string, any>) => {
          const coords = parseSubjectLocation(subject.last_known_location, subject.latitude, subject.longitude);
          const cleanLoc = coords.displayLocation;
          const codeLabel = subject.subject_code ? `${subject.subject_code} · ` : '';
          const threat = subject.threat_level ? ` (${String(subject.threat_level).toUpperCase()})` : '';
          return {
            id: String(subject.id),
            kind: 'subject' as const,
            title: `${subject.full_name || 'Enrolled subject'}${threat}`,
            detail: `${codeLabel}${cleanLoc || String(subject.category || 'subject').replace(/_/g, ' ')}`,
            rawLocation: String(subject.last_known_location || ''),
            status: String(subject.status || 'active'),
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
            subjectCode: subject.subject_code ? String(subject.subject_code) : null,
            subjectCategory: subject.category ? String(subject.category) : undefined,
            threatLevel: subject.threat_level ? String(subject.threat_level) : undefined,
            aliases: subject.aliases ? String(subject.aliases) : undefined,
            offenseSummary: subject.offense_summary ? String(subject.offense_summary) : undefined,
            warrantRef: subject.warrant_reference ? String(subject.warrant_reference) : undefined,
            caseRef: subject.case_reference ? String(subject.case_reference) : undefined,
            nationalId: subject.national_id ? String(subject.national_id) : undefined,
            physicalMarks: subject.physical_marks ? String(subject.physical_marks) : undefined,
            notes: subject.notes ? String(subject.notes) : undefined,
            primaryPhotoPath: subject.primary_photo_path ? String(subject.primary_photo_path) : null,
            faceIndexed: Boolean(subject.face_indexed),
          };
        }),
      ]);
    });
    return () => { active = false; };
  }, [workspaceId, revision]);

  function fitMarkers() {
    const positions = [...markerIndex.current.values()].map(marker => marker.getLatLng());
    if (positions.length) map.current?.fitBounds(L.latLngBounds(positions), { padding: [35, 35], maxZoom: 15 });
  }

  useEffect(() => {
    const group = markers.current;
    if (!group) return;
    group.clearLayers();
    markerIndex.current.clear();
    for (const item of visible) {
      if (item.latitude === null || item.longitude === null) continue;
      const label = document.createElement('span');
      label.textContent = item.title;
      const marker = L.circleMarker([item.latitude, item.longitude], { radius: 8, color: colors[item.kind], fillOpacity: 0.65 })
        .addTo(group).bindTooltip(label).on('click', () => { setSelectedId(item.id); setNotice(''); });
      markerIndex.current.set(item.id, marker);
    }
    if (!initialFit.current && markerIndex.current.size) {
      initialFit.current = true;
      fitMarkers();
    }
  }, [items, layer, status, needle]);

  async function savePosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || saving) return;
    const fields = new FormData(event.currentTarget);
    const latitude = Number(fields.get('latitude'));
    const longitude = Number(fields.get('longitude'));
    setSaving(true);
    setNotice('');
    try {
      if (selected.kind === 'subject') {
        const nextLocation = formatLocationWithCoords(selected.rawLocation || selected.detail, { latitude, longitude });
        const { data: colData, error: colErr } = await supabase
          .from('lv_agency_subjects')
          .update({ latitude, longitude })
          .eq('workspace_id', workspaceId)
          .eq('id', selected.id)
          .select('id')
          .single();
        if (colErr || !colData) {
          const { error: locErr } = await supabase
            .from('lv_agency_subjects')
            .update({ last_known_location: nextLocation })
            .eq('workspace_id', workspaceId)
            .eq('id', selected.id);
          if (locErr) throw locErr;
        }
        setItems(previous => previous.map(item => item.id === selected.id ? { ...item, latitude, longitude, rawLocation: nextLocation } : item));
      } else {
        const table = selected.kind === 'camera' ? 'lv_cameras' : 'lv_records';
        const { data, error } = await supabase.from(table).update({ latitude, longitude })
          .eq('workspace_id', workspaceId).eq('id', selected.id).select('id').single();
        if (error || !data) throw error;
        setItems(previous => previous.map(item => item.id === selected.id ? { ...item, latitude, longitude } : item));
      }
      map.current?.setView([latitude, longitude], 15);
      setNotice('Map position saved.');
    } catch { setNotice('The position could not be saved. Check your workspace access and try again.'); }
    finally { setSaving(false); }
  }

  return <div className="lv-command-map-grid" data-command={commandView}>
    <section className="lv-card">
      <h2>Map layers</h2>
      <label>Search cameras, subjects or investigations<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Show<select value={layer} onChange={event => setLayer(event.target.value)}>
        <option value="all">All layers</option>
        <option value="camera">Cameras</option>
        <option value="subject">Enrolled subjects</option>
        <option value="investigation">Investigations</option>
      </select></label>
      {(layer === 'all' || layer === 'investigation') && <label>Investigation status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">All statuses</option>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>}
      <div className="lv-video-actions">
        <button type="button" className="lv-secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button>
        <button type="button" className="lv-secondary" disabled={!visible.some(item => item.latitude !== null)} onClick={fitMarkers}>Fit markers</button>
      </div>
      {loading ? <p>Loading workspace map records…</p> : loadError ? <p role="alert">Map records could not be loaded.</p>
        : !visible.length && <p>No records match these filters.</p>}
      <ul className="lv-command-map-list" style={{ maxHeight: '360px', overflowY: 'auto' }}>
        {pagedVisible.map(item => <li key={`${item.kind}-${item.id}`}>
          <button type="button" className="lv-secondary" aria-pressed={selectedId === item.id} onClick={() => {
            setSelectedId(item.id); setNotice('');
            if (item.latitude !== null && item.longitude !== null) map.current?.setView([item.latitude, item.longitude], 15);
          }}>
            {item.title}{' '}
            <small>
              {item.kind === 'subject' ? 'Subject · ' : item.kind === 'camera' ? 'Camera · ' : ''}
              {item.latitude === null ? 'No GPS pin' : item.detail || 'Pinned'}
            </small>
          </button>
        </li>)}
      </ul>
      {visible.length > MAP_LIST_PAGE_SIZE && (
        <div className="lv-video-actions" style={{ marginTop: '0.6rem', justifyContent: 'space-between' }}>
          <button
            type="button"
            className="lv-secondary"
            disabled={safeMapPage === 0}
            onClick={() => setMapPage(p => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <small style={{ color: '#94a3b8' }}>
            Page {safeMapPage + 1} of {totalMapPages} ({visible.length} total)
          </small>
          <button
            type="button"
            className="lv-secondary"
            disabled={safeMapPage + 1 >= totalMapPages}
            onClick={() => setMapPage(p => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
    <section className="lv-card">
      <h2>Agency operations map</h2>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span className="lv-badge" style={{ borderColor: colors.camera, color: colors.camera }}>
          ● Cameras ({loading ? '…' : items.filter(i => i.kind === 'camera').length})
        </span>
        <span className="lv-badge" style={{ borderColor: colors.subject, color: colors.subject }}>
          ● Enrolled subjects ({loading ? '…' : items.filter(i => i.kind === 'subject').length})
        </span>
        <span className="lv-badge" style={{ borderColor: colors.investigation, color: colors.investigation }}>
          ● Investigations ({loading ? '…' : items.filter(i => i.kind === 'investigation').length})
        </span>
      </div>
      <div className="lv-command-map-canvas" ref={host} aria-label="Agency cameras, subjects and investigations map" />
      {tileError && <p role="status">Map tiles could not be loaded. The workspace records remain available.</p>}
      {selected && <article style={{ marginTop: '0.85rem', padding: '0.85rem', borderRadius: '8px', background: '#091119', border: '1px solid #1e2d3d' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>{selected.title}</h3>
            <p style={{ margin: '0.2rem 0 0.5rem', color: '#94a3b8' }}>
              {selected.detail}
              {selected.latitude !== null && selected.longitude !== null && (
                <> · GPS {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)}</>
              )}
            </p>
          </div>
          <span className="lv-badge" style={{ borderColor: colors[selected.kind], color: colors[selected.kind] }}>
            {selected.kind === 'camera' ? 'Live camera' : selected.kind === 'subject' ? 'Enrolled subject' : 'Investigation'}
          </span>
        </div>

        {selected.kind === 'camera' && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div className="lv-video-actions" style={{ marginBottom: '0.5rem' }}>
              {selected.playbackUrl && (
                <button
                  type="button"
                  className={previewCameraId === selected.id ? 'lv-secondary' : ''}
                  onClick={() => {
                    if (previewCameraId === selected.id) {
                      setPreviewCameraId('');
                    } else {
                      setFeedState('connecting');
                      setPreviewCameraId(selected.id);
                    }
                  }}
                >
                  {previewCameraId === selected.id ? 'Hide live preview' : 'Preview live feed'}
                </button>
              )}
              <button type="button" className="lv-secondary" onClick={() => openCamera(selected.id)}>
                Open camera page
              </button>
            </div>
            {previewCameraId === selected.id && selected.playbackUrl ? (
              <div style={{ border: '1px solid #1e2d3d', borderRadius: '8px', padding: '0.5rem', background: '#050a10' }}>
                <CameraStream
                  key={selected.id}
                  src={selected.playbackUrl}
                  streamType={selected.streamType ?? 'video'}
                  aria-label={`Live feed preview for ${selected.title}`}
                  controls
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', maxHeight: '240px', borderRadius: '6px', background: '#000' }}
                  onCanPlay={() => setFeedState('live')}
                  onStreamReady={() => setFeedState('live')}
                  onError={() => setFeedState('error')}
                  onStreamError={() => setFeedState('error')}
                />
                <small style={{ display: 'block', marginTop: '0.35rem', color: feedState === 'error' ? '#ff8b89' : '#94a3b8' }}>
                  {feedState === 'live'
                    ? `Playing ${selected.streamType?.toUpperCase() || 'VIDEO'} feed inline on map.`
                    : feedState === 'error'
                      ? 'Inline playback failed. Check stream gateway or open the full Cameras page.'
                      : 'Connecting to live camera stream…'}
                </small>
              </div>
            ) : !selected.playbackUrl ? (
              <small style={{ color: '#94a3b8' }}>
                {selected.sourceConfigured
                  ? 'Encrypted IP source saved; awaiting gateway playback URL for inline preview.'
                  : 'No browser playback URL configured yet for this camera.'}
              </small>
            ) : null}
          </div>
        )}

        {selected.kind === 'subject' && (
          <div
            style={{
              display: 'flex',
              gap: '0.85rem',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              padding: '0.65rem',
              borderRadius: '8px',
              background: '#0d1722',
              border: '1px solid #223244',
              marginBottom: '0.75rem',
            }}
            aria-label="Selected subject dossier"
          >
            {subjectPhotos[selected.id] && (
              <img
                src={subjectPhotos[selected.id]}
                alt={`Mugshot of ${selected.title}`}
                style={{ width: '76px', height: '88px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #354858' }}
              />
            )}
            <div style={{ flex: 1, minWidth: '210px', fontSize: '0.86rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                {selected.subjectCode && <span className="lv-badge">{selected.subjectCode}</span>}
                {selected.subjectCategory && <span className="lv-badge">{selected.subjectCategory.replace(/_/g, ' ')}</span>}
                {selected.threatLevel && (
                  <span className={`lunar-badge ${selected.threatLevel === 'critical' || selected.threatLevel === 'high' ? 'high' : 'medium'}`}>
                    {selected.threatLevel}
                  </span>
                )}
                <span className="lv-badge">{selected.faceIndexed ? 'FaceDB Indexed' : 'No FaceDB Vector'}</span>
              </div>
              {selected.aliases && <p style={{ margin: '0.2rem 0' }}><strong>Aliases:</strong> {selected.aliases}</p>}
              {selected.offenseSummary && <p style={{ margin: '0.2rem 0' }}><strong>Offense / Dossier:</strong> {selected.offenseSummary}</p>}
              {(selected.warrantRef || selected.caseRef || selected.nationalId) && (
                <p style={{ margin: '0.2rem 0', color: '#cbd5e1' }}>
                  {selected.warrantRef && <>Warrant: <strong>{selected.warrantRef}</strong> · </>}
                  {selected.caseRef && <>Case: <strong>{selected.caseRef}</strong> · </>}
                  {selected.nationalId && <>ID/NIN: <strong>{selected.nationalId}</strong></>}
                </p>
              )}
              {selected.physicalMarks && <p style={{ margin: '0.2rem 0' }}><strong>Physical marks:</strong> {selected.physicalMarks}</p>}
              {selected.notes && <p style={{ margin: '0.2rem 0', color: '#94a3b8' }}><strong>Notes:</strong> {selected.notes}</p>}
              {onOpenSubject && (
                <div className="lv-video-actions" style={{ marginTop: '0.45rem' }}>
                  <button type="button" className="lv-secondary" onClick={onOpenSubject}>
                    Open subject directory
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {(selected.kind === 'investigation' || selected.kind === 'subject' || canManageCameras) && <form key={selected.id} onSubmit={event => void savePosition(event)}>
          <label>Latitude<input type="number" name="latitude" step="any" min={-90} max={90} defaultValue={selected.latitude ?? ''} required /></label>
          <label>Longitude<input type="number" name="longitude" step="any" min={-180} max={180} defaultValue={selected.longitude ?? ''} required /></label>
          <button type="submit" disabled={saving}>Save position</button>
        </form>}
        {notice && <p role="status">{notice}</p>}
      </article>}
    </section>
  </div>;
}
