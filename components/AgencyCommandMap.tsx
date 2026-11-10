import React, { FormEvent, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { basemap, commandBasemap } from '../services/mapConfig';
import { supabase } from '../services/supabase';

type MapItem = {
  id: string; kind: 'camera' | 'investigation'; title: string;
  detail: string; status?: string; latitude: number | null; longitude: number | null;
};

const statuses = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const colors = { camera: '#76efd6', investigation: '#ffc485' };

export default function AgencyCommandMap({ workspaceId, canManageCameras, openCamera }: {
  workspaceId: string; canManageCameras: boolean; openCamera: (id: string) => void;
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
  const [selectedId, setSelectedId] = useState('');
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
    && (item.title + ' ' + item.detail).toLowerCase().includes(needle));

  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current).setView([9.08, 8.68], 5);
    const dark = L.tileLayer(commandBasemap.url, commandBasemap.options).addTo(instance);
    dark.on('tileerror', () => setTileError(true));
    dark.on('tileload', () => setTileError(false));
    if (basemap.url !== commandBasemap.url) {
      const satellite = L.tileLayer(basemap.url, basemap.options);
      satellite.on('tileerror', () => setTileError(true));
      satellite.on('tileload', () => setTileError(false));
      L.control.layers({ 'Dark map': dark, Satellite: satellite }).addTo(instance);
    }
    map.current = instance;
    markers.current = L.layerGroup().addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; markers.current = null; initialFit.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      supabase.from('lv_cameras').select('id,name,location,latitude,longitude').eq('workspace_id', workspaceId).order('name'),
      supabase.from('lv_records').select('id,title,status,latitude,longitude').eq('workspace_id', workspaceId)
        .eq('category', 'investigation').order('created_at', { ascending: false }),
    ]).then(([cameras, records]) => {
      if (!active) return;
      setLoading(false);
      if (cameras.error || records.error) { setLoadError(true); return; }
      setItems([
        ...cameras.data.map(camera => ({ id: camera.id, kind: 'camera' as const, title: camera.name,
          detail: camera.location, latitude: camera.latitude, longitude: camera.longitude })),
        ...records.data.map(record => ({ id: record.id, kind: 'investigation' as const, title: record.title,
          detail: statuses[record.status as keyof typeof statuses] ?? record.status, status: record.status,
          latitude: record.latitude, longitude: record.longitude })),
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
    const table = selected.kind === 'camera' ? 'lv_cameras' : 'lv_records';
    setSaving(true);
    setNotice('');
    try {
      const { data, error } = await supabase.from(table).update({ latitude, longitude })
        .eq('workspace_id', workspaceId).eq('id', selected.id).select('id').single();
      if (error || !data) throw error;
      setItems(previous => previous.map(item => item.id === selected.id ? { ...item, latitude, longitude } : item));
      map.current?.setView([latitude, longitude], 15);
      setNotice('Map position saved.');
    } catch { setNotice('The position could not be saved. Check your workspace access and try again.'); }
    finally { setSaving(false); }
  }

  return <div className="lv-command-map-grid">
    <section className="lv-card">
      <h2>Map layers</h2>
      <label>Search cameras or investigations<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Show<select value={layer} onChange={event => setLayer(event.target.value)}>
        <option value="all">All layers</option><option value="camera">Cameras</option><option value="investigation">Investigations</option>
      </select></label>
      {layer !== 'camera' && <label>Investigation status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">All statuses</option>{Object.entries(statuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>}
      <div className="lv-video-actions">
        <button type="button" className="lv-secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh</button>
        <button type="button" className="lv-secondary" disabled={!visible.some(item => item.latitude !== null)} onClick={fitMarkers}>Fit markers</button>
      </div>
      {loading ? <p>Loading workspace map records…</p> : loadError ? <p role="alert">Map records could not be loaded.</p>
        : !visible.length && <p>No records match these filters.</p>}
      <ul className="lv-command-map-list">
        {visible.map(item => <li key={item.id}>
          <button type="button" className="lv-secondary" aria-pressed={selectedId === item.id} onClick={() => {
            setSelectedId(item.id); setNotice('');
            if (item.latitude !== null && item.longitude !== null) map.current?.setView([item.latitude, item.longitude], 15);
          }}>{item.title} <small>{item.latitude === null ? 'No position' : item.detail || 'Camera'}</small></button>
        </li>)}
      </ul>
    </section>
    <section className="lv-card">
      <h2>Agency operations map</h2>
      <div className="lv-command-map-canvas" ref={host} aria-label="Agency cameras and investigations map" />
      {tileError && <p role="status">Map tiles could not be loaded. The workspace records remain available.</p>}
      {selected && <article>
        <h3>{selected.title}</h3><p>{selected.detail}</p>
        {selected.kind === 'camera' && <button type="button" className="lv-secondary" onClick={() => openCamera(selected.id)}>Open camera feed</button>}
        {(selected.kind === 'investigation' || canManageCameras) && <form key={selected.id} onSubmit={event => void savePosition(event)}>
          <label>Latitude<input type="number" name="latitude" step="any" min={-90} max={90} defaultValue={selected.latitude ?? ''} required /></label>
          <label>Longitude<input type="number" name="longitude" step="any" min={-180} max={180} defaultValue={selected.longitude ?? ''} required /></label>
          <button type="submit" disabled={saving}>Save position</button>
        </form>}
        {notice && <p role="status">{notice}</p>}
      </article>}
    </section>
  </div>;
}
