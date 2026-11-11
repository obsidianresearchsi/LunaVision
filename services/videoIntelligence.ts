export type WorkspaceFeatureKey =
  | 'people_analytics'
  | 'vehicle_analytics'
  | 'advanced_detection'
  | 'anpr'
  | 'vehicle_registry'
  | 'security_intelligence'
  | 'business_intelligence'
  | 'biometric_enrollment'
  | 'face_search';

export type WorkspaceFeatureMap = Record<WorkspaceFeatureKey, boolean>;

export type WorkspaceRole = 'owner' | 'admin' | 'supervisor' | 'investigator' | 'member' | 'viewer';

export type CapabilityKey =
  | 'people_detection'
  | 'people_counting'
  | 'occupancy'
  | 'crowd'
  | 'vehicle_detection'
  | 'vehicle_counting'
  | 'vehicle_stationary'
  | 'loitering'
  | 'intrusion'
  | 'perimeter'
  | 'abandoned_object'
  | 'tamper'
  | 'camera_health'
  | 'anpr';

export type SensitivityLevel = 'low' | 'medium' | 'high';

export type ZoneKind = 'count_line' | 'area' | 'restricted' | 'perimeter' | 'parking';

export interface CameraZone {
  id: string;
  name: string;
  kind: ZoneKind;
  points: [number, number][];
  direction?: 'up' | 'down' | 'left' | 'right';
}

export type IntelEventCategory =
  | 'census'
  | 'line_crossing'
  | 'occupancy'
  | 'crowd'
  | 'loitering'
  | 'intrusion'
  | 'perimeter_breach'
  | 'stationary_vehicle'
  | 'abandoned_object'
  | 'tamper'
  | 'camera_offline'
  | 'plate_read'
  | 'watchlist_match';

export type AlertNotifyCategory =
  | 'crowd'
  | 'loitering'
  | 'intrusion'
  | 'perimeter_breach'
  | 'stationary_vehicle'
  | 'abandoned_object'
  | 'tamper'
  | 'camera_offline'
  | 'watchlist_match';

export interface CameraIntelSettings {
  capabilities: Record<CapabilityKey, { enabled: boolean; sensitivity: SensitivityLevel }>;
  zones: CameraZone[];
  thresholds: {
    crowd_max: number;
    occupancy_max: number;
    loiter_seconds: number;
    stationary_seconds: number;
    abandoned_seconds: number;
    alert_cooldown_seconds: number;
  };
  schedule: {
    enabled: boolean;
    days: number[];
    start: string;
    end: string;
  };
  notify: {
    categories: AlertNotifyCategory[];
  };
}

export interface CapabilityDescriptor {
  key: CapabilityKey;
  label: string;
  group: 'people' | 'vehicle' | 'advanced' | 'anpr';
  feature: WorkspaceFeatureKey;
  agencyOnly?: boolean;
  engine: string;
  description: string;
}

export const CAPABILITY_CATALOG: CapabilityDescriptor[] = [
  {
    key: 'people_detection',
    label: 'People detection & classification',
    group: 'people',
    feature: 'people_analytics',
    engine: 'COCO-SSD + Multi-Object Tracker',
    description: 'Detect people in real time and track movement direction across frames.',
  },
  {
    key: 'people_counting',
    label: 'Footfall & entry/exit counting',
    group: 'people',
    feature: 'people_analytics',
    engine: 'COCO-SSD + Virtual Count Line',
    description: 'Count people in frame and record entries and exits across virtual counting boundaries.',
  },
  {
    key: 'occupancy',
    label: 'Area occupancy monitoring',
    group: 'people',
    feature: 'people_analytics',
    engine: 'COCO-SSD + Polygon Zone Geometry',
    description: 'Track how many people are currently inside defined monitored areas or the full camera view.',
  },
  {
    key: 'crowd',
    label: 'Crowd concentration & overcrowding',
    group: 'people',
    feature: 'people_analytics',
    engine: 'COCO-SSD + Threshold Monitor',
    description: 'Raise an alert when simultaneous people count reaches or exceeds the configured crowd limit.',
  },
  {
    key: 'vehicle_detection',
    label: 'Vehicle detection & classification',
    group: 'vehicle',
    feature: 'vehicle_analytics',
    engine: 'COCO-SSD + Multi-Object Tracker',
    description: 'Classify cars, motorcycles, buses, trucks, and bicycles and track movement direction.',
  },
  {
    key: 'vehicle_counting',
    label: 'Vehicle entry/exit & traffic counting',
    group: 'vehicle',
    feature: 'vehicle_analytics',
    engine: 'COCO-SSD + Virtual Count Line',
    description: 'Count vehicles by category and record directional entry/exit crossings.',
  },
  {
    key: 'vehicle_stationary',
    label: 'Stationary & parked vehicle detection',
    group: 'vehicle',
    feature: 'vehicle_analytics',
    engine: 'IoU Centroid Dwell Tracker',
    description: 'Detect vehicles remaining stationary or parked inside monitored/parking zones beyond the allowed duration.',
  },
  {
    key: 'loitering',
    label: 'Loitering detection',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'IoU Centroid Dwell Tracker',
    description: 'Flag individuals remaining within a localized area beyond the configured loitering duration.',
  },
  {
    key: 'intrusion',
    label: 'Restricted-area intrusion detection',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'Polygon Ray-Casting Engine',
    description: 'Trigger immediate high-priority alerts when a person or vehicle enters a restricted zone.',
  },
  {
    key: 'perimeter',
    label: 'Perimeter monitoring',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'Polygon Boundary Monitor',
    description: 'Detect movement breaching a defined perimeter boundary.',
  },
  {
    key: 'abandoned_object',
    label: 'Abandoned / unattended object detection',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'COCO-SSD + Owner Proximity Tracker',
    description: 'Detect bags, backpacks, or suitcases left stationary without a person nearby beyond the configured limit.',
  },
  {
    key: 'tamper',
    label: 'Camera tampering & obstruction detection',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'Canvas Luminance & Variance Analyzer',
    description: 'Detect lens blackout, severe obstruction, or frozen video frames.',
  },
  {
    key: 'camera_health',
    label: 'Camera offline & stream health alerts',
    group: 'advanced',
    feature: 'advanced_detection',
    engine: 'Stream Health Monitor',
    description: 'Generate an alert when a connected camera stream fails to load or drops offline.',
  },
  {
    key: 'anpr',
    label: 'Automatic Number Plate Recognition (ANPR)',
    group: 'anpr',
    feature: 'anpr',
    agencyOnly: true,
    engine: 'Tesseract.js OCR + Watchlist Matcher',
    description: 'Extract vehicle registration numbers, normalize plates, and match against the active security watchlist in real time.',
  },
];

export const VEHICLE_CLASSES = new Set(['car', 'motorcycle', 'bus', 'truck', 'bicycle']);
export const ABANDONED_ITEM_CLASSES = new Set(['backpack', 'suitcase', 'handbag', 'umbrella']);

export function defaultFeatureMap(agency: boolean): WorkspaceFeatureMap {
  return {
    people_analytics: true,
    vehicle_analytics: true,
    advanced_detection: true,
    anpr: agency,
    vehicle_registry: agency,
    security_intelligence: agency,
    business_intelligence: !agency,
    biometric_enrollment: agency,
    face_search: agency,
  };
}

export function roleCan(
  memberRole: string | undefined,
  permission:
    | 'configure'
    | 'watchlist_write'
    | 'watchlist_archive'
    | 'watchlist_delete'
    | 'registry_write'
    | 'alert_ack'
    | 'alert_resolve',
  platformAdmin = false,
): boolean {
  if (platformAdmin) return true;
  const role = memberRole || 'member';
  switch (permission) {
    case 'configure':
      return role === 'owner' || role === 'admin';
    case 'watchlist_write':
      return role === 'owner' || role === 'admin' || role === 'supervisor' || role === 'investigator';
    case 'watchlist_archive':
      return role === 'owner' || role === 'admin' || role === 'supervisor';
    case 'watchlist_delete':
      return role === 'owner' || role === 'admin';
    case 'registry_write':
      return role === 'owner' || role === 'admin' || role === 'supervisor';
    case 'alert_ack':
    case 'alert_resolve':
      return (
        role === 'owner' ||
        role === 'admin' ||
        role === 'supervisor' ||
        role === 'investigator' ||
        role === 'member'
      );
    default:
      return false;
  }
}

export function defaultCameraIntelSettings(
  agency: boolean,
  features?: Partial<WorkspaceFeatureMap>,
): CameraIntelSettings {
  const f = { ...defaultFeatureMap(agency), ...(features || {}) };
  const notifyCategories: AlertNotifyCategory[] = [
    'crowd',
    'loitering',
    'intrusion',
    'perimeter_breach',
    'stationary_vehicle',
    'abandoned_object',
    'tamper',
    'camera_offline',
  ];
  if (agency && f.anpr) notifyCategories.push('watchlist_match');

  return {
    capabilities: {
      people_detection: { enabled: Boolean(f.people_analytics), sensitivity: 'medium' },
      people_counting: { enabled: Boolean(f.people_analytics), sensitivity: 'medium' },
      occupancy: { enabled: Boolean(f.people_analytics), sensitivity: 'medium' },
      crowd: { enabled: Boolean(f.people_analytics), sensitivity: 'medium' },
      vehicle_detection: { enabled: Boolean(f.vehicle_analytics), sensitivity: 'medium' },
      vehicle_counting: { enabled: Boolean(f.vehicle_analytics), sensitivity: 'medium' },
      vehicle_stationary: { enabled: false, sensitivity: 'medium' },
      loitering: { enabled: false, sensitivity: 'medium' },
      intrusion: { enabled: Boolean(f.advanced_detection), sensitivity: 'medium' },
      perimeter: { enabled: false, sensitivity: 'medium' },
      abandoned_object: { enabled: false, sensitivity: 'medium' },
      tamper: { enabled: Boolean(f.advanced_detection), sensitivity: 'medium' },
      camera_health: { enabled: Boolean(f.advanced_detection), sensitivity: 'medium' },
      anpr: { enabled: Boolean(agency && f.anpr), sensitivity: 'medium' },
    },
    zones: [],
    thresholds: {
      crowd_max: 10,
      occupancy_max: 25,
      loiter_seconds: 25,
      stationary_seconds: 60,
      abandoned_seconds: 30,
      alert_cooldown_seconds: 60,
    },
    schedule: {
      enabled: false,
      days: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00',
      end: '23:59',
    },
    notify: {
      categories: notifyCategories,
    },
  };
}

export function normalizeCameraIntelSettings(
  raw: unknown,
  agency: boolean,
  features?: Partial<WorkspaceFeatureMap>,
): CameraIntelSettings {
  const base = defaultCameraIntelSettings(agency, features);
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, any>;
  const f = { ...defaultFeatureMap(agency), ...(features || {}) };

  if (obj.capabilities && typeof obj.capabilities === 'object') {
    for (const desc of CAPABILITY_CATALOG) {
      const incoming = obj.capabilities[desc.key];
      if (incoming && typeof incoming === 'object') {
        const allowed = Boolean(f[desc.feature]) && (!desc.agencyOnly || agency);
        const sensitivity: SensitivityLevel =
          incoming.sensitivity === 'low' || incoming.sensitivity === 'medium' || incoming.sensitivity === 'high'
            ? incoming.sensitivity
            : 'medium';
        base.capabilities[desc.key] = {
          enabled: allowed ? Boolean(incoming.enabled) : false,
          sensitivity,
        };
      }
    }
  }

  if (Array.isArray(obj.zones)) {
    const seen = new Set<string>();
    base.zones = obj.zones
      .filter((z: any) => z && typeof z === 'object')
      .map((z: any, idx: number): CameraZone | null => {
        const rawId = String(z.id || `zone_${idx + 1}`).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
        if (!rawId || seen.has(rawId)) return null;
        const kind: ZoneKind = ['count_line', 'area', 'restricted', 'perimeter', 'parking'].includes(z.kind)
          ? z.kind
          : 'area';
        const pts: [number, number][] = Array.isArray(z.points)
          ? z.points
              .filter((p: any) => Array.isArray(p) && p.length === 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
              .map((p: any) => [
                Math.min(1, Math.max(0, Number(Number(p[0]).toFixed(4)))),
                Math.min(1, Math.max(0, Number(Number(p[1]).toFixed(4)))),
              ])
          : [];
        if ((kind === 'count_line' && pts.length !== 2) || (kind !== 'count_line' && (pts.length < 3 || pts.length > 32))) {
          return null;
        }
        seen.add(rawId);
        return {
          id: rawId,
          name: String(z.name || `Zone ${idx + 1}`).trim().slice(0, 60) || `Zone ${idx + 1}`,
          kind,
          points: pts,
          ...(z.direction && ['up', 'down', 'left', 'right'].includes(z.direction) ? { direction: z.direction } : {}),
        };
      })
      .filter((z): z is CameraZone => z !== null)
      .slice(0, 20);
  }

  if (obj.thresholds && typeof obj.thresholds === 'object') {
    const clamp = (val: any, fallback: number, min: number, max: number) => {
      const n = Number(val);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    base.thresholds = {
      crowd_max: clamp(obj.thresholds.crowd_max, base.thresholds.crowd_max, 1, 1000),
      occupancy_max: clamp(obj.thresholds.occupancy_max, base.thresholds.occupancy_max, 1, 10000),
      loiter_seconds: clamp(obj.thresholds.loiter_seconds, base.thresholds.loiter_seconds, 5, 86400),
      stationary_seconds: clamp(obj.thresholds.stationary_seconds, base.thresholds.stationary_seconds, 30, 86400),
      abandoned_seconds: clamp(obj.thresholds.abandoned_seconds, base.thresholds.abandoned_seconds, 15, 86400),
      alert_cooldown_seconds: clamp(obj.thresholds.alert_cooldown_seconds, base.thresholds.alert_cooldown_seconds, 15, 3600),
    };
  }

  if (obj.schedule && typeof obj.schedule === 'object') {
    const days = Array.isArray(obj.schedule.days)
      ? Array.from(new Set(obj.schedule.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)))
      : base.schedule.days;
    const validTime = (t: any, fallback: string) =>
      typeof t === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t) ? t : fallback;
    base.schedule = {
      enabled: Boolean(obj.schedule.enabled),
      days: days.length ? (days as number[]) : [0, 1, 2, 3, 4, 5, 6],
      start: validTime(obj.schedule.start, '00:00'),
      end: validTime(obj.schedule.end, '23:59'),
    };
  }

  if (obj.notify && typeof obj.notify === 'object' && Array.isArray(obj.notify.categories)) {
    const validCats = new Set<AlertNotifyCategory>([
      'crowd',
      'loitering',
      'intrusion',
      'perimeter_breach',
      'stationary_vehicle',
      'abandoned_object',
      'tamper',
      'camera_offline',
      'watchlist_match',
    ]);
    base.notify.categories = obj.notify.categories.filter(
      (c: any): c is AlertNotifyCategory => typeof c === 'string' && validCats.has(c as AlertNotifyCategory) && (agency || c !== 'watchlist_match'),
    );
  }

  return base;
}

export function sensitivityMinimumConfidence(sensitivity: SensitivityLevel): number {
  switch (sensitivity) {
    case 'high':
      return 0.42;
    case 'low':
      return 0.68;
    case 'medium':
    default:
      return 0.52;
  }
}

export function normalizePlate(value: string | null | undefined): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isValidNormalizedPlate(plate: string): boolean {
  return /^[A-Z0-9]{2,12}$/.test(plate);
}

export function isWithinOperatingSchedule(schedule: CameraIntelSettings['schedule'], now = new Date()): boolean {
  if (!schedule?.enabled) return true;
  const day = now.getDay();
  if (!schedule.days.includes(day)) return false;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const current = `${hh}:${mm}`;
  if (schedule.start <= schedule.end) {
    return current >= schedule.start && current <= schedule.end;
  }
  // Overnight schedule (e.g., 20:00 to 06:00)
  return current >= schedule.start || current <= schedule.end;
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(A: [number, number], B: [number, number], C: [number, number]): number {
  return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
}

export function crossedCountLine(
  prev: [number, number],
  curr: [number, number],
  line: [number, number][],
  entryDirection: 'up' | 'down' | 'left' | 'right' = 'down',
): 'in' | 'out' | null {
  if (line.length !== 2) return null;
  const [p1, p2] = line;
  const d1 = ccw(p1, p2, prev);
  const d2 = ccw(p1, p2, curr);
  const d3 = ccw(prev, curr, p1);
  const d4 = ccw(prev, curr, p2);
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) {
    return null;
  }
  const dx = curr[0] - prev[0];
  const dy = curr[1] - prev[1];
  switch (entryDirection) {
    case 'down':
      return dy >= 0 ? 'in' : 'out';
    case 'up':
      return dy <= 0 ? 'in' : 'out';
    case 'right':
      return dx >= 0 ? 'in' : 'out';
    case 'left':
      return dx <= 0 ? 'in' : 'out';
    default:
      return dy >= 0 ? 'in' : 'out';
  }
}

export function analyzeFrameTamper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  prevSignature?: number[] | null,
): { tampered: boolean; reason: string | null; meanLuma: number; stdDevLuma: number; signature: number[] } {
  const sampleW = Math.min(64, Math.max(8, width));
  const sampleH = Math.min(36, Math.max(8, height));
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, sampleW, sampleH).data;
  } catch {
    return { tampered: false, reason: null, meanLuma: 128, stdDevLuma: 32, signature: [] };
  }
  const lumas: number[] = [];
  const signature: number[] = [];
  const step = Math.max(1, Math.floor((sampleW * sampleH) / 32));
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lumas.push(luma);
    sum += luma;
    if (p % step === 0 && signature.length < 32) {
      signature.push(Math.round(luma));
    }
  }
  const n = lumas.length || 1;
  const meanLuma = sum / n;
  let varianceSum = 0;
  for (const l of lumas) {
    varianceSum += (l - meanLuma) ** 2;
  }
  const stdDevLuma = Math.sqrt(varianceSum / n);

  if (meanLuma < 12 && stdDevLuma < 6) {
    return { tampered: true, reason: 'Lens covered or camera blackout detected', meanLuma, stdDevLuma, signature };
  }
  if (meanLuma > 246 && stdDevLuma < 5) {
    return { tampered: true, reason: 'Camera blinding / extreme overexposure detected', meanLuma, stdDevLuma, signature };
  }
  if (stdDevLuma < 2.2) {
    return { tampered: true, reason: 'Severe lens obstruction (flat uniform frame)', meanLuma, stdDevLuma, signature };
  }
  if (prevSignature && prevSignature.length === signature.length && signature.length > 0) {
    let diff = 0;
    for (let i = 0; i < signature.length; i++) {
      diff += Math.abs(signature[i] - prevSignature[i]);
    }
    if (diff === 0 && stdDevLuma < 4) {
      return { tampered: true, reason: 'Frozen low-variance video feed detected', meanLuma, stdDevLuma, signature };
    }
  }
  return { tampered: false, reason: null, meanLuma, stdDevLuma, signature };
}

export interface RawDetection {
  class: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
}

export interface TrackedEntity {
  trackId: number;
  objectClass: string;
  score: number;
  bbox: [number, number, number, number]; // pixels
  normBox: [number, number, number, number]; // [x, y, w, h] in 0..1
  centroid: [number, number]; // [cx, cy] in 0..1
  firstSeenMs: number;
  lastSeenMs: number;
  anchorCentroid: [number, number];
  anchorSinceMs: number;
  dwellSeconds: number;
  stationarySeconds: number;
  direction: 'N' | 'S' | 'E' | 'W' | 'Stationary';
   crossedZones: Set<string>;
  alertedKinds: Set<string>;
}

export interface PendingIntelEvent {
  request_id: string;
  camera: string | null;
  source: 'camera' | 'file';
  category: IntelEventCategory;
  object_class?: string;
  direction?: 'in' | 'out';
  count?: number;
  zone?: string;
  plate?: string;
  confidence?: number;
  occurred_at: string;
  snapshot_path?: string;
  needsSnapshot?: boolean;
  payload: Record<string, any>;
}

export interface FrameIntelligenceSummary {
  withinSchedule: boolean;
  peopleCurrent: number;
  peopleEntered: number;
  peopleExited: number;
  vehiclesCurrent: number;
  vehiclesEntered: number;
  vehiclesExited: number;
  vehicleByType: Record<string, number>;
  zoneOccupancy: Record<string, { name: string; kind: ZoneKind; people: number; vehicles: number }>;
  activeTracks: TrackedEntity[];
  tampered: boolean;
  tamperReason: string | null;
}

function boxIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  return inter / (areaA + areaB - inter + 1e-9);
}

function distance2D(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export class VideoIntelligenceTracker {
  private nextTrackId = 1;
  private tracks = new Map<number, TrackedEntity>();
  private peopleEntered = 0;
  private peopleExited = 0;
  private vehiclesEntered = 0;
  private vehiclesExited = 0;
  private lastCensusMs = 0;
  private lastOccupancyMs = 0;
  private lastAlertByKey = new Map<string, number>();
  private consecutiveTamperFrames = 0;
  private prevTamperSignature: number[] | null = null;

  reset(): void {
    this.tracks.clear();
    this.peopleEntered = 0;
    this.peopleExited = 0;
    this.vehiclesEntered = 0;
    this.vehiclesExited = 0;
    this.lastCensusMs = 0;
    this.lastOccupancyMs = 0;
    this.lastAlertByKey.clear();
    this.consecutiveTamperFrames = 0;
    this.prevTamperSignature = null;
  }

  private canEmitKey(key: string, nowMs: number, cooldownMs: number): boolean {
    const prev = this.lastAlertByKey.get(key);
    if (prev !== undefined && nowMs - prev < cooldownMs) return false;
    this.lastAlertByKey.set(key, nowMs);
    return true;
  }

  processFrame(params: {
    detections: RawDetection[];
    frameWidth: number;
    frameHeight: number;
    settings: CameraIntelSettings;
    cameraId: string | null;
    source: 'camera' | 'file';
    nowMs?: number;
    tamperCheck?: { tampered: boolean; reason: string | null; signature: number[] };
  }): { summary: FrameIntelligenceSummary; events: PendingIntelEvent[] } {
    const {
      detections,
      frameWidth,
      frameHeight,
      settings,
      cameraId,
      source,
      nowMs = Date.now(),
      tamperCheck,
    } = params;

    const w = Math.max(1, frameWidth);
    const h = Math.max(1, frameHeight);
    const nowDate = new Date(nowMs);
    const nowIso = nowDate.toISOString();
    const withinSchedule = isWithinOperatingSchedule(settings.schedule, nowDate);
    const cooldownMs = Math.max(15, settings.thresholds.alert_cooldown_seconds || 60) * 1000;
    const events: PendingIntelEvent[] = [];

    const caps = settings.capabilities;
    const peopleEnabled =
      caps.people_detection?.enabled ||
      caps.people_counting?.enabled ||
      caps.occupancy?.enabled ||
      caps.crowd?.enabled ||
      caps.loitering?.enabled ||
      caps.intrusion?.enabled ||
      caps.perimeter?.enabled ||
      caps.abandoned_object?.enabled;

    const vehicleEnabled =
      caps.vehicle_detection?.enabled ||
      caps.vehicle_counting?.enabled ||
      caps.vehicle_stationary?.enabled ||
      caps.intrusion?.enabled ||
      caps.perimeter?.enabled ||
      caps.anpr?.enabled;

    // Filter detections based on enabled capabilities and per-capability sensitivity
    const filtered = detections.filter((d) => {
      const cls = d.class.toLowerCase();
      if (cls === 'person') {
        if (!peopleEnabled) return false;
        const minConf = sensitivityMinimumConfidence(caps.people_detection?.sensitivity || 'medium');
        return d.score >= minConf;
      }
      if (VEHICLE_CLASSES.has(cls)) {
        if (!vehicleEnabled) return false;
        const minConf = sensitivityMinimumConfidence(caps.vehicle_detection?.sensitivity || 'medium');
        return d.score >= minConf;
      }
      if (ABANDONED_ITEM_CLASSES.has(cls)) {
        if (!caps.abandoned_object?.enabled) return false;
        const minConf = sensitivityMinimumConfidence(caps.abandoned_object?.sensitivity || 'medium');
        return d.score >= minConf;
      }
      return false;
    });

    // Match detections to existing tracks via class + IoU / centroid proximity
    const matchedTrackIds = new Set<number>();
    const activeTracks: TrackedEntity[] = [];

    for (const det of filtered) {
      const cls = det.class.toLowerCase();
      const normBox: [number, number, number, number] = [
        det.bbox[0] / w,
        det.bbox[1] / h,
        det.bbox[2] / w,
        det.bbox[3] / h,
      ];
      const centroid: [number, number] = [normBox[0] + normBox[2] / 2, normBox[1] + normBox[3] / 2];

      let bestTrack: TrackedEntity | null = null;
      let bestScore = 0;

      for (const track of this.tracks.values()) {
        if (matchedTrackIds.has(track.trackId) || track.objectClass !== cls) continue;
        if (nowMs - track.lastSeenMs > 3500) continue;
        const iou = boxIoU(track.normBox, normBox);
        const dist = distance2D(track.centroid, centroid);
        const matchScore = iou * 0.7 + Math.max(0, 1 - dist / 0.28) * 0.3;
        if ((iou >= 0.10 || dist <= 0.22) && matchScore > bestScore) {
          bestScore = matchScore;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        const prevCentroid = bestTrack.centroid;
        const dx = centroid[0] - bestTrack.anchorCentroid[0];
        const dy = centroid[1] - bestTrack.anchorCentroid[1];
        const moveFromAnchor = Math.hypot(dx, dy);

        let direction: TrackedEntity['direction'] = bestTrack.direction;
        const stepDx = centroid[0] - prevCentroid[0];
        const stepDy = centroid[1] - prevCentroid[1];
        if (Math.hypot(stepDx, stepDy) > 0.012) {
          if (Math.abs(stepDx) >= Math.abs(stepDy)) {
            direction = stepDx > 0 ? 'E' : 'W';
          } else {
            direction = stepDy > 0 ? 'S' : 'N';
          }
        }

        if (moveFromAnchor > 0.06) {
          bestTrack.anchorCentroid = centroid;
          bestTrack.anchorSinceMs = nowMs;
          bestTrack.stationarySeconds = 0;
        } else {
          bestTrack.stationarySeconds = Math.max(0, (nowMs - bestTrack.anchorSinceMs) / 1000);
          if (bestTrack.stationarySeconds >= 3) {
            direction = 'Stationary';
          }
        }

        bestTrack.score = det.score;
        bestTrack.bbox = det.bbox;
        bestTrack.normBox = normBox;
        bestTrack.centroid = centroid;
        bestTrack.lastSeenMs = nowMs;
        bestTrack.dwellSeconds = Math.max(0, (nowMs - bestTrack.firstSeenMs) / 1000);
        bestTrack.direction = direction;

        // Check count_line crossings between prevCentroid and centroid
        if (withinSchedule) {
          for (const zone of settings.zones) {
            if (zone.kind !== 'count_line') continue;
            const crossDir = crossedCountLine(prevCentroid, centroid, zone.points, zone.direction || 'down');
            if (crossDir && !bestTrack.crossedZones.has(`${zone.id}:${crossDir}`)) {
              bestTrack.crossedZones.add(`${zone.id}:${crossDir}`);
              if (cls === 'person' && caps.people_counting?.enabled) {
                if (crossDir === 'in') this.peopleEntered += 1;
                else this.peopleExited += 1;
                events.push({
                  request_id: crypto.randomUUID(),
                  camera: cameraId,
                  source,
                  category: 'line_crossing',
                  object_class: 'person',
                  direction: crossDir,
                  count: 1,
                  zone: zone.id,
                  confidence: Number(det.score.toFixed(3)),
                  occurred_at: nowIso,
                  payload: {
                    zone_name: zone.name,
                    track_id: bestTrack.trackId,
                    summary: `Person crossed ${zone.name} (${crossDir})`,
                  },
                });
              } else if (VEHICLE_CLASSES.has(cls) && caps.vehicle_counting?.enabled) {
                if (crossDir === 'in') this.vehiclesEntered += 1;
                else this.vehiclesExited += 1;
                events.push({
                  request_id: crypto.randomUUID(),
                  camera: cameraId,
                  source,
                  category: 'line_crossing',
                  object_class: cls,
                  direction: crossDir,
                  count: 1,
                  zone: zone.id,
                  confidence: Number(det.score.toFixed(3)),
                  occurred_at: nowIso,
                  payload: {
                    zone_name: zone.name,
                    track_id: bestTrack.trackId,
                    summary: `${cls} crossed ${zone.name} (${crossDir})`,
                  },
                });
              }
            }
          }
        }

        matchedTrackIds.add(bestTrack.trackId);
        activeTracks.push(bestTrack);
      } else {
        const created: TrackedEntity = {
          trackId: this.nextTrackId++,
          objectClass: cls,
          score: det.score,
          bbox: det.bbox,
          normBox,
          centroid,
          firstSeenMs: nowMs,
          lastSeenMs: nowMs,
          anchorCentroid: centroid,
          anchorSinceMs: nowMs,
          dwellSeconds: 0,
          stationarySeconds: 0,
          direction: 'Stationary',
          crossedZones: new Set(),
          alertedKinds: new Set(),
        };
        this.tracks.set(created.trackId, created);
        matchedTrackIds.add(created.trackId);
        activeTracks.push(created);
      }
    }

    // Prune stale tracks older than 4 seconds
    for (const [id, t] of this.tracks.entries()) {
      if (nowMs - t.lastSeenMs > 4000) {
        this.tracks.delete(id);
      }
    }

    const personTracks = activeTracks.filter((t) => t.objectClass === 'person');
    const vehicleTracks = activeTracks.filter((t) => VEHICLE_CLASSES.has(t.objectClass));
    const itemTracks = activeTracks.filter((t) => ABANDONED_ITEM_CLASSES.has(t.objectClass));

    const vehicleByType: Record<string, number> = {
      car: 0,
      motorcycle: 0,
      bus: 0,
      truck: 0,
      bicycle: 0,
    };
    for (const v of vehicleTracks) {
      vehicleByType[v.objectClass] = (vehicleByType[v.objectClass] || 0) + 1;
    }

    // Compute per-zone occupancy & rules
    const zoneOccupancy: FrameIntelligenceSummary['zoneOccupancy'] = {};
    for (const zone of settings.zones) {
      if (zone.kind === 'count_line') continue;
      let peopleInZone = 0;
      let vehiclesInZone = 0;

      for (const p of personTracks) {
        if (pointInPolygon(p.centroid, zone.points)) {
          peopleInZone += 1;
          if (withinSchedule && zone.kind === 'restricted' && caps.intrusion?.enabled) {
            const alertKey = `intrusion:${zone.id}:${p.trackId}`;
            if (!p.alertedKinds.has(alertKey) && this.canEmitKey(`intrusion:${zone.id}`, nowMs, cooldownMs)) {
              p.alertedKinds.add(alertKey);
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'intrusion',
                object_class: 'person',
                count: 1,
                zone: zone.id,
                confidence: Number(p.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  zone_name: zone.name,
                  track_id: p.trackId,
                  summary: `Person entered restricted zone "${zone.name}"`,
                },
              });
            }
          }
          if (withinSchedule && zone.kind === 'perimeter' && caps.perimeter?.enabled) {
            const alertKey = `perimeter:${zone.id}:${p.trackId}`;
            if (!p.alertedKinds.has(alertKey) && this.canEmitKey(`perimeter:${zone.id}`, nowMs, cooldownMs)) {
              p.alertedKinds.add(alertKey);
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'perimeter_breach',
                object_class: 'person',
                count: 1,
                zone: zone.id,
                confidence: Number(p.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  zone_name: zone.name,
                  track_id: p.trackId,
                  summary: `Perimeter breach in "${zone.name}" (person)`,
                },
              });
            }
          }
        }
      }

      for (const v of vehicleTracks) {
        if (pointInPolygon(v.centroid, zone.points)) {
          vehiclesInZone += 1;
          if (withinSchedule && zone.kind === 'restricted' && caps.intrusion?.enabled) {
            const alertKey = `intrusion:${zone.id}:${v.trackId}`;
            if (!v.alertedKinds.has(alertKey) && this.canEmitKey(`intrusion:${zone.id}`, nowMs, cooldownMs)) {
              v.alertedKinds.add(alertKey);
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'intrusion',
                object_class: v.objectClass,
                count: 1,
                zone: zone.id,
                confidence: Number(v.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  zone_name: zone.name,
                  track_id: v.trackId,
                  summary: `${v.objectClass} entered restricted zone "${zone.name}"`,
                },
              });
            }
          }
          if (withinSchedule && zone.kind === 'perimeter' && caps.perimeter?.enabled) {
            const alertKey = `perimeter:${zone.id}:${v.trackId}`;
            if (!v.alertedKinds.has(alertKey) && this.canEmitKey(`perimeter:${zone.id}`, nowMs, cooldownMs)) {
              v.alertedKinds.add(alertKey);
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'perimeter_breach',
                object_class: v.objectClass,
                count: 1,
                zone: zone.id,
                confidence: Number(v.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  zone_name: zone.name,
                  track_id: v.trackId,
                  summary: `Perimeter breach in "${zone.name}" (${v.objectClass})`,
                },
              });
            }
          }
        }
      }

      zoneOccupancy[zone.id] = {
        name: zone.name,
        kind: zone.kind,
        people: peopleInZone,
        vehicles: vehiclesInZone,
      };
    }

    if (withinSchedule) {
      // Crowd / Overcrowding detection
      if (caps.crowd?.enabled && personTracks.length >= settings.thresholds.crowd_max) {
        if (this.canEmitKey('crowd:frame', nowMs, cooldownMs)) {
          events.push({
            request_id: crypto.randomUUID(),
            camera: cameraId,
            source,
            category: 'crowd',
            object_class: 'person',
            count: personTracks.length,
            occurred_at: nowIso,
            needsSnapshot: true,
            payload: {
              threshold: settings.thresholds.crowd_max,
              summary: `${personTracks.length} people detected (limit: ${settings.thresholds.crowd_max})`,
            },
          });
        }
      }

      // Area occupancy threshold check (counts against crowd/overcrowding if occupancy_max exceeded)
      if (caps.occupancy?.enabled && personTracks.length >= settings.thresholds.occupancy_max) {
        if (this.canEmitKey('occupancy_limit:frame', nowMs, cooldownMs)) {
          events.push({
            request_id: crypto.randomUUID(),
            camera: cameraId,
            source,
            category: 'crowd',
            object_class: 'person',
            count: personTracks.length,
            zone: 'full_frame',
            occurred_at: nowIso,
            needsSnapshot: true,
            payload: {
              threshold: settings.thresholds.occupancy_max,
              summary: `Occupancy ${personTracks.length} exceeded capacity (${settings.thresholds.occupancy_max})`,
            },
          });
        }
      }

      // Loitering detection
      if (caps.loitering?.enabled) {
        for (const p of personTracks) {
          if (p.stationarySeconds >= settings.thresholds.loiter_seconds && !p.alertedKinds.has('loitering')) {
            if (this.canEmitKey(`loitering:${p.trackId}`, nowMs, cooldownMs)) {
              p.alertedKinds.add('loitering');
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'loitering',
                object_class: 'person',
                count: 1,
                confidence: Number(p.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  track_id: p.trackId,
                  dwell_seconds: Math.round(p.stationarySeconds),
                  summary: `Person #${p.trackId} loitering for ${Math.round(p.stationarySeconds)}s`,
                },
              });
            }
          }
        }
      }

      // Stationary / parked vehicle detection
      if (caps.vehicle_stationary?.enabled) {
        for (const v of vehicleTracks) {
          if (v.stationarySeconds >= settings.thresholds.stationary_seconds && !v.alertedKinds.has('stationary_vehicle')) {
            if (this.canEmitKey(`stationary_vehicle:${v.trackId}`, nowMs, cooldownMs)) {
              v.alertedKinds.add('stationary_vehicle');
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'stationary_vehicle',
                object_class: v.objectClass,
                count: 1,
                confidence: Number(v.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  track_id: v.trackId,
                  stationary_seconds: Math.round(v.stationarySeconds),
                  summary: `${v.objectClass} #${v.trackId} stationary for ${Math.round(v.stationarySeconds)}s`,
                },
              });
            }
          }
        }
      }

      // Abandoned / unattended object detection
      if (caps.abandoned_object?.enabled) {
        for (const item of itemTracks) {
          const ownerNearby = personTracks.some((p) => distance2D(p.centroid, item.centroid) <= 0.18);
          if (ownerNearby) {
            item.anchorSinceMs = nowMs;
            item.stationarySeconds = 0;
          } else if (
            item.stationarySeconds >= settings.thresholds.abandoned_seconds &&
            !item.alertedKinds.has('abandoned_object')
          ) {
            if (this.canEmitKey(`abandoned_object:${item.trackId}`, nowMs, cooldownMs)) {
              item.alertedKinds.add('abandoned_object');
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'abandoned_object',
                object_class: item.objectClass,
                count: 1,
                confidence: Number(item.score.toFixed(3)),
                occurred_at: nowIso,
                needsSnapshot: true,
                payload: {
                  track_id: item.trackId,
                  unattended_seconds: Math.round(item.stationarySeconds),
                  summary: `Unattended ${item.objectClass} for ${Math.round(item.stationarySeconds)}s`,
                },
              });
            }
          }
        }
      }

      // Periodic occupancy snapshot (every 15 seconds when occupancy or parking zones are active)
      if (nowMs - this.lastOccupancyMs >= 15000) {
        this.lastOccupancyMs = nowMs;
        if (caps.occupancy?.enabled) {
          const areaZones = settings.zones.filter((z) => z.kind === 'area');
          if (areaZones.length > 0) {
            for (const z of areaZones) {
              const occ = zoneOccupancy[z.id]?.people ?? 0;
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'occupancy',
                object_class: 'person',
                zone: z.id,
                count: occ,
                occurred_at: nowIso,
                payload: { zone_name: z.name, summary: `${occ} people in ${z.name}` },
              });
            }
          } else if (personTracks.length > 0) {
            events.push({
              request_id: crypto.randomUUID(),
              camera: cameraId,
              source,
              category: 'occupancy',
              object_class: 'person',
              zone: 'full_frame',
              count: personTracks.length,
              occurred_at: nowIso,
              payload: { zone_name: 'Full Frame', summary: `${personTracks.length} people in view` },
            });
          }
        }
        const parkingZones = settings.zones.filter((z) => z.kind === 'parking');
        if (caps.vehicle_counting?.enabled && parkingZones.length > 0) {
          for (const z of parkingZones) {
            const vOcc = zoneOccupancy[z.id]?.vehicles ?? 0;
            events.push({
              request_id: crypto.randomUUID(),
              camera: cameraId,
              source,
              category: 'occupancy',
              object_class: 'car',
              zone: z.id,
              count: vOcc,
              occurred_at: nowIso,
              payload: { zone_name: z.name, summary: `${vOcc} vehicles in parking zone ${z.name}` },
            });
          }
        }
      }

      // Periodic traffic/people census (every 20 seconds when detections exist)
      if (nowMs - this.lastCensusMs >= 20000) {
        this.lastCensusMs = nowMs;
        if ((caps.people_detection?.enabled || caps.people_counting?.enabled) && personTracks.length > 0) {
          events.push({
            request_id: crypto.randomUUID(),
            camera: cameraId,
            source,
            category: 'census',
            object_class: 'person',
            count: personTracks.length,
            occurred_at: nowIso,
            payload: {
              entered: this.peopleEntered,
              exited: this.peopleExited,
              summary: `${personTracks.length} people active`,
            },
          });
        }
        if (caps.vehicle_detection?.enabled || caps.vehicle_counting?.enabled) {
          for (const [vClass, cnt] of Object.entries(vehicleByType)) {
            if (cnt > 0) {
              events.push({
                request_id: crypto.randomUUID(),
                camera: cameraId,
                source,
                category: 'census',
                object_class: vClass,
                count: cnt,
                occurred_at: nowIso,
                payload: {
                  entered: this.vehiclesEntered,
                  exited: this.vehiclesExited,
                  summary: `${cnt} ${vClass} active`,
                },
              });
            }
          }
        }
      }
    }

    // Camera Tamper check
    let tampered = false;
    let tamperReason: string | null = null;
    if (caps.tamper?.enabled && tamperCheck) {
      this.prevTamperSignature = tamperCheck.signature;
      if (tamperCheck.tampered) {
        this.consecutiveTamperFrames += 1;
        tampered = true;
        tamperReason = tamperCheck.reason;
        if (withinSchedule && this.consecutiveTamperFrames >= 2 && this.canEmitKey('tamper:camera', nowMs, cooldownMs)) {
          events.push({
            request_id: crypto.randomUUID(),
            camera: cameraId,
            source,
            category: 'tamper',
            count: 1,
            occurred_at: nowIso,
            needsSnapshot: true,
            payload: {
              reason: tamperCheck.reason,
              summary: tamperCheck.reason || 'Camera tampering or lens obstruction detected',
            },
          });
        }
      } else {
        this.consecutiveTamperFrames = 0;
      }
    }

    return {
      summary: {
        withinSchedule,
        peopleCurrent: personTracks.length,
        peopleEntered: this.peopleEntered,
        peopleExited: this.peopleExited,
        vehiclesCurrent: vehicleTracks.length,
        vehiclesEntered: this.vehiclesEntered,
        vehiclesExited: this.vehiclesExited,
        vehicleByType,
        zoneOccupancy,
        activeTracks,
        tampered,
        tamperReason,
      },
      events,
    };
  }

  getPreviousTamperSignature(): number[] | null {
    return this.prevTamperSignature;
  }
}

export interface VehicleRegistryRowInput {
  plate: string;
  make: string;
  model: string;
  colour: string;
  vehicle_type: string;
  year: string;
  registration_status: string;
  notes: string;
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}

export interface WatchlistImportRowInput {
  plate: string;
  category: string;
  custom_category: string;
  case_reference: string;
  make: string;
  model: string;
  colour: string;
  description: string;
  notes: string;
  status: string;
  photo_filename: string;
}

export interface SubjectMigrationRowInput {
  subject_code: string;
  full_name: string;
  aliases: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  category: string;
  threat_level: string;
  offense_summary: string;
  warrant_reference: string;
  case_reference: string;
  national_id: string;
  last_known_location: string;
  physical_marks: string;
  notes: string;
  status: string;
  minimum_clearance: string;
  photo_filename: string;
}

async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read uploaded file text.'));
      reader.readAsText(file);
    });
  }
  return new Response(file).text();
}

async function readTableFromUpload(file: File): Promise<string[][]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = await readSheet(file);
    return rows.map((r) => r.map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())));
  }
  const text = await readFileAsText(file);
  return parseCsvRows(text);
}

function buildColumnLookup(table: string[][], headerHints: string[]) {
  const headerRaw = table[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasHeader = headerRaw.some((h) => headerHints.includes(h));
  const col = (aliases: string[], fallbackIndex: number): number => {
    if (!hasHeader) return fallbackIndex;
    return headerRaw.findIndex((h) => aliases.includes(h));
  };
  const dataRows = hasHeader ? table.slice(1) : table;
  const pick = (r: string[], idx: number) => (idx >= 0 && idx < r.length ? String(r[idx] ?? '').trim() : '');
  return { col, dataRows, pick };
}

function mapRawTableToRegistryEntries(table: string[][]): VehicleRegistryRowInput[] {
  if (table.length === 0) return [];
  const { col, dataRows, pick } = buildColumnLookup(table, [
    'plate',
    'numberplate',
    'registration',
    'regno',
    'licensenumber',
    'make',
    'model',
  ]);
  const colPlate = col(['plate', 'numberplate', 'registration', 'regno', 'licensenumber', 'platenumber'], 0);
  const colMake = col(['make', 'brand', 'manufacturer'], 1);
  const colModel = col(['model', 'trim'], 2);
  const colColour = col(['colour', 'color', 'paint'], 3);
  const colType = col(['vehicletype', 'type', 'category', 'bodytype'], 4);
  const colYear = col(['year', 'vehicleyear', 'manufactureyear', 'modelyear'], 5);
  const colStatus = col(['registrationstatus', 'status', 'regstatus'], 6);
  const colNotes = col(['notes', 'note', 'remarks', 'description', 'comment'], 7);

  return dataRows
    .map((r) => ({
      plate: pick(r, colPlate),
      make: pick(r, colMake),
      model: pick(r, colModel),
      colour: pick(r, colColour),
      vehicle_type: pick(r, colType),
      year: pick(r, colYear),
      registration_status: (pick(r, colStatus) || 'registered').toLowerCase(),
      notes: pick(r, colNotes),
    }))
    .filter((entry) => entry.plate.length > 0 || entry.make.length > 0 || entry.model.length > 0);
}

export async function parseVehicleImportFile(file: File): Promise<VehicleRegistryRowInput[]> {
  return mapRawTableToRegistryEntries(await readTableFromUpload(file));
}

export async function parseWatchlistImportFile(file: File): Promise<WatchlistImportRowInput[]> {
  const table = await readTableFromUpload(file);
  if (table.length === 0) return [];
  const { col, dataRows, pick } = buildColumnLookup(table, [
    'plate',
    'numberplate',
    'registration',
    'category',
    'reason',
    'casereference',
  ]);
  const colPlate = col(['plate', 'numberplate', 'registration', 'regno', 'platenumber'], 0);
  const colCategory = col(['category', 'reason', 'type', 'flag'], 1);
  const colCase = col(['casereference', 'case', 'caseno', 'reference', 'ref'], 2);
  const colMake = col(['make', 'brand'], 3);
  const colModel = col(['model', 'trim'], 4);
  const colColour = col(['colour', 'color'], 5);
  const colStatus = col(['status', 'watchliststatus'], 6);
  const colDesc = col(['description', 'incidentdescription', 'details', 'offense'], 7);
  const colNotes = col(['notes', 'note', 'investigationnotes'], 8);
  const colCustom = col(['customcategory', 'othercategory'], -1);
  const colPhoto = col(['photofilename', 'photo', 'image', 'filename', 'imagefile'], 9);

  return dataRows
    .map((r) => ({
      plate: pick(r, colPlate),
      category: (pick(r, colCategory) || 'stolen').toLowerCase(),
      custom_category: pick(r, colCustom),
      case_reference: pick(r, colCase) || 'MIGRATED',
      make: pick(r, colMake),
      model: pick(r, colModel),
      colour: pick(r, colColour),
      description: pick(r, colDesc),
      notes: pick(r, colNotes),
      status: (pick(r, colStatus) || 'active').toLowerCase(),
      photo_filename: pick(r, colPhoto),
    }))
    .filter((entry) => entry.plate.length > 0);
}

export async function parseSubjectMigrationFile(file: File): Promise<SubjectMigrationRowInput[]> {
  const table = await readTableFromUpload(file);
  if (table.length === 0) return [];
  const { col, dataRows, pick } = buildColumnLookup(table, [
    'fullname',
    'name',
    'subjectcode',
    'subjectid',
    'offensesummary',
    'offense',
    'crime',
    'warrantreference',
    'casereference',
  ]);
  const colCode = col(['subjectcode', 'subjectid', 'code', 'bookingid', 'inmateid', 'id'], 0);
  const colName = col(['fullname', 'name', 'subjectname', 'person'], 1);
  const colAliases = col(['aliases', 'alias', 'aka'], 2);
  const colCategory = col(['category', 'classification', 'type'], 3);
  const colThreat = col(['threatlevel', 'threat', 'priority', 'risk'], 4);
  const colOffense = col(['offensesummary', 'offense', 'crime', 'charges', 'charge'], 5);
  const colWarrant = col(['warrantreference', 'warrant', 'warrantno'], 6);
  const colCase = col(['casereference', 'case', 'caseno', 'reference'], 7);
  const colNin = col(['nationalid', 'nin', 'passport', 'idnumber'], 8);
  const colDob = col(['dateofbirth', 'dob', 'birthdate'], 9);
  const colGender = col(['gender', 'sex'], 10);
  const colNationality = col(['nationality', 'country', 'citizenship'], 11);
  const colLocation = col(['lastknownlocation', 'location', 'address', 'lastseen'], 12);
  const colMarks = col(['physicalmarks', 'marks', 'scars', 'distinguishingmarks'], 13);
  const colStatus = col(['status', 'dossierstatus'], 14);
  const colClearance = col(['minimumclearance', 'clearance'], -1);
  const colNotes = col(['notes', 'remarks', 'details'], 15);
  const colPhoto = col(['photofilename', 'photo', 'mugshot', 'filename', 'image', 'imagefile'], 16);

  return dataRows
    .map((r) => ({
      subject_code: pick(r, colCode),
      full_name: pick(r, colName),
      aliases: pick(r, colAliases),
      date_of_birth: pick(r, colDob),
      gender: pick(r, colGender),
      nationality: pick(r, colNationality),
      category: (pick(r, colCategory) || 'suspect').toLowerCase(),
      threat_level: (pick(r, colThreat) || 'medium').toLowerCase(),
      offense_summary: pick(r, colOffense),
      warrant_reference: pick(r, colWarrant),
      case_reference: pick(r, colCase),
      national_id: pick(r, colNin),
      last_known_location: pick(r, colLocation),
      physical_marks: pick(r, colMarks),
      notes: pick(r, colNotes),
      status: (pick(r, colStatus) || 'active').toLowerCase(),
      minimum_clearance: pick(r, colClearance) || '0',
      photo_filename: pick(r, colPhoto),
    }))
    .filter((entry) => entry.full_name.length > 0 || entry.subject_code.length > 0);
}

/**
 * Enhances cropped license-plate region via upscaling, grayscale luminance extraction,
 * and adaptive min-max contrast stretch to substantially improve OCR readability.
 */
export function preprocessPlateCanvas(
  sourceCanvas: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const sx = Math.max(0, Math.round(region.x * sourceCanvas.width));
  const sy = Math.max(0, Math.round(region.y * sourceCanvas.height));
  const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.round(region.width * sourceCanvas.width)));
  const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.round(region.height * sourceCanvas.height)));

  const targetWidth = Math.max(440, Math.min(960, sw * 2));
  const targetHeight = Math.max(110, Math.round((sh * targetWidth) / sw));

  const out = document.createElement('canvas');
  out.width = targetWidth;
  out.height = targetHeight;
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

  try {
    const img = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = img.data;
    let minLuma = 255;
    let maxLuma = 0;
    const lumas = new Uint8Array(targetWidth * targetHeight);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      lumas[p] = l;
      if (l < minLuma) minLuma = l;
      if (l > maxLuma) maxLuma = l;
    }

    const range = Math.max(24, maxLuma - minLuma);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const stretched = Math.min(255, Math.max(0, Math.round(((lumas[p] - minLuma) * 255) / range)));
      // Mild S-curve emphasis around midtones to separate plate characters cleanly
      const enhanced = stretched < 110 ? Math.max(0, Math.round(stretched * 0.72)) : Math.min(255, Math.round(128 + (stretched - 110) * 1.15));
      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
    }
    ctx.putImageData(img, 0, 0);
  } catch {
    // Graceful fallback if getImageData is restricted
  }
  return out;
}

/**
 * Multi-frame temporal consensus voting buffer for ANPR reads to eliminate
 * single-frame OCR character noise and boost plate stability.
 */
export class PlateConsensusBuffer {
  private windowMs: number;
  private buffer: { plate: string; confidence: number; ts: number }[] = [];

  constructor(windowMs = 4500) {
    this.windowMs = windowMs;
  }

  push(
    rawText: string,
    confidence: number,
    nowMs = Date.now(),
  ): { confirmed: string | null; bestConfidence: number; votes: number } {
    const plate = normalizePlate(rawText);
    if (!isValidNormalizedPlate(plate) || plate.length < 4 || confidence < 45) {
      return { confirmed: null, bestConfidence: confidence, votes: 0 };
    }
    this.buffer = this.buffer.filter((item) => nowMs - item.ts <= this.windowMs);
    this.buffer.push({ plate, confidence, ts: nowMs });

    const matching = this.buffer.filter((b) => b.plate === plate);
    const votes = matching.length;
    const bestConfidence = Math.max(...matching.map((m) => m.confidence));

    // Either a single very sharp read (>=78% & >=5 chars) or 2+ corroborating reads inside window
    if ((bestConfidence >= 78 && plate.length >= 5) || votes >= 2) {
      return { confirmed: plate, bestConfidence, votes };
    }
    return { confirmed: null, bestConfidence, votes };
  }

  reset(): void {
    this.buffer = [];
  }
}

export function triggerCsvDownload(headers: string[], rows: unknown[][], filename: string): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

