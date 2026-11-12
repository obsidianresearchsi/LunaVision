import React, { useEffect, useState } from 'react';
import { supabase, workspaceEnabled } from '../services/supabase';
import {cameraConnectionLabel,useCameraConnectionStates} from '../services/cameraGateway';
import {
  AlertNotifyCategory,
  CameraIntelSettings,
  WorkspaceFeatureMap,
  defaultCameraIntelSettings,
  defaultFeatureMap,
  normalizeCameraIntelSettings,
  roleCan,
} from '../services/videoIntelligence';

interface CameraRecord {
  id: string;
  name: string;
  location: string;
  playback_url: string | null;
  is_default?:boolean;
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
  onRefreshAccess?: () => Promise<void>;
}> = ({ workspaceId, agency = false, role = 'member', platformAdmin = false, initialCameraId = null, onChanged, onManageCameras, onRefreshAccess }) => {
  const canConfigure = roleCan(role, 'configure', platformAdmin);
  const connections=useCameraConnectionStates(workspaceId);
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [features, setFeatures] = useState<WorkspaceFeatureMap>(() => defaultFeatureMap(agency));
  const [settings, setSettings] = useState<CameraIntelSettings>(() => defaultCameraIntelSettings(agency));
  const [revision, setRevision] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshingAccess, setRefreshingAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          .select('id, name, location, playback_url,is_default')
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
          : list.find(camera=>camera.is_default)?.id || list[0]?.id || '';
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

  const saveCameraConfiguration = async () => {
    if (!selectedCameraId || !canConfigure) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    let { data, error: saveError } = await supabase.rpc('lv_save_camera_intel', {
      target: workspaceId,
      camera: selectedCameraId,
      expected_revision: revision,
      new_settings: settings,
    });
    // Graceful fallback if deployed DB schema hasn't enabled 'weapon_detection' key yet
    if (saveError && saveError.message.includes('Unsupported capability') && settings.capabilities.weapon_detection) {
      const { weapon_detection: _omitted, ...legacyCaps } = settings.capabilities as Record<string, any>;
      const retry = await supabase.rpc('lv_save_camera_intel', {
        target: workspaceId,
        camera: selectedCameraId,
        expected_revision: revision,
        new_settings: { ...settings, capabilities: legacyCaps },
      });
      data = retry.data;
      saveError = retry.error;
    }
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
          {!canConfigure && onRefreshAccess && <button type="button" className="lv-btn" disabled={refreshingAccess} onClick={async () => {
            setRefreshingAccess(true);
            setNotice(null);
            try { await onRefreshAccess(); }
            catch { setNotice('Access could not be refreshed. Check your connection and try again.'); }
            finally { setRefreshingAccess(false); }
          }}>{refreshingAccess ? 'Refreshing access…' : 'Refresh access'}</button>}
          {error && <button type="button" className="lv-btn" onClick={() => setInventoryAttempt(attempt => attempt + 1)}>Retry camera inventory</button>}
          {onManageCameras && <button type="button" className="lv-btn lv-btn-primary" onClick={onManageCameras}>{canConfigure ? 'Add camera' : 'View cameras'}</button>}
        </div>
        {notice && <p role="status">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="lv-panel" aria-label="Camera Intelligence & Control Center">
      <div className="lv-panel-head">
        <div>
          <p className="lv-eyebrow">Camera Intelligence</p>
          <h3>Alert thresholds, schedule &amp; notification triggers</h3>
          <p className="lv-muted">
            Detection requires a connected feed to be open and playing. Adjust thresholds, operating hours, and alert
            notifications here.
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
      <p className="lv-notice" role="status">
        {selectedCamera?.playback_url ? 'Playback is configured. Detection requires the feed to be open and playing; saving settings alone does not start analysis.' : connections.unavailable?'Gateway status could not be loaded. Use Manage cameras to check the connection.':cameraConnectionLabel(connections.states[selectedCameraId]?.state)+' Use Manage cameras to open the feed, edit credentials or remove this camera.'}
      </p>
      {error && <p className="lv-error" role="alert">{error}</p>}
      {notice && <p className="lv-notice">{notice}</p>}

      {/* 1. Operating Schedule & Alert Thresholds */}
      <div style={{ marginTop: '1.25rem' }}>
        <p className="lv-eyebrow">1. Alert Thresholds &amp; Operating Schedule</p>
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

      {/* 2. Event Notification Triggers */}
      <div style={{ marginTop: '1.5rem' }}>
        <p className="lv-eyebrow">2. Alert &amp; Notification Triggers</p>
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

