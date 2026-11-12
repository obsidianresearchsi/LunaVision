import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import { supabase } from './supabase';
import { compressImage } from '../utils/imageCompression';
import { dispatchOperationalAlert } from './liveAlertBus';
import {
  VEHICLE_CLASSES,
  WEAPON_CLASSES,
  isValidNormalizedPlate,
  normalizePlate,
  preprocessPlateCanvas,
} from './videoIntelligence';

export type VehicleReportIntent =
  | 'auto_check'
  | 'suspected_stolen'
  | 'damaged_accident'
  | 'abandoned_suspicious'
  | 'wanted_escape';

export interface VehicleRecognitionMatch {
  id: string;
  plate: string;
  reason: string;
  case_reference: string;
  make: string;
  model: string;
  colour: string;
  description: string;
  status: string;
  photo_path?: string | null;
}

export interface VehicleRecognitionResult {
  previewDataUrl: string;
  vehicleDetected: boolean;
  vehicleClass: string;
  vehicleConfidence: number;
  dominantColor: string;
  extractedPlate: string | null;
  ocrConfidence: number;
  weaponsDetected: { label: string; score: number }[];
  detectedObjects: { label: string; score: number }[];
  statusVerdict: 'stolen_or_wanted' | 'watchlist_interest' | 'weapon_threat' | 'unregistered_or_expired' | 'suspicious_flag' | 'cleared';
  watchlistMatch: VehicleRecognitionMatch | null;
  attributeCandidates: VehicleRecognitionMatch[];
  registryMatch: {
    plate: string;
    make: string;
    model: string;
    colour: string;
    vehicle_type: string;
    registration_status: string;
  } | null;
  summary: string;
  recommendedAction: string;
}

type DetectorFn = (canvas: HTMLCanvasElement) => Promise<{ class: string; score: number; bbox: [number, number, number, number] }[]>;
let sharedImageDetector: Promise<DetectorFn> | undefined;

async function getSharedImageDetector(): Promise<DetectorFn> {
  sharedImageDetector ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    await tf.ready();
    const { load } = await import('@tensorflow-models/coco-ssd');
    const options = { base: 'lite_mobilenet_v2', modelUrl: '/models/coco-ssd-lite/model.json' } as const;
    let model;
    try {
      model = await load(options);
    } catch (error) {
      if (tf.getBackend() === 'cpu') throw error;
      await tf.setBackend('cpu');
      model = await load(options);
    }
    return async (canvas: HTMLCanvasElement) => model.detect(canvas, 20, 0.35);
  })().catch((err) => {
    sharedImageDetector = undefined;
    throw err;
  });
  return sharedImageDetector;
}

export function classifyDominantVehicleColor(
  ctx: CanvasRenderingContext2D,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): string {
  const [bx, by, bw, bh] = bbox;
  const rx = Math.max(0, Math.round(bx + bw * 0.2));
  const ry = Math.max(0, Math.round(by + bh * 0.25));
  const rw = Math.max(4, Math.min(width - rx, Math.round(bw * 0.6)));
  const rh = Math.max(4, Math.min(height - ry, Math.round(bh * 0.45)));

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(rx, ry, rw, rh).data;
  } catch {
    return 'Unknown colour';
  }

  const buckets = new Map<string, number>();
  for (let i = 0; i < pixels.length; i += 16) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

    let label = 'Silver / Grey';
    if (l < 0.19) label = 'Black';
    else if (l > 0.78 && s < 0.25) label = 'White';
    else if (s < 0.16) label = 'Silver / Grey';
    else {
      let h = 0;
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      else if (max === gn) h = ((bn - rn) / d + 2) * 60;
      else h = ((rn - gn) / d + 4) * 60;

      if (h < 18 || h >= 340) label = 'Red';
      else if (h < 45) label = l < 0.42 ? 'Brown' : 'Orange / Gold';
      else if (h < 70) label = 'Yellow / Gold';
      else if (h < 165) label = 'Green';
      else if (h < 255) label = 'Blue';
      else label = 'Burgundy / Violet';
    }
    buckets.set(label, (buckets.get(label) || 0) + 1);
  }

  let best = 'Silver / Grey';
  let bestCount = -1;
  for (const [k, v] of buckets.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

async function runPlateOcrOnVehicle(
  canvas: HTMLCanvasElement,
  vehicleBbox: [number, number, number, number] | null,
): Promise<{ plate: string | null; confidence: number }> {
  try {
    const region = vehicleBbox
      ? {
          x: Math.max(0, vehicleBbox[0] / canvas.width),
          y: Math.max(0, (vehicleBbox[1] + vehicleBbox[3] * 0.35) / canvas.height),
          width: Math.min(1, vehicleBbox[2] / canvas.width),
          height: Math.min(1, (vehicleBbox[3] * 0.65) / canvas.height),
        }
      : { x: 0.05, y: 0.25, width: 0.9, height: 0.65 };

    const processed = preprocessPlateCanvas(canvas, region);
    const { createWorker, PSM } = await import('tesseract.js');
    const worker = await createWorker('eng', 1, {
      workerPath: ocrWorkerUrl,
      corePath: ocrCoreUrl,
      langPath: new URL('/models/plate-ocr', location.origin).href,
      gzip: false,
      workerBlobURL: false,
      cacheMethod: 'none',
    });
    try {
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      const { data } = await worker.recognize(processed.toDataURL('image/png'));
      const candidate = normalizePlate(data.text);
      if (isValidNormalizedPlate(candidate) && candidate.length >= 4) {
        return { plate: candidate, confidence: Math.round(data.confidence) };
      }
      return { plate: null, confidence: Math.round(data.confidence || 0) };
    } finally {
      await worker.terminate();
    }
  } catch {
    return { plate: null, confidence: 0 };
  }
}

export async function analyzeVehicleImage(
  file: File,
  opts: {
    workspaceId: string;
    intent?: VehicleReportIntent;
    manualPlateHint?: string;
    cameraName?: string;
  },
): Promise<VehicleRecognitionResult> {
  const compressed = await compressImage(file, 960, 0.88);
  const url = URL.createObjectURL(compressed);

  const canvas = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Vehicle image could not be decoded.'));
      el.src = url;
    });
    canvas.width = Math.max(1, img.naturalWidth);
    canvas.height = Math.max(1, img.naturalHeight);
    ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const previewDataUrl = canvas.toDataURL('image/jpeg', 0.82);

  let rawDetections: { class: string; score: number; bbox: [number, number, number, number] }[] = [];
  try {
    const detect = await getSharedImageDetector();
    rawDetections = await detect(canvas);
  } catch {
    // Graceful fallback if local TF model cannot load in restricted environments
  }

  const vehicles = rawDetections.filter((d) => VEHICLE_CLASSES.has(d.class.toLowerCase()));
  const primaryVehicle = vehicles[0] || null;
  const weapons = rawDetections
    .filter((d) => WEAPON_CLASSES.has(d.class.toLowerCase()))
    .map((d) => ({ label: d.class.toLowerCase(), score: d.score }));

  const dominantColor =
    ctx && primaryVehicle
      ? classifyDominantVehicleColor(ctx, primaryVehicle.bbox, canvas.width, canvas.height)
      : ctx
        ? classifyDominantVehicleColor(ctx, [0, 0, canvas.width, canvas.height], canvas.width, canvas.height)
        : 'Unknown colour';

  const manualHint = normalizePlate(opts.manualPlateHint || '');
  const ocr = await runPlateOcrOnVehicle(canvas, primaryVehicle?.bbox || null);
  const resolvedPlate =
    isValidNormalizedPlate(manualHint) && manualHint.length >= 2
      ? manualHint
      : ocr.plate;

  let watchlistMatch: VehicleRecognitionMatch | null = null;
  let registryMatch: VehicleRecognitionResult['registryMatch'] = null;
  let attributeCandidates: VehicleRecognitionMatch[] = [];

  if (resolvedPlate) {
    const [wlRes, regRes] = await Promise.all([
      supabase
        .from('lv_vehicle_watchlist')
        .select('id,plate,reason,case_reference,make,model,colour,description,status,photo_path')
        .eq('workspace_id', opts.workspaceId)
        .eq('plate', resolvedPlate)
        .is('retired_at', null)
        .maybeSingle(),
      supabase
        .from('lv_vehicle_registry')
        .select('plate,make,model,colour,vehicle_type,registration_status')
        .eq('workspace_id', opts.workspaceId)
        .eq('plate', resolvedPlate)
        .maybeSingle(),
    ]);
    if (wlRes.data) watchlistMatch = wlRes.data as VehicleRecognitionMatch;
    if (regRes.data) registryMatch = regRes.data as VehicleRecognitionResult['registryMatch'];
  }

  // Fallback color match against active stolen/wanted vehicles when plate isn't matched cleanly
  if (!watchlistMatch && dominantColor && dominantColor !== 'Unknown colour') {
    const baseColorWord = dominantColor.split(/[\s/]+/)[0];
    const { data: candRows } = await supabase
      .from('lv_vehicle_watchlist')
      .select('id,plate,reason,case_reference,make,model,colour,description,status,photo_path')
      .eq('workspace_id', opts.workspaceId)
      .eq('status', 'active')
      .is('retired_at', null)
      .ilike('colour', `%${baseColorWord}%`)
      .limit(5);
    if (Array.isArray(candRows)) attributeCandidates = candRows as VehicleRecognitionMatch[];
  }

  const intent = opts.intent || 'auto_check';
  const vehicleClass = primaryVehicle ? primaryVehicle.class.toLowerCase() : 'vehicle';
  const vehicleConfidence = primaryVehicle ? Math.round(primaryVehicle.score * 100) : 0;

  let statusVerdict: VehicleRecognitionResult['statusVerdict'] = 'cleared';
  let summary = '';
  let recommendedAction = 'No active watchlist or weapon flags detected. Log check or archive snapshot.';

  if (weapons.length > 0) {
    statusVerdict = 'weapon_threat';
    summary = `WEAPON ALERT in vehicle photo: ${weapons.map((w) => `${w.label} (${Math.round(w.score * 100)}%)`).join(', ')}. Vehicle: ${dominantColor} ${vehicleClass}.`;
    recommendedAction = 'Treat occupants as armed; alert tactical unit before approach.';
  } else if (watchlistMatch && (watchlistMatch.reason === 'stolen' || watchlistMatch.reason === 'wanted')) {
    statusVerdict = 'stolen_or_wanted';
    summary = `MATCHED ${watchlistMatch.reason.toUpperCase()} VEHICLE: Plate ${watchlistMatch.plate} · ${[watchlistMatch.colour, watchlistMatch.make, watchlistMatch.model].filter(Boolean).join(' ') || `${dominantColor} ${vehicleClass}`} (Case ${watchlistMatch.case_reference}).`;
    recommendedAction = 'Dispatch patrol intercept, preserve photograph evidence, and log ANPR watchlist sighting.';
  } else if (watchlistMatch && watchlistMatch.reason !== 'authorized') {
    statusVerdict = 'watchlist_interest';
    summary = `WATCHLIST HIT (${watchlistMatch.reason}): Plate ${watchlistMatch.plate} · Case ${watchlistMatch.case_reference}.`;
    recommendedAction = 'Verify vehicle details against dossier and alert assigned investigator.';
  } else if (registryMatch && (registryMatch.registration_status === 'expired' || registryMatch.registration_status === 'unregistered')) {
    statusVerdict = 'unregistered_or_expired';
    summary = `Plate ${resolvedPlate} is ${registryMatch.registration_status.toUpperCase()} in registry (${[registryMatch.colour, registryMatch.make, registryMatch.model].filter(Boolean).join(' ')}).`;
    recommendedAction = 'Issue traffic/registration verification notice or inspect chassis number.';
  } else if (intent !== 'auto_check') {
    statusVerdict = 'suspicious_flag';
    const intentLabel = {
      suspected_stolen: 'Suspected stolen vehicle',
      damaged_accident: 'Damaged / collision vehicle',
      abandoned_suspicious: 'Abandoned / suspicious vehicle',
      wanted_escape: 'Suspect getaway / wanted vehicle',
      auto_check: 'Inspection',
    }[intent];
    summary = `${intentLabel} recognized: ${dominantColor} ${vehicleClass}${vehicleConfidence ? ` (${vehicleConfidence}% confidence)` : ''}${resolvedPlate ? ` · Plate ${resolvedPlate}` : ''}.`;
    recommendedAction = attributeCandidates.length > 0
      ? `Compare against ${attributeCandidates.length} active ${dominantColor} watchlist record(s) or enroll plate into Watchlist.`
      : 'Enroll plate/photo into Vehicle Watchlist or open an Investigation in Incidents.';
  } else {
    summary = `${primaryVehicle ? `Recognized ${dominantColor} ${vehicleClass} (${vehicleConfidence}% confidence)` : `Vehicle image analyzed (${dominantColor})`}${resolvedPlate ? ` · Plate ${resolvedPlate}` : ' · No legible plate extracted'}.`;
  }

  // Trigger real-time popup + persistent alert for high-risk or manually flagged vehicle incidents
  if (
    statusVerdict === 'stolen_or_wanted' ||
    statusVerdict === 'watchlist_interest' ||
    statusVerdict === 'weapon_threat' ||
    statusVerdict === 'suspicious_flag'
  ) {
    await dispatchOperationalAlert({
      workspaceId: opts.workspaceId,
      kind: statusVerdict === 'weapon_threat' ? 'weapon' : statusVerdict === 'stolen_or_wanted' || statusVerdict === 'watchlist_interest' ? 'watchlist_match' : 'vehicle_recognition',
      title:
        statusVerdict === 'weapon_threat'
          ? `Weapon Spotted Near ${vehicleClass.toUpperCase()}`
          : watchlistMatch
            ? `Vehicle Watchlist Match: ${watchlistMatch.plate} (${watchlistMatch.reason})`
            : `Vehicle Recognition Flag: ${dominantColor} ${vehicleClass}`,
      details: summary,
      severity: statusVerdict === 'stolen_or_wanted' || statusVerdict === 'weapon_threat' ? 'high' : 'medium',
      cameraName: opts.cameraName || 'Vehicle Image Recognition',
      plate: resolvedPlate || undefined,
      confidence: vehicleConfidence || ocr.confidence || undefined,
      recommendedAction,
      snapshotUrl: previewDataUrl,
    });
  }

  return {
    previewDataUrl,
    vehicleDetected: Boolean(primaryVehicle),
    vehicleClass,
    vehicleConfidence,
    dominantColor,
    extractedPlate: resolvedPlate,
    ocrConfidence: ocr.confidence,
    weaponsDetected: weapons,
    detectedObjects: rawDetections.map((d) => ({ label: d.class.toLowerCase(), score: d.score })),
    statusVerdict,
    watchlistMatch,
    attributeCandidates,
    registryMatch,
    summary,
    recommendedAction,
  };
}

