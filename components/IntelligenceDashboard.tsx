import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  IntelEventCategory,
  WorkspaceFeatureMap,
  defaultFeatureMap,
  normalizePlate,
} from '../services/videoIntelligence';
import { subscribeAlertsChanged } from '../services/liveAlertBus';
import VideoAnalysis from './VideoAnalysis';
import VehicleImageRecognition from './VehicleImageRecognition';

interface CameraRow {
  id: string;
  name: string;
  location: string;
}

interface CameraActivityRow {
  camera_id: string;
  last_event_at: string | null;
  events_24h: number;
}

interface OccupancyRow {
  camera_id: string;
  zone_id: string | null;
  object_class: string | null;
  current_count: number;
  observed_at: string;
}

interface TimeseriesRow {
  bucket_start: string;
  camera_id: string | null;
  source: 'camera' | 'file';
  category: IntelEventCategory;
  object_class: string | null;
  direction: 'in' | 'out' | null;
  events: number;
  total_count: number;
  avg_count: number;
  max_count: number;
}

interface IntelEventRow {
  id: string;
  camera_id: string | null;
  category: IntelEventCategory;
  object_class: string | null;
  direction: 'in' | 'out' | null;
  event_count: number;
  zone_id: string | null;
  plate: string | null;
  confidence: number | null;
  payload: Record<string, any>;
  snapshot_path: string | null;
  source: 'camera' | 'file';
  occurred_at: string;
}

interface AlertSummaryRow {
  id: string;
  title: string;
  details: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'acknowledged' | 'resolved';
  category: string | null;
  camera_id: string | null;
  event_id: string | null;
  recommended_action: string;
  snapshot_path: string | null;
  created_at: string;
}

interface MatchedWatchlistRecord {
  id: string;
  plate: string;
  reason: string;
  custom_category: string;
  case_reference: string;
  make: string;
  model: string;
  colour: string;
  description: string;
  notes: string;
  status: string;
  photo_path: string | null;
  created_at: string;
  created_by_label: string;
}

type PeriodKey = '24h' | '7d' | '30d' | '90d';

const PERIOD_CONFIG: Record<PeriodKey, { label: string; days: number; bucket: 'hour' | 'day' | 'week' }> = {
  '24h': { label: 'Daily / Last 24 hours', days: 1, bucket: 'hour' },
  '7d': { label: 'Weekly / Last 7 days', days: 7, bucket: 'day' },
  '30d': { label: 'Monthly / Last 30 days', days: 30, bucket: 'day' },
  '90d': { label: 'Quarterly / Last 90 days', days: 90, bucket: 'week' },
};

const CATEGORY_LABELS: Record<string, string> = {
  census: 'Activity census',
  line_crossing: 'Entry / Exit crossing',
  occupancy: 'Occupancy snapshot',
  crowd: 'Crowd threshold',
  loitering: 'Loitering',
  intrusion: 'Restricted intrusion',
  perimeter_breach: 'Perimeter breach',
  stationary_vehicle: 'Stationary vehicle',
  abandoned_object: 'Unattended item',
  tamper: 'Camera tampering',
  camera_offline: 'Camera offline',
  plate_read: 'ANPR plate read',
  watchlist_match: 'Watchlist match',
};

export default function IntelligenceDashboard({
  workspaceId,
  agency,
  initialEventId = null,
  openCamera,
  onNavigate,
}: {
  workspaceId: string;
  agency: boolean;
  initialEventId?: string | null;
  openCamera?: (cameraId: string) => void;
  onNavigate?: (panel: string) => void;
}) {
  const [features, setFeatures] = useState<WorkspaceFeatureMap>(() => defaultFeatureMap(agency));
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [selectedCamera, setSelectedCamera] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'camera' | 'file'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [plateSearch, setPlateSearch] = useState<string>('');

  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [camActivity, setCamActivity] = useState<CameraActivityRow[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancyRow[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesRow[]>([]);
  const [events, setEvents] = useState<IntelEventRow[]>([]);
  const [alerts, setAlerts] = useState<AlertSummaryRow[]>([]);
  const [faceSearchLogs, setFaceSearchLogs] = useState<any[]>([]);
  const [incidentCount, setIncidentCount] = useState<number>(0);
  const [showLiveScanner, setShowLiveScanner] = useState<boolean>(false);
  const [showVehicleRecognition, setShowVehicleRecognition] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  // Event / Alert investigation detail drawer
  const [inspectedEvent, setInspectedEvent] = useState<IntelEventRow | null>(null);
  const [inspectedSnapUrl, setInspectedSnapUrl] = useState<string | null>(null);
  const [matchedWatchlist, setMatchedWatchlist] = useState<MatchedWatchlistRecord | null>(null);
  const [watchlistPhotoUrl, setWatchlistPhotoUrl] = useState<string | null>(null);

  const featureAllowed = agency ? features.security_intelligence : features.business_intelligence;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      const cfg = PERIOD_CONFIG[period];
      const toTs = new Date(Date.now() + 60_000).toISOString();
      const fromTs = new Date(Date.now() - cfg.days * 86_400_000).toISOString();

      try {
        const [featRes, camRes, actRes, occRes, tsRes, evtRes, alertRes, recRes] = await Promise.all([
          supabase.rpc('lv_workspace_feature_map', { target: workspaceId }),
          supabase.from('lv_cameras').select('id,name,location').eq('workspace_id', workspaceId).order('name'),
          supabase.rpc('lv_intel_camera_activity', { target: workspaceId }),
          supabase.rpc('lv_intel_current_occupancy', { target: workspaceId }),
          supabase.rpc('lv_intel_timeseries', {
            target: workspaceId,
            from_ts: fromTs,
            to_ts: toTs,
            bucket: cfg.bucket,
            camera: selectedCamera === 'all' ? null : selectedCamera,
          }),
          supabase
            .from('lv_intel_events')
            .select('id,camera_id,category,object_class,direction,event_count,zone_id,plate,confidence,payload,snapshot_path,source,occurred_at')
            .eq('workspace_id', workspaceId)
            .gte('occurred_at', fromTs)
            .order('occurred_at', { ascending: false })
            .limit(200),
          supabase
            .from('lv_agency_alerts')
            .select('id,title,details,severity,status,category,camera_id,event_id,recommended_action,snapshot_path,created_at')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('lv_records')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId)
            .eq('category', agency ? 'investigation' : 'incident')
            .neq('status', 'resolved'),
        ]);

        if (!active) return;

        if (featRes.data && typeof featRes.data === 'object' && !Array.isArray(featRes.data)) {
          setFeatures({ ...defaultFeatureMap(agency), ...(featRes.data as Partial<WorkspaceFeatureMap>) });
        }
        if (camRes.error) throw camRes.error;
        if (evtRes.error) throw evtRes.error;

        setCameras((camRes.data ?? []) as CameraRow[]);
        setCamActivity((actRes.data ?? []) as CameraActivityRow[]);
        setOccupancy((occRes.data ?? []) as OccupancyRow[]);
        setTimeseries((tsRes.data ?? []) as TimeseriesRow[]);
        setEvents((evtRes.data ?? []) as IntelEventRow[]);
        setAlerts((alertRes.data ?? []) as AlertSummaryRow[]);
        setIncidentCount(recRes.count ?? 0);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Analytics could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const unsub = subscribeAlertsChanged(() => setRefreshTick((t) => t + 1));
    return () => {
      active = false;
      unsub();
    };
  }, [workspaceId, agency, period, selectedCamera, refreshTick]);

  useEffect(() => {
    if (!agency) {
      setFaceSearchLogs([]);
      return;
    }
    let active = true;
    void supabase
      .from('lv_face_search_logs')
      .select('id,mode,top_confidence,matches_json,case_reference,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error: fsErr }) => {
        if (active && !fsErr && Array.isArray(data)) {
          setFaceSearchLogs(data);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId, agency, refreshTick]);

  // If initialEventId was passed (e.g. clicking Investigate from Alert or VideoAnalysis), fetch and open it
  useEffect(() => {
    if (!initialEventId) return;
    let active = true;
    const found = events.find((e) => e.id === initialEventId);
    if (found) {
      void openEventInspector(found);
      return;
    }
    void supabase
      .from('lv_intel_events')
      .select('id,camera_id,category,object_class,direction,event_count,zone_id,plate,confidence,payload,snapshot_path,source,occurred_at')
      .eq('id', initialEventId)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) void openEventInspector(data as IntelEventRow);
      });
    return () => {
      active = false;
    };
  }, [initialEventId, events]);

  async function openEventInspector(evt: IntelEventRow) {
    setInspectedEvent(evt);
    setInspectedSnapUrl(null);
    setMatchedWatchlist(null);
    setWatchlistPhotoUrl(null);

    if (evt.snapshot_path) {
      const { data: signed } = await supabase.storage
        .from('lv-intel-snapshots')
        .createSignedUrl(evt.snapshot_path, 300);
      if (signed?.signedUrl) setInspectedSnapUrl(signed.signedUrl);
    }

    if (agency && evt.plate) {
      const wlId = evt.payload?.watchlist_id;
      const query = wlId
        ? supabase.from('lv_vehicle_watchlist').select('*').eq('id', wlId).maybeSingle()
        : supabase
            .from('lv_vehicle_watchlist')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('plate', evt.plate)
            .is('retired_at', null)
            .maybeSingle();
      const { data: wl } = await query;
      if (wl) {
        const rec = wl as MatchedWatchlistRecord;
        setMatchedWatchlist(rec);
        if (rec.photo_path) {
          const { data: signedPhoto } = await supabase.storage
            .from('lv-vehicle-photos')
            .createSignedUrl(rec.photo_path, 300);
          if (signedPhoto?.signedUrl) setWatchlistPhotoUrl(signedPhoto.signedUrl);
        }
      }
    }
  }

  const cameraById = useMemo(() => {
    const map = new Map<string, CameraRow>();
    for (const c of cameras) map.set(c.id, c);
    return map;
  }, [cameras]);

  const activityByCamId = useMemo(() => {
    const map = new Map<string, CameraActivityRow>();
    for (const a of camActivity) map.set(a.camera_id, a);
    return map;
  }, [camActivity]);

  const matchingCameraIds = useMemo(() => {
    const q = locationFilter.trim().toLowerCase();
    return new Set(
      cameras
        .filter((c) => {
          if (selectedCamera !== 'all' && c.id !== selectedCamera) return false;
          if (!q) return true;
          return `${c.name} ${c.location}`.toLowerCase().includes(q);
        })
        .map((c) => c.id),
    );
  }, [cameras, selectedCamera, locationFilter]);

  const filteredTimeseries = useMemo(
    () =>
      timeseries.filter((row) => {
        if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
        if (row.camera_id && (selectedCamera !== 'all' || locationFilter.trim())) {
          if (!matchingCameraIds.has(row.camera_id)) return false;
        } else if (!row.camera_id && (selectedCamera !== 'all' || locationFilter.trim())) {
          return false;
        }
        return true;
      }),
    [timeseries, sourceFilter, selectedCamera, locationFilter, matchingCameraIds],
  );

  const filteredEvents = useMemo(() => {
    const normPlate = normalizePlate(plateSearch);
    return events.filter((e) => {
      if (!agency && (e.category === 'plate_read' || e.category === 'watchlist_match')) return false;
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (selectedCamera !== 'all' && e.camera_id !== selectedCamera) return false;
      if (locationFilter.trim()) {
        if (!e.camera_id || !matchingCameraIds.has(e.camera_id)) return false;
      }
      if (agency && normPlate && !(e.plate || '').includes(normPlate)) return false;
      return true;
    });
  }, [events, agency, sourceFilter, categoryFilter, selectedCamera, locationFilter, matchingCameraIds, plateSearch]);

  // Derived analytics metrics
  const stats = useMemo(() => {
    let peopleIn = 0;
    let peopleOut = 0;
    let peopleCensusSum = 0;
    let peopleCensusMax = 0;
    let vehiclesIn = 0;
    let vehiclesOut = 0;
    let vehiclesCensus = 0;
    let plateReads = 0;
    let watchlistMatches = 0;
    const vehicleByType: Record<string, number> = { car: 0, motorcycle: 0, bus: 0, truck: 0, bicycle: 0 };
    const bucketTotals = new Map<string, { people: number; vehicles: number; alerts: number }>();
    const hourlyTraffic = new Array<number>(24).fill(0);

    for (const row of filteredTimeseries) {
      const cnt = Number(row.total_count || 0);
      const evts = Number(row.events || 0);
      const bKey = row.bucket_start;
      const bEntry = bucketTotals.get(bKey) || { people: 0, vehicles: 0, alerts: 0 };

      if (row.object_class === 'person') {
        if (row.category === 'line_crossing') {
          if (row.direction === 'in') peopleIn += cnt;
          else if (row.direction === 'out') peopleOut += cnt;
          bEntry.people += cnt;
          hourlyTraffic[new Date(row.bucket_start).getHours()] += cnt;
        } else if (row.category === 'census' || row.category === 'occupancy') {
          peopleCensusSum += cnt;
          peopleCensusMax = Math.max(peopleCensusMax, Number(row.max_count || 0));
          bEntry.people += cnt;
          hourlyTraffic[new Date(row.bucket_start).getHours()] += cnt;
        }
      } else if (row.object_class && ['car', 'motorcycle', 'bus', 'truck', 'bicycle', 'vehicle'].includes(row.object_class)) {
        if (row.category === 'line_crossing') {
          if (row.direction === 'in') vehiclesIn += cnt;
          else if (row.direction === 'out') vehiclesOut += cnt;
          vehicleByType[row.object_class] = (vehicleByType[row.object_class] || 0) + cnt;
          bEntry.vehicles += cnt;
        } else if (row.category === 'census') {
          vehiclesCensus += cnt;
          vehicleByType[row.object_class] = (vehicleByType[row.object_class] || 0) + cnt;
          bEntry.vehicles += cnt;
        }
      }

      if (row.category === 'plate_read') plateReads += evts;
      if (row.category === 'watchlist_match') watchlistMatches += evts;
      if (
        ['crowd', 'loitering', 'intrusion', 'perimeter_breach', 'stationary_vehicle', 'abandoned_object', 'tamper', 'camera_offline', 'watchlist_match'].includes(
          row.category,
        )
      ) {
        bEntry.alerts += evts;
      }
      bucketTotals.set(bKey, bEntry);
    }

    const totalCameras = cameras.length;
    const recentCutoff = Date.now() - 24 * 3600_000;
    const activeCameras = cameras.filter((c) => {
      const act = activityByCamId.get(c.id);
      return act?.last_event_at && new Date(act.last_event_at).getTime() >= recentCutoff;
    }).length;

    const currentPeopleOccupancy = occupancy
      .filter((o) => o.object_class === 'person')
      .reduce((acc, o) => acc + Number(o.current_count || 0), 0);
    const currentParkingOccupancy = occupancy
      .filter((o) => o.object_class !== 'person')
      .reduce((acc, o) => acc + Number(o.current_count || 0), 0);

    let peakHourIdx = 0;
    let peakHourVal = 0;
    hourlyTraffic.forEach((v, idx) => {
      if (v > peakHourVal) {
        peakHourVal = v;
        peakHourIdx = idx;
      }
    });

    const openAlerts = alerts.filter((a) => a.status === 'open');
    const openWatchlistAlerts = openAlerts.filter((a) => a.category === 'watchlist_match');

    const timelineBuckets = Array.from(bucketTotals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24);

    return {
      totalCameras,
      activeCameras,
      inactiveCameras: Math.max(0, totalCameras - activeCameras),
      peopleFootfall: peopleIn > 0 ? peopleIn : peopleCensusSum,
      peopleIn,
      peopleOut,
      peoplePeakFrame: peopleCensusMax,
      currentPeopleOccupancy,
      currentParkingOccupancy,
      vehicleTraffic: vehiclesIn > 0 ? vehiclesIn + vehiclesOut : vehiclesCensus,
      vehiclesIn,
      vehiclesOut,
      vehicleByType,
      plateReads,
      watchlistMatches,
      openAlertsCount: openAlerts.length,
      openWatchlistAlertsCount: openWatchlistAlerts.length,
      peakHourLabel: peakHourVal > 0 ? `${String(peakHourIdx).padStart(2, '0')}:00–${String((peakHourIdx + 1) % 24).padStart(2, '0')}:00` : 'Insufficient data',
      hourlyTraffic,
      timelineBuckets,
    };
  }, [filteredTimeseries, cameras, activityByCamId, occupancy, alerts]);

  function exportReportCsv() {
    const headers = [
      'occurred_at',
      'source',
      'camera',
      'location',
      'category',
      'object_class',
      'direction',
      'count',
      'zone',
      ...(agency ? ['plate'] : []),
      'summary',
    ];
    const lines = [headers.join(',')];
    const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    for (const e of filteredEvents) {
      const cam = e.camera_id ? cameraById.get(e.camera_id) : undefined;
      const row = [
        e.occurred_at,
        e.source,
        cam?.name || (e.source === 'file' ? 'Uploaded file' : 'Unknown'),
        cam?.location || '',
        e.category,
        e.object_class || '',
        e.direction || '',
        e.event_count,
        e.zone_id || '',
        ...(agency ? [e.plate || ''] : []),
        e.payload?.summary || '',
      ];
      lines.push(row.map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lunavision_${agency ? 'security' : 'business'}_report_${period}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!featureAllowed && !loading) {
    return (
      <section className="lv-card">
        <h2>{agency ? 'Security Agency Intelligence' : 'Business Intelligence'}</h2>
        <p className="lv-notice">
          This intelligence module has been disabled for your organization by a Platform Administrator.
        </p>
      </section>
    );
  }

  const maxBucketVal = Math.max(
    1,
    ...stats.timelineBuckets.map(([, v]) => Math.max(v.people, v.vehicles, v.alerts * 5)),
  );
  const maxHourVal = Math.max(1, ...stats.hourlyTraffic);

  return (
    <section className="lv-card" aria-label={agency ? 'Security Agency Intelligence Dashboard' : 'Business Intelligence Dashboard'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2>{agency ? 'Security Agency Intelligence Dashboard' : 'Business Intelligence & Operations Analytics'}</h2>
          <p>
            {agency
              ? 'Real-time camera telemetry, people & vehicle statistics, ANPR plate activity, active watchlist alerts, and historical investigation records.'
              : 'Customer footfall, entry/exit flows, live zone occupancy, peak hours, vehicle & parking activity, and daily/weekly/monthly commercial reports.'}
          </p>
        </div>
        <div className="lv-video-actions">
          {agency && (
            <>
              <button
                type="button"
                className={showLiveScanner ? '' : 'lv-secondary'}
                onClick={() => setShowLiveScanner((prev) => !prev)}
              >
                {showLiveScanner ? 'Hide Live / Demo Face & Plate Scanner' : 'Run Live / Demo Face & Plate Scanner'}
              </button>
              <button
                type="button"
                className={showVehicleRecognition ? '' : 'lv-secondary'}
                onClick={() => setShowVehicleRecognition((prev) => !prev)}
              >
                {showVehicleRecognition ? 'Hide Vehicle Image Recognition' : 'Vehicle Image Recognition'}
              </button>
            </>
          )}
          <button type="button" className="lv-secondary" onClick={() => setRefreshTick((t) => t + 1)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh analytics'}
          </button>
          <button type="button" onClick={exportReportCsv} disabled={filteredEvents.length === 0}>
            Export CSV report
          </button>
        </div>
      </div>

      {agency && showLiveScanner && (
        <div className="lv-card" style={{ marginTop: '0.85rem', borderColor: '#2dd4bf', background: '#091017' }}>
          <VideoAnalysis
            workspaceId={workspaceId}
            watchlistWorkspaceId={features.anpr ? workspaceId : undefined}
            samples
            onInspectEvent={(id) => {
              const found = events.find((e) => e.id === id);
              if (found) void openEventInspector(found);
            }}
          />
        </div>
      )}

      {agency && showVehicleRecognition && (
        <VehicleImageRecognition
          workspaceId={workspaceId}
          onAlertsChanged={() => setRefreshTick((t) => t + 1)}
        />
      )}

      {/* Filters */}
      <div className="lv-observation-filters" style={{ marginTop: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', gridColumn: '1 / -1' }}>
          <label>
            Reporting period
            <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
              {Object.entries(PERIOD_CONFIG).map(([k, cfg]) => (
                <option key={k} value={k}>
                  {cfg.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Camera filter
            <select value={selectedCamera} onChange={(e) => setSelectedCamera(e.target.value)}>
              <option value="all">All cameras ({cameras.length})</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location filter
            <input
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="Filter by site or zone..."
            />
          </label>
          <label>
            Footage source
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as 'all' | 'camera' | 'file')}>
              <option value="all">All real events (Cameras + Uploads)</option>
              <option value="camera">Connected cameras only</option>
              <option value="file">Uploaded video files only</option>
            </select>
          </label>
          <label>
            Event category
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {Object.entries(CATEGORY_LABELS)
                .filter(([k]) => agency || (k !== 'plate_read' && k !== 'watchlist_match'))
                .map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
            </select>
          </label>
          {agency && (
            <label>
              Search number plate (ANPR)
              <input
                value={plateSearch}
                onChange={(e) => setPlateSearch(e.target.value)}
                placeholder="e.g. KJA492AX"
              />
            </label>
          )}
        </div>
      </div>

      {error && <p role="alert" style={{ color: '#ff8b89' }}>{error}</p>}

      {/* KPI Cards */}
      <div
        className="lv-console-metrics"
        style={{ marginTop: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))' }}
      >
        <button type="button" onClick={() => onNavigate?.('cameras')}>
          <span>Connected cameras</span>
          <strong>
            {stats.activeCameras} / {stats.totalCameras} active
          </strong>
          <small>{stats.inactiveCameras} inactive in last 24h</small>
        </button>

        {agency ? (
          <>
            <button type="button" onClick={() => setCategoryFilter('line_crossing')} style={{ borderColor: '#2dd4bf' }}>
              <span style={{ fontWeight: 700 }}>People detected / crossed</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats.peopleFootfall.toLocaleString()}</strong>
              <small style={{ fontWeight: 600 }}>
                In: {stats.peopleIn} · Out: {stats.peopleOut}
              </small>
            </button>
            <button type="button" onClick={() => setCategoryFilter('census')} style={{ borderColor: '#38bdf8' }}>
              <span style={{ fontWeight: 700 }}>Cars &amp; vehicle detections</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats.vehicleTraffic.toLocaleString()}</strong>
              <small style={{ fontWeight: 600 }}>
                {stats.vehicleByType.car || 0} car · {stats.vehicleByType.truck || 0} truck ·{' '}
                {stats.vehicleByType.motorcycle || 0} moto · {stats.vehicleByType.bus || 0} bus
              </small>
            </button>
            <button type="button" onClick={() => setCategoryFilter('plate_read')} style={{ borderColor: '#f59e0b' }}>
              <span style={{ fontWeight: 700 }}>ANPR plate reads</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{stats.plateReads.toLocaleString()}</strong>
              <small style={{ fontWeight: 700, color: stats.watchlistMatches > 0 ? '#ff8b89' : undefined }}>
                {stats.watchlistMatches} watchlist matches
              </small>
            </button>
            <button type="button" onClick={() => onNavigate?.('gallery')} style={{ borderColor: '#a855f7' }}>
              <span style={{ fontWeight: 700 }}>Biometric face matches</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>
                {faceSearchLogs.filter((l) => Array.isArray(l.matches_json) && l.matches_json.length > 0).length}
              </strong>
              <small style={{ fontWeight: 600 }}>{faceSearchLogs.length} total face scans logged</small>
            </button>
            <button type="button" onClick={() => onNavigate?.('alerts')} style={{ borderColor: stats.openAlertsCount > 0 ? '#ef4444' : undefined }}>
              <span style={{ fontWeight: 700 }}>Active alerts (open)</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800, color: stats.openAlertsCount > 0 ? '#ff8b89' : undefined }}>
                {stats.openAlertsCount}
              </strong>
              <small style={{ fontWeight: 600 }}>{stats.openWatchlistAlertsCount} active watchlist alerts</small>
            </button>
            <button type="button" onClick={() => onNavigate?.('records')}>
              <span style={{ fontWeight: 700 }}>Open investigations</span>
              <strong style={{ fontSize: '1.75rem', fontWeight: 800 }}>{incidentCount}</strong>
              <small style={{ fontWeight: 600 }}>Active agency case files</small>
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setCategoryFilter('line_crossing')}>
              <span>Customer footfall</span>
              <strong>{stats.peopleFootfall.toLocaleString()}</strong>
              <small>
                Entries: {stats.peopleIn} · Exits: {stats.peopleOut}
              </small>
            </button>
            <button type="button" onClick={() => setCategoryFilter('occupancy')}>
              <span>Live occupancy (10m)</span>
              <strong>{stats.currentPeopleOccupancy.toLocaleString()}</strong>
              <small>Peak frame: {stats.peoplePeakFrame}</small>
            </button>
            <button type="button">
              <span>Peak visiting hour</span>
              <strong style={{ fontSize: '1.1rem' }}>{stats.peakHourLabel}</strong>
              <small>Based on {PERIOD_CONFIG[period].label}</small>
            </button>
            <button type="button" onClick={() => setCategoryFilter('census')}>
              <span>Vehicle &amp; parking traffic</span>
              <strong>{stats.vehicleTraffic.toLocaleString()}</strong>
              <small>{stats.currentParkingOccupancy} parked vehicles (10m)</small>
            </button>
            <button type="button" onClick={() => onNavigate?.('alerts')}>
              <span>Open alerts &amp; incidents</span>
              <strong>
                {stats.openAlertsCount} / {incidentCount}
              </strong>
              <small>Threshold, crowd, tamper &amp; site incidents</small>
            </button>
          </>
        )}
      </div>

      {/* Biometric Face Recognition & ANPR Plate Intelligence Highlights (Agency) */}
      {agency && (
        <div className="lv-grid" style={{ marginTop: '1rem' }}>
          <div className="lv-card" style={{ marginBlock: 0, borderColor: '#243547' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Face Detection &amp; Biometric Matches</h3>
              <button type="button" className="lv-secondary" onClick={() => onNavigate?.('gallery')}>
                Open Face Search
              </button>
            </div>
            {faceSearchLogs.filter((l) => Array.isArray(l.matches_json) && l.matches_json.length > 0).length === 0 ? (
              <p style={{ marginTop: '0.5rem' }}>
                No face matches logged yet. Run Live Cameras, Demo Footage Scanner, or Face Search to correlate subjects.
              </p>
            ) : (
              faceSearchLogs
                .filter((l) => Array.isArray(l.matches_json) && l.matches_json.length > 0)
                .slice(0, 5)
                .map((log) => {
                  const top = log.matches_json[0];
                  return (
                    <article key={log.id} style={{ paddingBlock: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.98rem' }}>
                          {top?.full_name || 'Matched subject'}{' '}
                          {top?.subject_code && <span className="lv-badge">{top.subject_code}</span>}
                        </strong>
                        <span className={`lunar-badge ${top?.band === 'high' ? 'high' : 'medium'}`} style={{ fontWeight: 800 }}>
                          {Number(top?.confidence ?? log.top_confidence ?? 0).toFixed(1)}% · {(top?.band || 'MATCH').toUpperCase()}
                        </span>
                      </div>
                      <small>{new Date(log.created_at).toLocaleString()}</small>
                    </article>
                  );
                })
            )}
          </div>

          <div className="lv-card" style={{ marginBlock: 0, borderColor: '#243547' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Recognized Plates (LPR / ANPR) &amp; Fleet Tally</h3>
              <button type="button" className="lv-secondary" onClick={() => onNavigate?.('vehicles')}>
                Vehicle Watchlist
              </button>
            </div>
            <p style={{ marginTop: '0.5rem', fontWeight: 700 }}>
              Cars: {stats.vehicleByType.car || 0} · Trucks: {stats.vehicleByType.truck || 0} · Buses:{' '}
              {stats.vehicleByType.bus || 0} · Motorcycles: {stats.vehicleByType.motorcycle || 0}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {events
                .filter((e) => e.plate)
                .slice(0, 10)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="lv-badge"
                    onClick={() => void openEventInspector(e)}
                    style={{
                      cursor: 'pointer',
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      fontSize: '0.92rem',
                      borderColor: e.category === 'watchlist_match' ? '#ef4444' : '#76efd6',
                      color: e.category === 'watchlist_match' ? '#ff8b89' : '#f8fafc',
                    }}
                  >
                    {e.plate} {e.category === 'watchlist_match' ? '· MATCH' : ''}
                  </button>
                ))}
              {events.filter((e) => e.plate).length === 0 && (
                <small className="lv-muted">No plates logged in this reporting period yet.</small>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Historical Activity Chart + Peak Visiting Hours */}
      <div className="lv-grid" style={{ marginTop: '1.25rem' }}>
        <div className="lv-card" style={{ marginBlock: 0 }}>
          <h3>{agency ? 'Historical Detection Timeline' : 'Commercial Footfall & Vehicle Activity Report'}</h3>
          <p>
            Bucketed by <strong>{PERIOD_CONFIG[period].bucket}</strong> (Africa/Lagos) across active filters.
          </p>
          {stats.timelineBuckets.length === 0 ? (
            <p>No structured detection events recorded in this period yet. Run live camera or video analysis to populate trends.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '190px', padding: '12px 4px 4px', borderBottom: '1px solid #354858', overflowX: 'auto' }}>
              {stats.timelineBuckets.map(([bucketIso, val]) => {
                const pHeight = Math.max(4, Math.round((val.people / maxBucketVal) * 140));
                const vHeight = Math.max(4, Math.round((val.vehicles / maxBucketVal) * 140));
                const label =
                  period === '24h'
                    ? new Date(bucketIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date(bucketIso).toLocaleDateString([], { month: 'short', day: 'numeric' });
                return (
                  <div
                    key={bucketIso}
                    title={`${label}: ${val.people} people · ${val.vehicles} vehicles · ${val.alerts} alerts`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '34px', flex: 1 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '145px' }}>
                      <div style={{ width: '10px', height: `${pHeight}px`, background: '#76efd6', borderRadius: '2px 2px 0 0' }} />
                      <div style={{ width: '10px', height: `${vHeight}px`, background: '#38bdf8', borderRadius: '2px 2px 0 0' }} />
                    </div>
                    <small style={{ fontSize: '0.68rem', marginTop: '4px', whiteSpace: 'nowrap' }}>{label}</small>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#76efd6', marginRight: 5 }} />
              People detections / crossings
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 10, height: 10, background: '#38bdf8', marginRight: 5 }} />
              Vehicle traffic
            </span>
          </div>
        </div>

        {/* Peak Hours (Business) OR Vehicle Breakdown & Active Alerts (Agency) */}
        <div className="lv-card" style={{ marginBlock: 0 }}>
          {!agency ? (
            <>
              <h3>Peak Visiting Hours (24h distribution)</h3>
              <p>Busiest window: <strong>{stats.peakHourLabel}</strong></p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '120px', marginTop: '0.5rem', borderBottom: '1px solid #354858' }}>
                {stats.hourlyTraffic.map((val, hr) => {
                  const h = Math.max(3, Math.round((val / maxHourVal) * 105));
                  return (
                    <div
                      key={hr}
                      title={`${String(hr).padStart(2, '0')}:00 — ${val} visitors`}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: `${h}px`,
                          background: val === maxHourVal && val > 0 ? '#ffcc83' : '#397875',
                          borderRadius: '2px 2px 0 0',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '4px' }}>
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
              <h4 style={{ marginTop: '1rem' }}>Vehicle &amp; Parking Breakdown</h4>
              <p>
                Cars: {stats.vehicleByType.car || 0} · Motorcycles: {stats.vehicleByType.motorcycle || 0} · Buses:{' '}
                {stats.vehicleByType.bus || 0} · Trucks: {stats.vehicleByType.truck || 0}
              </p>
            </>
          ) : (
            <>
              <h3>Recent Watchlist &amp; Security Alerts</h3>
              {alerts.slice(0, 6).length === 0 ? (
                <p>No active alerts recorded yet.</p>
              ) : (
                alerts.slice(0, 6).map((a) => (
                  <article key={a.id} style={{ paddingBlock: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <strong>{a.title}</strong>
                      <span className={`lunar-badge ${a.severity}`}>{a.severity}</span>
                    </div>
                    <small>
                      {a.status} · {new Date(a.created_at).toLocaleString()}
                    </small>
                    {a.event_id && (
                      <div style={{ marginTop: '0.35rem' }}>
                        <button
                          type="button"
                          className="lv-secondary"
                          style={{ padding: '4px 9px', fontSize: '0.78rem' }}
                          onClick={() => {
                            const ev = events.find((x) => x.id === a.event_id);
                            if (ev) void openEventInspector(ev);
                            else {
                              void supabase
                                .from('lv_intel_events')
                                .select('*')
                                .eq('id', a.event_id)
                                .maybeSingle()
                                .then(({ data }) => {
                                  if (data) void openEventInspector(data as IntelEventRow);
                                });
                            }
                          }}
                        >
                          Investigate event
                        </button>
                      </div>
                    )}
                  </article>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* Camera-Based Activity Report */}
      <div style={{ marginTop: '1.25rem' }}>
        <h3>Camera-Based Activity Report</h3>
        {cameras.length === 0 ? (
          <p>No cameras registered in this workspace.</p>
        ) : (
          <div className="lv-observation-table">
            <table>
              <thead>
                <tr>
                  <th>Camera</th>
                  <th>Location</th>
                  <th>Status (24h telemetry)</th>
                  <th>Events (24h)</th>
                  <th>Last event</th>
                  {openCamera && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {cameras.map((cam) => {
                  const act = activityByCamId.get(cam.id);
                  const isActive =
                    act?.last_event_at && Date.now() - new Date(act.last_event_at).getTime() < 24 * 3600_000;
                  return (
                    <tr key={cam.id}>
                      <td><strong>{cam.name}</strong></td>
                      <td>{cam.location || '—'}</td>
                      <td>
                        <span className="lv-badge">{isActive ? 'Active' : 'Idle / Offline'}</span>
                      </td>
                      <td>{act?.events_24h ?? 0}</td>
                      <td>{act?.last_event_at ? new Date(act.last_event_at).toLocaleString() : 'Never'}</td>
                      {openCamera && (
                        <td>
                          <button type="button" className="lv-secondary" onClick={() => openCamera(cam.id)}>
                            Open feed
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event Investigation Detail Panel (when an event/alert is clicked) */}
      {inspectedEvent && (
        <div
          className="lv-card"
          style={{ border: '2px solid #76efd6', background: '#101821', marginTop: '1.25rem' }}
          role="region"
          aria-label="Detection event investigation"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>
              Event Investigation: {CATEGORY_LABELS[inspectedEvent.category] || inspectedEvent.category}
              {inspectedEvent.plate ? ` — Plate ${inspectedEvent.plate}` : ''}
            </h3>
            <button type="button" className="lv-secondary" onClick={() => setInspectedEvent(null)}>
              Close
            </button>
          </div>
          <div className="lv-grid" style={{ marginTop: '0.75rem' }}>
            <div>
              <p>
                <strong>Camera:</strong>{' '}
                {inspectedEvent.camera_id
                  ? `${cameraById.get(inspectedEvent.camera_id)?.name || 'Camera'} (${cameraById.get(inspectedEvent.camera_id)?.location || 'Unknown location'})`
                  : 'Uploaded video file'}
              </p>
              <p>
                <strong>Timestamp:</strong> {new Date(inspectedEvent.occurred_at).toLocaleString()} ·{' '}
                <strong>Source:</strong> {inspectedEvent.source === 'camera' ? 'Live camera' : 'Uploaded video'}
              </p>
              <p>
                <strong>Details:</strong> {inspectedEvent.payload?.summary || '—'}{' '}
                {inspectedEvent.confidence !== null && `· Confidence ${Math.round(inspectedEvent.confidence * 100)}%`}
              </p>

              {agency && inspectedEvent.payload?.registry && (
                <div className="lv-card" style={{ background: '#0c131b' }}>
                  <h4>Vehicle Registration Record Match</h4>
                  <p>
                    {[
                      inspectedEvent.payload.registry.colour,
                      inspectedEvent.payload.registry.make,
                      inspectedEvent.payload.registry.model,
                    ]
                      .filter(Boolean)
                      .join(' ') || 'Vehicle'}{' '}
                    · Registration status: <strong>{inspectedEvent.payload.registry.registration_status}</strong>
                  </p>
                </div>
              )}

              {agency && matchedWatchlist && (
                <div className="lv-card" style={{ borderColor: '#ef4444', background: 'rgba(127, 29, 29, 0.2)' }}>
                  <h4>Matched Security Watchlist Record</h4>
                  <p>
                    <strong>Plate:</strong> {matchedWatchlist.plate} · <strong>Case Ref:</strong>{' '}
                    {matchedWatchlist.case_reference} · <strong>Status:</strong> {matchedWatchlist.status}
                  </p>
                  <p>
                    <strong>Vehicle:</strong>{' '}
                    {[matchedWatchlist.colour, matchedWatchlist.make, matchedWatchlist.model].filter(Boolean).join(' ') || '—'}
                  </p>
                  {matchedWatchlist.description && <p>{matchedWatchlist.description}</p>}
                  {matchedWatchlist.notes && (
                    <p>
                      <small>Notes: {matchedWatchlist.notes}</small>
                    </p>
                  )}
                  {watchlistPhotoUrl && (
                    <img
                      src={watchlistPhotoUrl}
                      alt={`Watchlist photo for ${matchedWatchlist.plate}`}
                      style={{ maxWidth: '240px', borderRadius: '6px', marginTop: '0.5rem' }}
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              {inspectedSnapUrl ? (
                <figure style={{ margin: 0 }}>
                  <img
                    src={inspectedSnapUrl}
                    alt="Detection event snapshot"
                    style={{ width: '100%', borderRadius: '8px', border: '1px solid #354858' }}
                  />
                  <figcaption style={{ marginTop: '0.4rem', color: '#98aab8', fontSize: '0.82rem' }}>
                    Captured event snapshot
                  </figcaption>
                </figure>
              ) : (
                <p className="lv-muted">No snapshot image attached to this event.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Searchable Detection History & Vehicle/Event Records */}
      <div style={{ marginTop: '1.5rem' }}>
        <h3>
          {agency
            ? `Searchable Detection & ANPR Event Timeline (${filteredEvents.length})`
            : `Activity & Detection Event Timeline (${filteredEvents.length})`}
        </h3>
        {filteredEvents.length === 0 ? (
          <p>No detection events match your current filters.</p>
        ) : (
          <div className="lv-observation-table">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Source</th>
                  <th>Camera / Location</th>
                  <th>Category</th>
                  <th>Object / Direction</th>
                  {agency && <th>Plate / Registry</th>}
                  <th>Count / Zone</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 120).map((evt) => {
                  const cam = evt.camera_id ? cameraById.get(evt.camera_id) : undefined;
                  const reg = evt.payload?.registry;
                  return (
                    <tr key={evt.id}>
                      <td>{new Date(evt.occurred_at).toLocaleString()}</td>
                      <td>
                        <span className="lv-badge">{evt.source === 'camera' ? 'Live cam' : 'File'}</span>
                      </td>
                      <td>
                        {cam ? `${cam.name}${cam.location ? ` (${cam.location})` : ''}` : 'Uploaded footage'}
                      </td>
                      <td>{CATEGORY_LABELS[evt.category] || evt.category}</td>
                      <td>
                        {evt.object_class || '—'}
                        {evt.direction ? ` (${evt.direction})` : ''}
                      </td>
                      {agency && (
                        <td>
                          {evt.plate ? (
                            <>
                              <strong>{evt.plate}</strong>
                              {reg && (
                                <div>
                                  <small>
                                    {[reg.colour, reg.make, reg.model].filter(Boolean).join(' ')} ({reg.registration_status})
                                  </small>
                                </div>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      )}
                      <td>
                        {evt.event_count}
                        {evt.zone_id ? ` · ${evt.payload?.zone_name || evt.zone_id}` : ''}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="lv-secondary"
                          onClick={() => void openEventInspector(evt)}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
