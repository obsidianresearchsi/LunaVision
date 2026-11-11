import React, { useEffect, useRef, useState } from 'react';
import { supabase, workspaceEnabled } from '../services/supabase';
import {
  AlertNotifyCategory,
  CAPABILITY_CATALOG,
  CameraIntelSettings,
  CameraZone,
  CapabilityKey,
  SensitivityLevel,
  WorkspaceFeatureMap,
  ZoneKind,
  defaultCameraIntelSettings,
  defaultFeatureMap,
  normalizeCameraIntelSettings,
  roleCan,
} from '../services/videoIntelligence';

interface CameraRecord {
  id: string;
  name: string;
  location: string;
  playback_url: string;
}

const DAY_LABELS = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

const ZONE_KIND_LABELS: Record<ZoneKind, { label: string; color: string; hint: string }> = {
  count_line: {
    label: 'Virtual Count Line (2 pts)',
    color: '#38bdf8',
    hint: 'Click 2 points to define an entry/exit boundary line.',
  },
  area: {
    label: 'Occupancy Area (Polygon)',
    color: '#22c55e',
    hint: 'Click 3 or more points to outline a monitored occupancy area, then click "Complete zone".',
  },
  restricted: {
    label: 'Restricted Intrusion Zone',
    color: '#ef4444',
    hint: 'Click 3 or more points to outline a restricted area that triggers intrusion alerts.',
  },
  perimeter: {
    label: 'Perimeter Boundary Zone',
    color: '#f59e0b',
    hint: 'Click 3 or more points to outline a perimeter zone.',
  },
  parking: {
    label: 'Parking / Stationary Zone',
    color: '#a855f7',
    hint: 'Click 3 or more points to outline a parking or vehicle-dwell zone.',
  },
};

const NOTIFY_LABELS: { key: AlertNotifyCategory; label: string; agencyOnly?: boolean }[] = [
  { key: 'intrusion', label: 'Restricted-area intrusion' },
  { key: 'perimeter_breach', label: 'Perimeter breach' },
  { key: 'crowd', label: 'Crowd / occupancy threshold exceeded' },
  { key: 'loitering', label: 'Loitering detected' },
  { key: 'stationary_vehicle', label: 'Vehicle stationary beyond limit' },
  { key: 'abandoned_object', label: 'Unattended / abandoned object' },
  { key: 'tamper', label: 'Camera tampering or obstruction' },
  { key: 'camera_offline', label: 'Camera stream offline' },
  { key: 'watchlist_match', label: 'Security watchlist plate match', agencyOnly: true },
];

export const CameraControlCenter: React.FC<{
  workspaceId: string;
  agency?: boolean;
  role?: string;
  platformAdmin?: boolean;
  initialCameraId?: string | null;
  onChanged?: () => void;
  onManageCameras?: () => void;
}> = ({ workspaceId, agency = false, role = 'member', platformAdmin = false, initialCameraId = null, onChanged, onManageCameras }) => {
  const canConfigure = roleCan(role, 'configure', platformAdmin);
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [features, setFeatures] = useState<WorkspaceFeatureMap>(() => defaultFeatureMap(agency));
  const [settings, setSettings] = useState<CameraIntelSettings>(() => defaultCameraIntelSettings(agency));
  const [revision, setRevision] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Interactive zone drawing state
  const [draftName, setDraftName] = useState('Main Gate');
  const [draftKind, setDraftKind] = useState<ZoneKind>('count_line');
  const [draftDirection, setDraftDirection] = useState<'down' | 'up' | 'right' | 'left'>('down');
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([]);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId) || null;

  useEffect(() => {
    let active = true;
    async function loadCamerasAndFeatures() {
      if (!workspaceEnabled) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const [camRes, featRes] = await Promise.all([
        supabase
          .from('lv_cameras')
          .select('id, name, location, playback_url')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false }),
        supabase.rpc('lv_workspace_feature_map', { target: workspaceId }),
      ]);
      if (!active) return;
      if (camRes.error) {
        setError(camRes.error.message);
        setLoading(false);
        return;
      }
      const nextFeatures =
        featRes.data && typeof featRes.data === 'object' && !Array.isArray(featRes.data)
          ? { ...defaultFeatureMap(agency), ...(featRes.data as Partial<WorkspaceFeatureMap>) }
          : defaultFeatureMap(agency);
      setFeatures(nextFeatures);
      const list = (camRes.data ?? []) as CameraRecord[];
      setCameras(list);
      const pick =
        initialCameraId && list.some((c) => c.id === initialCameraId)
          ? initialCameraId
          : list[0]?.id || '';
      setSelectedCameraId(pick);
      setLoading(false);
    }
    void loadCamerasAndFeatures().catch(() => {
      if (active) { setError('Camera inventory could not be loaded. Check your connection and retry.'); setLoading(false); }
    });
    return () => {
      active = false;
    };
  }, [workspaceId, agency, initialCameraId, inventoryAttempt]);

  useEffect(() => {
    let active = true;
    async function loadCameraSettings() {
      if (!selectedCameraId || !workspaceEnabled) return;
      setError(null);
      setNotice(null);
      setDraftPoints([]);
      const { data, error: fetchError } = await supabase
        .from('lv_camera_intel_settings')
        .select('settings, revision')
        .eq('camera_id', selectedCameraId)
        .maybeSingle();
      if (!active) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      if (data) {
        setSettings(normalizeCameraIntelSettings(data.settings, agency, features));
        setRevision(Number(data.revision || 1));
      } else {
        setSettings(defaultCameraIntelSettings(agency, features));
        setRevision(0);
      }
    }
    void loadCameraSettings();
    return () => {
      active = false;
    };
  }, [selectedCameraId, agency, features]);

  const toggleCapability = (key: CapabilityKey, enabled: boolean) => {
    if (!canConfigure) return;
    setSettings((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [key]: { ...prev.capabilities[key], enabled },
      },
    }));
  };

  const changeSensitivity = (key: CapabilityKey, sensitivity: SensitivityLevel) => {
    if (!canConfigure) return;
    setSettings((prev) => ({
      ...prev,
      capabilities: {
        ...prev.capabilities,
        [key]: { ...prev.capabilities[key], sensitivity },
      },
    }));
  };

  const toggleScheduleDay = (day: number) => {
    if (!canConfigure) return;
    setSettings((prev) => {
      const exists = prev.schedule.days.includes(day);
      const nextDays = exists ? prev.schedule.days.filter((d) => d !== day) : [...prev.schedule.days, day].sort();
      return {
        ...prev,
        schedule: {
          ...prev.schedule,
          days: nextDays.length > 0 ? nextDays : [day],
        },
      };
    });
  };

  const toggleNotifyCategory = (category: AlertNotifyCategory) => {
    if (!canConfigure) return;
    setSettings((prev) => {
      const exists = prev.notify.categories.includes(category);
      const categories = exists
        ? prev.notify.categories.filter((c) => c !== category)
        : [...prev.notify.categories, category];
      return {
        ...prev,
        notify: { ...prev.notify, categories },
      };
    });
  };

  const handleOverlayClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!canConfigure || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Number(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)).toFixed(4));
    const y = Number(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)).toFixed(4));

    if (draftKind === 'count_line') {
      if (draftPoints.length === 1) {
        const nextPoints: [number, number][] = [draftPoints[0], [x, y]];
        commitDraftZone(nextPoints);
      } else {
        setDraftPoints([[x, y]]);
      }
    } else {
      if (draftPoints.length < 32) {
        setDraftPoints((prev) => [...prev, [x, y]]);
      }
    }
  };

  const commitDraftZone = (overridePoints?: [number, number][]) => {
    const pts = overridePoints || draftPoints;
    if (draftKind === 'count_line' && pts.length !== 2) {
      setError('A virtual count line requires exactly 2 points.');
      return;
    }
    if (draftKind !== 'count_line' && pts.length < 3) {
      setError('A polygon zone requires at least 3 points.');
      return;
    }
    const cleanName = draftName.trim().slice(0, 60) || `Zone ${settings.zones.length + 1}`;
    const id = `zone_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newZone: CameraZone = {
      id,
      name: cleanName,
      kind: draftKind,
      points: pts,
      ...(draftKind === 'count_line' ? { direction: draftDirection } : {}),
    };
    setSettings((prev) => ({
      ...prev,
      zones: [...prev.zones, newZone].slice(0, 20),
    }));
    setDraftPoints([]);
    setDraftName(`Zone ${settings.zones.length + 2}`);
    setError(null);
  };

  const removeZone = (zoneId: string) => {
    if (!canConfigure) return;
    setSettings((prev) => ({
      ...prev,
      zones: prev.zones.filter((z) => z.id !== zoneId),
    }));
  };

  const saveCameraConfiguration = async () => {
    if (!selectedCameraId || !canConfigure) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const { data, error: saveError } = await supabase.rpc('lv_save_camera_intel', {
      target: workspaceId,
      camera: selectedCameraId,
      expected_revision: revision,
      new_settings: settings,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setRevision(Number(data || revision + 1));
    setNotice(`Saved intelligence configuration for "${selectedCamera?.name || 'camera'}" (revision #${data}).`);
    onChanged?.();
  };

  if (loading) {
    return (
      <section className="lv-panel">
        <p className="lv-muted">Loading camera configuration & intelligence control center...</p>
      </section>
    );
  }

  if (cameras.length === 0) {
    return (
      <section className="lv-panel">
        <div className="lv-panel-head">
          <div>
            <p className="lv-eyebrow">Camera Intelligence & Control Center</p>
            <h3>{error ? 'Camera inventory could not be loaded' : 'No connected cameras yet'}</h3>
          </div>
        </div>
        {error ? <p role="alert">{error}</p> : <p className="lv-muted">Add a camera first, then configure its detection settings, counting lines, zones and alerts.</p>}
        {!canConfigure && <p className="lv-muted">A workspace owner or administrator can register cameras for your organization.</p>}
        <div className="lv-filter-bar">
          {error && <button type="button" className="lv-btn" onClick={() => setInventoryAttempt(attempt => attempt + 1)}>Retry camera inventory</button>}
          {onManageCameras && <button type="button" className="lv-btn lv-btn-primary" onClick={onManageCameras}>{canConfigure ? 'Add camera' : 'View cameras'}</button>}
        </div>
      </section>
    );
  }

  const visibleCatalog = CAPABILITY_CATALOG.filter(
    (cap) => (!cap.agencyOnly || agency) && Boolean(features[cap.feature]),
  );

  return (
    <section className="lv-panel" aria-label="Camera Intelligence & Control Center">
      <div className="lv-panel-head">
        <div>
          <p className="lv-eyebrow">Camera Configuration & Control Center</p>
          <h3>Per-camera detection, zones, schedules & alert thresholds</h3>
          <p className="lv-muted">
            Settings are saved independently per camera. Changing one camera's configuration never affects other cameras.
          </p>
        </div>
        <div className="lv-filter-bar">
          {onManageCameras && <button type="button" className="lv-btn" onClick={onManageCameras}>Manage cameras</button>}
          <label className="lv-field" style={{ minWidth: '240px', marginBottom: 0 }}>
            <span>Select camera</span>
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              aria-label="Select camera to configure"
            >
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name} — {cam.location}
                </option>
              ))}
            </select>
          </label>
          {canConfigure && (
            <button
              type="button"
              className="lv-btn lv-btn-primary"
              disabled={saving || !selectedCameraId}
              onClick={() => void saveCameraConfiguration()}
            >
              {saving ? 'Saving camera config...' : 'Save camera settings'}
            </button>
          )}
        </div>
      </div>

      {!canConfigure && (
        <p className="lv-notice">
          Read-only view: Only workspace owners and administrators can modify per-camera intelligence settings.
        </p>
      )}
      {error && <p className="lv-error" role="alert">{error}</p>}
      {notice && <p className="lv-notice">{notice}</p>}

      <p className="lv-notice">
        Browser AI pipeline (active): People & vehicle detection/tracking, directional zone counting, occupancy, loitering, intrusion, perimeter, abandoned objects, camera tamper/health, and ANPR plate matching run in-browser when a camera feed is open. Continuous 24/7 headless analytics when no operator browser is open require an external inference gateway.
      </p>

      {/* 1. Modular Detection & Analytics Capabilities */}
      <div style={{ marginTop: '1.25rem' }}>
        <p className="lv-eyebrow">1. Modular Detection & Analytics Controls</p>
        <p className="lv-muted">
          Enable only the analytics relevant to this camera's location and adjust detection sensitivity independently.
        </p>
        <div className="lv-card-grid" style={{ marginTop: '0.75rem' }}>
          {visibleCatalog.map((cap) => {
            const state = settings.capabilities[cap.key] || { enabled: false, sensitivity: 'medium' };
            return (
              <article key={cap.key} className="lv-card">
                <div className="lv-card-top">
                  <label className="lv-inline-check" style={{ fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={state.enabled}
                      disabled={!canConfigure}
                      onChange={(e) => toggleCapability(cap.key, e.target.checked)}
                    />
                    <span>{cap.label}</span>
                  </label>
                  <span className="lv-badge">{cap.group.toUpperCase()}</span>
                </div>
                <p className="lv-muted" style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
                  {cap.description}
                </p>
                <div className="lv-card-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <small className="lv-muted">Engine: {cap.engine}</small>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                    <span>Sensitivity</span>
                    <select
                      value={state.sensitivity}
                      disabled={!canConfigure || !state.enabled}
                      onChange={(e) => changeSensitivity(cap.key, e.target.value as SensitivityLevel)}
                    >
                      <option value="low">Low (strict)</option>
                      <option value="medium">Medium</option>
                      <option value="high">High (sensitive)</option>
                    </select>
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* 2. Interactive Visual Camera-Zone Editor */}
      <div style={{ marginTop: '1.75rem' }}>
        <p className="lv-eyebrow">2. Visual Camera-Zone & Virtual Boundary Editor</p>
        <p className="lv-muted">
          Click directly on the camera frame below to draw virtual counting lines, occupancy areas, restricted intrusion areas, perimeter boundaries, or parking zones.
        </p>

        <div className="lv-form-grid" style={{ marginTop: '0.75rem', alignItems: 'end' }}>
          <label className="lv-field">
            <span>Zone name</span>
            <input
              value={draftName}
              disabled={!canConfigure}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="North Gate Line"
            />
          </label>
          <label className="lv-field">
            <span>Zone type</span>
            <select
              value={draftKind}
              disabled={!canConfigure}
              onChange={(e) => {
                setDraftKind(e.target.value as ZoneKind);
                setDraftPoints([]);
              }}
            >
              {Object.entries(ZONE_KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          {draftKind === 'count_line' && (
            <label className="lv-field">
              <span>Entry direction</span>
              <select
                value={draftDirection}
                disabled={!canConfigure}
                onChange={(e) => setDraftDirection(e.target.value as 'down' | 'up' | 'right' | 'left')}
              >
                <option value="down">Top → Bottom is Entry (In)</option>
                <option value="up">Bottom → Top is Entry (In)</option>
                <option value="right">Left → Right is Entry (In)</option>
                <option value="left">Right → Left is Entry (In)</option>
              </select>
            </label>
          )}
          <div className="lv-row-actions">
            {draftKind !== 'count_line' && (
              <button
                type="button"
                className="lv-btn lv-btn-primary"
                disabled={!canConfigure || draftPoints.length < 3}
                onClick={() => commitDraftZone()}
              >
                Complete zone ({draftPoints.length} pts)
              </button>
            )}
            <button
              type="button"
              className="lv-btn lv-btn-secondary"
              disabled={!canConfigure || draftPoints.length === 0}
              onClick={() => setDraftPoints([])}
            >
              Clear draft
            </button>
          </div>
        </div>

        <p className="lv-muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
          {ZONE_KIND_LABELS[draftKind].hint}
        </p>

        <div
          className="lv-video-stage"
          style={{
            position: 'relative',
            marginTop: '0.75rem',
            minHeight: '300px',
            background: '#090d16',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid rgba(148, 163, 184, 0.25)',
          }}
        >
          {selectedCamera?.playback_url && (
            <video
              key={selectedCamera.playback_url}
              src={selectedCamera.playback_url}
              muted
              playsInline
              loop
              autoPlay
              crossOrigin="anonymous"
              style={{ width: '100%', height: '320px', objectFit: 'cover', display: 'block', opacity: 0.78 }}
            />
          )}
          <svg
            ref={overlayRef}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onClick={handleOverlayClick}
            aria-label="Interactive camera zone canvas"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: canConfigure ? 'crosshair' : 'default',
            }}
          >
            {/* Saved zones */}
            {settings.zones.map((z) => {
              const meta = ZONE_KIND_LABELS[z.kind] || ZONE_KIND_LABELS.area;
              if (z.kind === 'count_line' && z.points.length === 2) {
                const [[x1, y1], [x2, y2]] = z.points;
                return (
                  <g key={z.id}>
                    <line
                      x1={x1 * 100}
                      y1={y1 * 100}
                      x2={x2 * 100}
                      y2={y2 * 100}
                      stroke={meta.color}
                      strokeWidth="1.2"
                      strokeDasharray="2,1"
                    />
                    <text x={(x1 + x2) * 50} y={(y1 + y2) * 50 - 2} fill={meta.color} fontSize="3.2" fontWeight="bold">
                      {z.name} ({z.direction || 'down'})
                    </text>
                  </g>
                );
              }
              const polyPoints = z.points.map(([px, py]) => `${px * 100},${py * 100}`).join(' ');
              const [fx, fy] = z.points[0] || [0.1, 0.1];
              return (
                <g key={z.id}>
                  <polygon
                    points={polyPoints}
                    fill={`${meta.color}33`}
                    stroke={meta.color}
                    strokeWidth="0.9"
                  />
                  <text x={fx * 100 + 1} y={fy * 100 + 4} fill={meta.color} fontSize="3.2" fontWeight="bold">
                    {z.name}
                  </text>
                </g>
              );
            })}

            {/* Active draft points */}
            {draftPoints.length > 0 && (
              <g>
                <polyline
                  points={draftPoints.map(([px, py]) => `${px * 100},${py * 100}`).join(' ')}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="0.9"
                  strokeDasharray="1.5,1.5"
                />
                {draftPoints.map(([px, py], idx) => (
                  <circle key={idx} cx={px * 100} cy={py * 100} r="1.4" fill="#38bdf8" stroke="#fff" strokeWidth="0.4" />
                ))}
              </g>
            )}
          </svg>
        </div>

        {settings.zones.length > 0 && (
          <div className="lv-table-wrap" style={{ marginTop: '0.75rem' }}>
            <table className="lv-table">
              <thead>
                <tr>
                  <th>Zone name</th>
                  <th>Type</th>
                  <th>Points / Direction</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {settings.zones.map((z) => (
                  <tr key={z.id}>
                    <td>{z.name}</td>
                    <td>{ZONE_KIND_LABELS[z.kind]?.label || z.kind}</td>
                    <td>
                      {z.kind === 'count_line'
                        ? `2 points · Entry: ${z.direction || 'down'}`
                        : `${z.points.length} polygon vertices`}
                    </td>
                    <td>
                      {canConfigure && (
                        <button
                          type="button"
                          className="lv-btn lv-btn-secondary"
                          onClick={() => removeZone(z.id)}
                        >
                          Remove zone
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

      {/* 3. Operating Schedule & Alert Thresholds */}
      <div style={{ marginTop: '1.75rem' }}>
        <p className="lv-eyebrow">3. Operating Schedule & Alert Thresholds</p>
        <div className="lv-form-grid" style={{ marginTop: '0.75rem' }}>
          <label className="lv-field">
            <span>Crowd concentration threshold (people)</span>
            <input
              type="number"
              min={1}
              max={1000}
              disabled={!canConfigure}
              value={settings.thresholds.crowd_max}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, crowd_max: Number(e.target.value || 10) },
                }))
              }
            />
          </label>
          <label className="lv-field">
            <span>Max occupancy limit (people)</span>
            <input
              type="number"
              min={1}
              max={10000}
              disabled={!canConfigure}
              value={settings.thresholds.occupancy_max}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, occupancy_max: Number(e.target.value || 25) },
                }))
              }
            />
          </label>
          <label className="lv-field">
            <span>Loitering threshold (seconds)</span>
            <input
              type="number"
              min={5}
              max={86400}
              disabled={!canConfigure}
              value={settings.thresholds.loiter_seconds}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, loiter_seconds: Number(e.target.value || 25) },
                }))
              }
            />
          </label>
          <label className="lv-field">
            <span>Stationary / parked vehicle limit (seconds)</span>
            <input
              type="number"
              min={30}
              max={86400}
              disabled={!canConfigure}
              value={settings.thresholds.stationary_seconds}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, stationary_seconds: Number(e.target.value || 60) },
                }))
              }
            />
          </label>
          <label className="lv-field">
            <span>Unattended object threshold (seconds)</span>
            <input
              type="number"
              min={15}
              max={86400}
              disabled={!canConfigure}
              value={settings.thresholds.abandoned_seconds}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, abandoned_seconds: Number(e.target.value || 30) },
                }))
              }
            />
          </label>
          <label className="lv-field">
            <span>Alert cooldown per camera (seconds)</span>
            <input
              type="number"
              min={15}
              max={3600}
              disabled={!canConfigure}
              value={settings.thresholds.alert_cooldown_seconds}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, alert_cooldown_seconds: Number(e.target.value || 60) },
                }))
              }
            />
          </label>
        </div>

        {/* Operating schedule */}
        <div className="lv-card" style={{ marginTop: '1rem' }}>
          <div className="lv-card-top">
            <label className="lv-inline-check" style={{ fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={settings.schedule.enabled}
                disabled={!canConfigure}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    schedule: { ...prev.schedule, enabled: e.target.checked },
                  }))
                }
              />
              <span>Restrict analytics & alerts to an operating schedule</span>
            </label>
            <span className="lv-badge">{settings.schedule.enabled ? 'SCHEDULE ACTIVE' : '24/7 ALWAYS ON'}</span>
          </div>
          {settings.schedule.enabled && (
            <div className="lv-form-grid" style={{ marginTop: '0.75rem' }}>
              <div className="lv-field">
                <span>Active days</span>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                  {DAY_LABELS.map((d) => {
                    const active = settings.schedule.days.includes(d.day);
                    return (
                      <button
                        key={d.day}
                        type="button"
                        disabled={!canConfigure}
                        className={`lv-btn ${active ? 'lv-btn-primary' : 'lv-btn-secondary'}`}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => toggleScheduleDay(d.day)}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="lv-field">
                <span>Start time (HH:MM)</span>
                <input
                  type="time"
                  disabled={!canConfigure}
                  value={settings.schedule.start}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      schedule: { ...prev.schedule, start: e.target.value || '00:00' },
                    }))
                  }
                />
              </label>
              <label className="lv-field">
                <span>End time (HH:MM)</span>
                <input
                  type="time"
                  disabled={!canConfigure}
                  value={settings.schedule.end}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      schedule: { ...prev.schedule, end: e.target.value || '23:59' },
                    }))
                  }
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 4. Event Notification Triggers */}
      <div style={{ marginTop: '1.5rem' }}>
        <p className="lv-eyebrow">4. Alert & Notification Triggers</p>
        <p className="lv-muted">Select which detected events on this camera should generate immediate workspace alerts.</p>
        <div className="lv-card-grid" style={{ marginTop: '0.6rem' }}>
          {NOTIFY_LABELS.filter((n) => !n.agencyOnly || agency).map((item) => {
            const checked = settings.notify.categories.includes(item.key);
            return (
              <label key={item.key} className="lv-inline-check lv-card" style={{ padding: '0.65rem 0.9rem' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!canConfigure}
                  onChange={() => toggleNotifyCategory(item.key)}
                />
                <span>{item.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default CameraControlCenter;

