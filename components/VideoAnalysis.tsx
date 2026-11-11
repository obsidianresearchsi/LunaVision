import React, { useEffect, useRef, useState } from 'react';
import { CameraStream } from './CameraStream';
import VideoViewport from './VideoViewport';
import type { DetectedObject } from '@tensorflow-models/coco-ssd';
import { PlateWatchlistCheck } from './VehicleWatchlist';
import { supabase } from '../services/supabase';
import {
  CameraIntelSettings,
  FrameIntelligenceSummary,
  PendingIntelEvent,
  PlateConsensusBuffer,
  VEHICLE_CLASSES,
  VideoIntelligenceTracker,
  analyzeFrameTamper,
  defaultCameraIntelSettings,
  isValidNormalizedPlate,
  normalizeCameraIntelSettings,
  normalizePlate,
  preprocessPlateCanvas,
} from '../services/videoIntelligence';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

const sampleCredit = 'https://commons.wikimedia.org/wiki/File:Street_traffic.webm';
const detectionFrameLimit = 320;

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
const samplePlateRegion: Box = { x: 0.13, y: 0.33, width: 0.73, height: 0.47 };

function selection(start: Point, end: Point): Box {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

async function loadDetector() {
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
  return async (frame: HTMLCanvasElement) => {
    try {
      return await model.detect(frame, 20, 0.42);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') throw error;
      if (tf.getBackend() === 'cpu') throw error;
      await tf.setBackend('cpu');
      return model.detect(frame, 20, 0.42);
    }
  };
}

let detector: ReturnType<typeof loadDetector> | undefined;

type ObservationTarget = { workspaceId: string; cameraId?: string; cameraName?: string; cameraLocation?: string };

interface WatchlistMatchAlert {
  event_id: string;
  plate: string;
  watchlist_id: string;
  category: string;
  label: string;
  reference: string;
  camera: string | null;
  alert_id: string | null;
  occurred_at: string;
  snapshotDataUrl?: string;
}

async function uploadEventSnapshot(workspaceId: string, canvas: HTMLCanvasElement): Promise<string | undefined> {
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob) return undefined;
    const path = `${workspaceId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`;
    const { error } = await supabase.storage.from('lv-intel-snapshots').upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) return undefined;
    return path;
  } catch {
    return undefined;
  }
}

function VideoViewer({
  src,
  samplePlate,
  isSampleClip,
  watchlistWorkspaceId,
  observation,
  intelSettings,
  onInspectEvent,
}: {
  src: string;
  samplePlate: boolean;
  isSampleClip: boolean;
  watchlistWorkspaceId?: string;
  observation?: ObservationTarget;
  intelSettings: CameraIntelSettings;
  onInspectEvent?: (eventId: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Point | null>(null);
  const mounted = useRef(false);
  const trackerRef = useRef<VideoIntelligenceTracker>(new VideoIntelligenceTracker());
  const settingsRef = useRef<CameraIntelSettings>(intelSettings);
  settingsRef.current = intelSettings;

  const [size, setSize] = useState({ width: 640, height: 360 });
  const [ready, setReady] = useState(false);
  const [detecting, setDetecting] = useState(!samplePlate);
  const [detections, setDetections] = useState<DetectedObject[]>([]);
  const [intelSummary, setIntelSummary] = useState<FrameIntelligenceSummary | null>(null);
  const [frameSeconds, setFrameSeconds] = useState(0);
  const [savingObservation, setSavingObservation] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [autoAnpr, setAutoAnpr] = useState(Boolean(watchlistWorkspaceId && intelSettings.capabilities.anpr?.enabled));
  const saveLock = useRef(false);
  const saveAction = useRef<() => void>(() => {});
  const lastAutoSave = useRef(0);
  const lastAutoAnprMs = useRef(0);
  const plateConsensusRef = useRef<PlateConsensusBuffer>(new PlateConsensusBuffer(5000));
  const lastRecordedPlateRef = useRef<{ plate: string; ms: number }>({ plate: '', ms: 0 });
  const [recentPlates, setRecentPlates] = useState<{ plate: string; confidence: number; ts: string; matched?: boolean }[]>([]);
  const lastSavedFrame = useRef<number | undefined>(undefined);
  const pendingSave = useRef<
    | {
        target: string;
        event_id: string;
        camera: string | null;
        frame_time: string;
        description: string;
        objects: { label: string; score: number }[];
      }
    | undefined
  >(undefined);
  const [observationNotice, setObservationNotice] = useState('');
  const [status, setStatus] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [crop, setCrop] = useState<Box | null>(null);
  const [reading, setReading] = useState(false);
  const [plate, setPlate] = useState<{ text: string; confidence: number } | null>(null);
  const [watchlistMatches, setWatchlistMatches] = useState<WatchlistMatchAlert[]>([]);
  const [eventsIngestedCount, setEventsIngestedCount] = useState(0);

  useEffect(() => {
    mounted.current = true;
    trackerRef.current.reset();
    plateConsensusRef.current.reset();
    setRecentPlates([]);
    return () => {
      mounted.current = false;
    };
  }, [src]);

  useEffect(() => {
    setAutoAnpr(Boolean(watchlistWorkspaceId && intelSettings.capabilities.anpr?.enabled));
  }, [watchlistWorkspaceId, intelSettings.capabilities.anpr?.enabled]);

  async function flushIntelEvents(batch: PendingIntelEvent[], frameCanvas?: HTMLCanvasElement) {
    if (!observation || isSampleClip || batch.length === 0) return;
    try {
      let sharedSnapshotPath: string | undefined;
      const needsSnap = batch.some((e) => e.needsSnapshot);
      if (needsSnap && frameCanvas) {
        sharedSnapshotPath = await uploadEventSnapshot(observation.workspaceId, frameCanvas);
      }
      const formatted = batch.map(({ needsSnapshot, ...rest }) => ({
        ...rest,
        ...(needsSnapshot && sharedSnapshotPath ? { snapshot_path: sharedSnapshotPath } : {}),
      }));
      const { data, error } = await supabase.rpc('lv_record_intel_events', {
        target: observation.workspaceId,
        events: formatted,
      });
      if (!error && data && mounted.current) {
        const saved = Number((data as any).saved || 0);
        if (saved > 0) setEventsIngestedCount((prev) => prev + saved);
        const matches = Array.isArray((data as any).matches) ? (data as any).matches : [];
        if (matches.length > 0) {
          const snapUrl = frameCanvas ? frameCanvas.toDataURL('image/jpeg', 0.75) : undefined;
          setWatchlistMatches((prev) => [
            ...matches.map((m: any) => ({
              ...m,
              occurred_at: new Date().toISOString(),
              snapshotDataUrl: snapUrl,
            })),
            ...prev.slice(0, 9),
          ]);
        }
      }
    } catch {
      // Non-fatal background telemetry error
    }
  }

  async function recordRecognizedPlate(
    rawText: string,
    confidencePct: number,
    sourceCanvas?: HTMLCanvasElement,
    objectClass = 'car',
  ) {
    const normalized = normalizePlate(rawText);
    if (!isValidNormalizedPlate(normalized)) return;
    const now = Date.now();
    if (
      lastRecordedPlateRef.current.plate === normalized &&
      now - lastRecordedPlateRef.current.ms < 15000
    ) {
      return;
    }
    lastRecordedPlateRef.current = { plate: normalized, ms: now };
    if (!observation || isSampleClip || !watchlistWorkspaceId) return;

    await flushIntelEvents(
      [
        {
          request_id: crypto.randomUUID(),
          camera: observation.cameraId ?? null,
          source: observation.cameraId ? 'camera' : 'file',
          category: 'plate_read',
          object_class: objectClass,
          plate: normalized,
          confidence: Number(Math.min(1, Math.max(0, confidencePct / 100)).toFixed(3)),
          occurred_at: new Date(now).toISOString(),
          needsSnapshot: true,
          payload: {
            camera_name: observation.cameraName || 'Camera stream',
            camera_location: observation.cameraLocation || '',
            summary: `Recognized plate ${normalized} (${Math.round(confidencePct)}% confidence)`,
          },
        },
      ],
      sourceCanvas,
    );
  }

  useEffect(() => {
    if (!detecting || frozen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastTime = -1;
    const frame = document.createElement('canvas');
    frame.width = size.width;
    frame.height = size.height;
    const context = frame.getContext('2d');

    setStatus('Loading object detection…');
    async function analyze() {
      let runDetection;
      try {
        detector ??= loadDetector().catch((error) => {
          detector = undefined;
          throw error;
        });
        runDetection = await detector;
      } catch {
        if (cancelled) return;
        setDetecting(false);
        setStatus('The object detection model could not start. Reload this page to get the latest app files, then retry.');
        return;
      }
      try {
        if (cancelled) return;
        const media = video.current;
        let delay = 200;
        if (media && media.readyState >= 2 && !media.seeking && media.currentTime !== lastTime && context) {
          const started = performance.now();
          lastTime = media.currentTime;
          context.drawImage(media, 0, 0, frame.width, frame.height);
          const objects = await runDetection(frame);
          if (cancelled) return;

          const currentSettings = settingsRef.current;
          const tamperResult = currentSettings.capabilities.tamper?.enabled
            ? analyzeFrameTamper(
                context,
                frame.width,
                frame.height,
                trackerRef.current.getPreviousTamperSignature(),
              )
            : undefined;

          const { summary, events } = trackerRef.current.processFrame({
            detections: objects.map((o) => ({
              class: o.class,
              score: o.score,
              bbox: o.bbox as [number, number, number, number],
            })),
            frameWidth: frame.width,
            frameHeight: frame.height,
            settings: currentSettings,
            cameraId: observation?.cameraId ?? null,
            source: observation?.cameraId ? 'camera' : 'file',
            tamperCheck: tamperResult,
          });

          setDetections(objects);
          setIntelSummary(summary);
          setFrameSeconds(lastTime);
          setStatus(
            summary.tampered
              ? `Warning: ${summary.tamperReason}`
              : objects.length
                ? ''
                : 'No objects detected in this frame.',
          );

          if (events.length > 0 && observation && !isSampleClip) {
            void flushIntelEvents(events, frame);
          }

          // Background Automatic ANPR on detected vehicles when enabled
          const nowMs = Date.now();
          if (
            autoAnpr &&
            watchlistWorkspaceId &&
            currentSettings.capabilities.anpr?.enabled &&
            nowMs - lastAutoAnprMs.current >= 6000
          ) {
            const vehicleObj = objects.find(
              (o) => VEHICLE_CLASSES.has(o.class.toLowerCase()) && o.bbox[2] >= 48 && o.bbox[3] >= 28,
            );
            if (vehicleObj) {
              lastAutoAnprMs.current = nowMs;
              const [vx, vy, vw, vh] = vehicleObj.bbox;
              // Focus on lower 65% of vehicle bounding box where number plates are mounted
              const region: Box = {
                x: Math.max(0, vx / frame.width),
                y: Math.max(0, (vy + vh * 0.35) / frame.height),
                width: Math.min(1, vw / frame.width),
                height: Math.min(1, (vh * 0.65) / frame.height),
              };
              void runBackgroundPlateOcr(frame, region, vehicleObj.class.toLowerCase());
            }
          }

          const elapsed = performance.now() - started;
          delay = Math.max(25, 120 - elapsed, elapsed / 4);
        }
        timer = setTimeout(analyze, delay);
      } catch (error) {
        if (cancelled) return;
        setDetecting(false);
        setStatus(
          error instanceof DOMException && error.name === 'SecurityError'
            ? 'This camera does not allow frame access. Enable cross-origin video access or choose a local file.'
            : 'Object detection could not process this frame. Try a different frame or local video.',
        );
      }
    }

    void analyze();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [detecting, frozen, size, autoAnpr, watchlistWorkspaceId, observation?.workspaceId, observation?.cameraId, isSampleClip]);

  async function runBackgroundPlateOcr(sourceCanvas: HTMLCanvasElement, region: Box, vehicleClass: string) {
    try {
      const width = Math.round(region.width * sourceCanvas.width);
      const height = Math.round(region.height * sourceCanvas.height);
      if (width < 20 || height < 10) return;
      const preprocessed = preprocessPlateCanvas(sourceCanvas, region);
      const image = preprocessed.toDataURL('image/png');
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
        const { data } = await worker.recognize(image);
        if (!mounted.current) return;
        const consensus = plateConsensusRef.current.push(data.text, data.confidence);
        if (consensus.confirmed) {
          setPlate({ text: consensus.confirmed, confidence: consensus.bestConfidence });
          setRecentPlates((prev) => [
            { plate: consensus.confirmed!, confidence: consensus.bestConfidence, ts: new Date().toLocaleTimeString() },
            ...prev.filter((p) => p.plate !== consensus.confirmed).slice(0, 7),
          ]);
          await recordRecognizedPlate(consensus.confirmed, consensus.bestConfidence, sourceCanvas, vehicleClass);
        }
      } finally {
        await worker.terminate();
      }
    } catch {
      // Ignore transient background OCR errors
    }
  }

  async function saveObservation() {
    if (!observation || saveLock.current || (!pendingSave.current && detections.length === 0)) return;
    saveLock.current = true;
    lastAutoSave.current = Date.now();
    setSavingObservation(true);
    setObservationNotice('');
    pendingSave.current ??= {
      target: observation.workspaceId,
      event_id: crypto.randomUUID(),
      camera: observation.cameraId ?? null,
      frame_time: frameSeconds.toFixed(2),
      description: detections.map((item) => item.class + ' ' + Math.round(item.score * 100) + '%').join(' · '),
      objects: detections.map((item) => ({ label: item.class, score: item.score })),
    };
    const pending = pendingSave.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const { error } = await supabase.rpc('lv_save_observation', pending).abortSignal(controller.signal);
      if (error) throw error;
      lastSavedFrame.current = Number(pending.frame_time);
      pendingSave.current = undefined;
      if (mounted.current) setObservationNotice('Observation saved. Find it in Workspace Overview.');
    } catch {
      if (mounted.current) {
        setAutoSave(false);
        setObservationNotice('Save could not be confirmed. Automatic saving paused. Retry the pending frame safely below.');
      }
    } finally {
      clearTimeout(timeout);
      saveLock.current = false;
      if (mounted.current) setSavingObservation(false);
    }
  }
  saveAction.current = () => {
    if (detections.length > 0 && frameSeconds !== lastSavedFrame.current) void saveObservation();
  };

  useEffect(() => {
    if (!autoSave || !observation || !detecting || frozen) return;
    const interval = setInterval(() => {
      if (!document.hidden && video.current && !video.current.paused && Date.now() - lastAutoSave.current >= 15000)
        saveAction.current();
    }, 1000);
    return () => clearInterval(interval);
  }, [autoSave, observation?.workspaceId, observation?.cameraId, detecting, frozen]);

  function freezeFrame() {
    const media = video.current;
    const canvas = still.current;
    if (!media || !canvas || media.readyState < 2 || media.seeking) return;
    media.pause();
    setDetections([]);
    setCrop(null);
    setPlate(null);
    setStatus('');
    canvas.width = media.videoWidth;
    canvas.height = media.videoHeight;
    canvas.getContext('2d')?.drawImage(media, 0, 0);
    setFrozen(true);
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  async function readPlate(region = crop) {
    const canvas = still.current;
    if (!canvas || !region) return;
    const width = Math.round(region.width * canvas.width);
    const height = Math.round(region.height * canvas.height);
    if (width < 12 || height < 6) {
      setStatus('Select a larger region around the plate.');
      return;
    }
    setReading(true);
    setPlate(null);
    setStatus('Reading the selected region…');
    try {
      const input = document.createElement('canvas');
      input.width = Math.max(width, 400);
      input.height = Math.max(1, Math.round((height * input.width) / width));
      input
        .getContext('2d')
        ?.drawImage(
          canvas,
          region.x * canvas.width,
          region.y * canvas.height,
          width,
          height,
          0,
          0,
          input.width,
          input.height,
        );
      const image = input.toDataURL();
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
        const { data } = await worker.recognize(image);
        if (!mounted.current) return;
        const value = normalizePlate(data.text);
        setPlate(value ? { text: value, confidence: data.confidence } : null);
        setStatus(value ? '' : 'No readable plate text. Try a sharper frame and a tighter selection.');
        if (value && !samplePlate) {
          await recordRecognizedPlate(value, data.confidence, canvas, 'car');
        }
      } finally {
        await worker.terminate();
      }
    } catch {
      if (mounted.current)
        setStatus('Plate OCR could not read this video or load its model. Try a local clip and check your connection.');
    } finally {
      if (mounted.current) setReading(false);
    }
  }

  return (
    <>
      {/* Live Intelligence Telemetry HUD */}
      {!samplePlate && intelSummary && (
        <div
          className="lv-card-grid"
          style={{ marginBottom: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          aria-label="Live video intelligence metrics"
        >
          <div className="lv-stat-card" style={{ padding: '0.6rem 0.8rem' }}>
            <span>People in view</span>
            <strong>{intelSummary.peopleCurrent}</strong>
            <small>
              In: {intelSummary.peopleEntered} · Out: {intelSummary.peopleExited}
            </small>
          </div>
          <div className="lv-stat-card" style={{ padding: '0.6rem 0.8rem' }}>
            <span>Vehicles in view</span>
            <strong>{intelSummary.vehiclesCurrent}</strong>
            <small>
              In: {intelSummary.vehiclesEntered} · Out: {intelSummary.vehiclesExited}
            </small>
          </div>
          <div className="lv-stat-card" style={{ padding: '0.6rem 0.8rem' }}>
            <span>Vehicle breakdown</span>
            <strong style={{ fontSize: '0.95rem' }}>
              {intelSummary.vehicleByType.car || 0} car · {intelSummary.vehicleByType.motorcycle || 0} moto
            </strong>
            <small>
              {intelSummary.vehicleByType.bus || 0} bus · {intelSummary.vehicleByType.truck || 0} truck
            </small>
          </div>
          <div className="lv-stat-card" style={{ padding: '0.6rem 0.8rem' }}>
            <span>Analytics status</span>
            <strong style={{ fontSize: '0.95rem', color: intelSummary.tampered ? '#ef4444' : undefined }}>
              {intelSummary.tampered
                ? 'TAMPER ALERT'
                : intelSummary.withinSchedule
                  ? 'Active'
                  : 'Outside schedule'}
            </strong>
            <small>
              {isSampleClip ? 'Practice sample (not logged)' : `${eventsIngestedCount} events logged`}
            </small>
          </div>
        </div>
      )}

      {/* Real-time Watchlist Match Immediate Alert Banner */}
      {watchlistMatches.length > 0 && (
        <div
          role="alert"
          className="lv-card"
          style={{
            marginBottom: '0.85rem',
            border: '2px solid #ef4444',
            background: 'rgba(127, 29, 29, 0.28)',
          }}
        >
          <div className="lv-card-top">
            <strong>WATCHLIST MATCH DETECTED ({watchlistMatches.length})</strong>
            <span className="lv-badge lv-severity-high">IMMEDIATE ALERT</span>
          </div>
          {watchlistMatches.map((m) => (
            <div
              key={m.event_id}
              style={{
                display: 'flex',
                gap: '0.85rem',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                marginTop: '0.5rem',
                paddingTop: '0.5rem',
                borderTop: '1px solid rgba(248, 113, 113, 0.25)',
              }}
            >
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {m.snapshotDataUrl && (
                  <img
                    src={m.snapshotDataUrl}
                    alt={`Snapshot of matched plate ${m.plate}`}
                    style={{ width: '88px', height: '54px', objectFit: 'cover', borderRadius: '6px' }}
                  />
                )}
                <div>
                  <div>
                    <strong>Plate: {m.plate}</strong> · {m.label} · Case Ref: <strong>{m.reference}</strong>
                  </div>
                  <small className="lv-muted">
                    {observation?.cameraName || 'Camera feed'}{' '}
                    {observation?.cameraLocation ? `(${observation.cameraLocation})` : ''} ·{' '}
                    {new Date(m.occurred_at).toLocaleTimeString()}
                  </small>
                </div>
              </div>
              {onInspectEvent && (
                <button
                  type="button"
                  className="lv-btn lv-btn-primary"
                  onClick={() => onInspectEvent(m.event_id)}
                >
                  Investigate detection event
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <VideoViewport width={size.width} height={size.height}>
        {samplePlate ? (
          <img
            src={src}
            alt="Photograph of a Niger State vehicle plate"
            hidden={frozen}
            onError={() => setStatus('The sample photo could not be loaded.')}
            onLoad={(event) => {
              const photo = event.currentTarget;
              const canvas = still.current;
              if (!canvas) return;
              canvas.width = photo.naturalWidth;
              canvas.height = photo.naturalHeight;
              canvas.getContext('2d')?.drawImage(photo, 0, 0);
              setSize({ width: canvas.width, height: canvas.height });
              setCrop(samplePlateRegion);
              setFrozen(true);
              void readPlate(samplePlateRegion);
            }}
          />
        ) : (
          <CameraStream
            ref={video}
            onStreamError={() => { setReady(false); setDetecting(false); setStatus('Camera playback failed. Check the gateway, stream format and CORS settings.'); }}
            crossOrigin="anonymous"
            src={src}
            controls={!frozen}
            controlsList="nofullscreen noremoteplayback"
            disablePictureInPicture
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (!videoWidth || !videoHeight) return;
              const scale = Math.min(1, detectionFrameLimit / Math.max(videoWidth, videoHeight));
              setSize({
                width: Math.max(1, Math.round(videoWidth * scale)),
                height: Math.max(1, Math.round(videoHeight * scale)),
              });
            }}
            onLoadedData={() => setReady(true)}
            onError={() => {
              setReady(false);
              setDetecting(false);
              setDetections([]);
              setStatus(
                'Video could not load. Remote sources must allow cross-origin access. You can also select a local video.',
              );
              if (observation?.cameraId && settingsRef.current.capabilities.camera_health?.enabled) {
                void flushIntelEvents([
                  {
                    request_id: crypto.randomUUID(),
                    camera: observation.cameraId,
                    source: 'camera',
                    category: 'camera_offline',
                    count: 1,
                    occurred_at: new Date().toISOString(),
                    payload: {
                      camera_name: observation.cameraName || 'Camera',
                      summary: 'Camera playback stream failed to load or went offline',
                    },
                  },
                ]);
              }
            }}
          />
        )}
        {detecting && !frozen && (
          <svg viewBox={'0 0 ' + size.width + ' ' + size.height} aria-hidden="true">
            {/* Render configured camera zones */}
            {intelSettings.zones.map((z) => {
              const color =
                z.kind === 'restricted'
                  ? '#ef4444'
                  : z.kind === 'perimeter'
                    ? '#f59e0b'
                    : z.kind === 'count_line'
                      ? '#38bdf8'
                      : z.kind === 'parking'
                        ? '#a855f7'
                        : '#22c55e';
              if (z.kind === 'count_line' && z.points.length === 2) {
                const [[x1, y1], [x2, y2]] = z.points;
                return (
                  <g key={z.id}>
                    <line
                      x1={x1 * size.width}
                      y1={y1 * size.height}
                      x2={x2 * size.width}
                      y2={y2 * size.height}
                      stroke={color}
                      strokeWidth="2"
                      strokeDasharray="6,3"
                    />
                    <text x={x1 * size.width + 4} y={Math.max(12, y1 * size.height - 4)} fill={color}>
                      {z.name}
                    </text>
                  </g>
                );
              }
              const pts = z.points.map(([px, py]) => `${px * size.width},${py * size.height}`).join(' ');
              const [fx, fy] = z.points[0] || [0, 0];
              return (
                <g key={z.id}>
                  <polygon points={pts} fill={`${color}22`} stroke={color} strokeWidth="1.5" />
                  <text x={fx * size.width + 4} y={Math.max(12, fy * size.height + 14)} fill={color}>
                    {z.name}
                  </text>
                </g>
              );
            })}

            {/* Render tracked objects with persistent ID, direction & dwell */}
            {intelSummary
              ? intelSummary.activeTracks.map((track) => {
                  const [x, y, width, height] = track.bbox;
                  const dirTag = track.direction === 'Stationary' ? '•' : `→${track.direction}`;
                  return (
                    <g key={track.trackId}>
                      <rect x={x} y={y} width={width} height={height} />
                      <text x={x + 3} y={Math.max(12, y + 12)}>
                        #{track.trackId} {track.objectClass} {Math.round(track.score * 100)}% {dirTag}
                      </text>
                    </g>
                  );
                })
              : detections.map(({ bbox: [x, y, width, height], class: label, score }, index) => (
                  <g key={index}>
                    <rect x={x} y={y} width={width} height={height} />
                    <text x={x + 3} y={Math.max(12, y + 12)}>
                      {label} {Math.round(score * 100)}%
                    </text>
                  </g>
                ))}
          </svg>
        )}
        <canvas
          ref={still}
          hidden={!frozen}
          aria-label="Frozen frame. Drag around the plate."
          onPointerDown={(event) => {
            if (reading || !event.isPrimary || event.button !== 0) return;
            const point = pointerPosition(event);
            drag.current = point;
            event.currentTarget.setPointerCapture(event.pointerId);
            setPlate(null);
            setCrop(selection(point, point));
          }}
          onPointerMove={(event) => {
            if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
              setCrop(selection(drag.current, pointerPosition(event)));
            }
          }}
          onPointerUp={(event) => {
            if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const region = selection(drag.current, pointerPosition(event));
            setCrop(region);
            drag.current = null;
            void readPlate(region);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        />
        {frozen && crop && (
          <div
            className="lv-video-selection"
            style={{
              left: crop.x * 100 + '%',
              top: crop.y * 100 + '%',
              width: crop.width * 100 + '%',
              height: crop.height * 100 + '%',
            }}
          />
        )}
      </VideoViewport>
      <div className="lv-video-actions">
        {frozen ? (
          <>
            {!samplePlate && (
              <button
                type="button"
                disabled={reading}
                onClick={() => {
                  setFrozen(false);
                  setPlate(null);
                  setStatus('');
                }}
              >
                Back to video
              </button>
            )}
            <button type="button" disabled={reading || !crop} onClick={() => void readPlate()}>
              Read selected plate
            </button>
          </>
        ) : (
          !samplePlate && (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  setDetections([]);
                  setStatus(detecting ? '' : 'Loading object detection…');
                  setDetecting(!detecting);
                }}
              >
                {detecting ? 'Stop object detection' : 'Start object detection'}
              </button>
              <button type="button" disabled={!ready} onClick={freezeFrame}>
                Freeze frame for plate OCR
              </button>
              {watchlistWorkspaceId && intelSettings.capabilities.anpr?.enabled && (
                <label className="lv-inline-check" style={{ marginLeft: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={autoAnpr}
                    onChange={(e) => setAutoAnpr(e.target.checked)}
                  />
                  <span>Real-time background ANPR matching</span>
                </label>
              )}
            </>
          )
        )}
      </div>
      {frozen && (
        <p>
          {samplePlate
            ? 'The sample plate is read automatically. Redraw the selection to read a different region.'
            : 'Drag around the plate characters to read them automatically.'}
        </p>
      )}
      {detecting && detections.length > 0 && (
        <p>{detections.map(({ class: label, score }) => label + ' ' + Math.round(score * 100) + '%').join(' · ')}</p>
      )}
      {observation && (
        <>
          <label className="lv-auto-observations">
            <input
              type="checkbox"
              checked={autoSave}
              disabled={Boolean(pendingSave.current)}
              onChange={(event) => setAutoSave(event.target.checked)}
            />{' '}
            Save detections automatically every 15 seconds
          </label>
          <p>
            Automatic saving runs while this tab is visible and the video is playing. Enabled camera intelligence rules
            and agency rules evaluate each saved frame. Samples are excluded.
          </p>
          {((detecting && detections.length > 0) || pendingSave.current) && (
            <div className="lv-video-actions">
              <button type="button" disabled={savingObservation} onClick={() => void saveObservation()}>
                {savingObservation ? 'Saving…' : pendingSave.current ? 'Retry pending frame' : 'Save frame detections'}
              </button>
            </div>
          )}
        </>
      )}
      {observationNotice && <p role="status">{observationNotice}</p>}
      {status && <p role="status">{status}</p>}
      {plate && (
        <p role="status">
          <strong>{plate.text}</strong> · {Math.round(plate.confidence)}% OCR confidence. Verify against the frame.
        </p>
      )}
      {recentPlates.length > 0 && !samplePlate && (
        <div className="lv-card" style={{ marginTop: '0.5rem', padding: '0.75rem' }}>
          <strong style={{ fontSize: '0.85rem' }}>Live ANPR Plate Feed (Temporal Consensus)</strong>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
            {recentPlates.map((rp) => (
              <span key={rp.plate} className="lv-badge">
                {rp.plate} · {Math.round(rp.confidence)}% · {rp.ts}
              </span>
            ))}
          </div>
        </div>
      )}
      {plate && !samplePlate && watchlistWorkspaceId && (
        <PlateWatchlistCheck key={plate.text} workspaceId={watchlistWorkspaceId} initialPlate={plate.text} />
      )}
    </>
  );
}

export default function VideoAnalysis({
  cameraUrl,
  cameraId,
  cameraName,
  cameraLocation,
  workspaceId,
  watchlistWorkspaceId,
  samples = false,
  onInspectEvent,
}: {
  cameraUrl?: string;
  cameraId?: string;
  cameraName?: string;
  cameraLocation?: string;
  workspaceId?: string;
  watchlistWorkspaceId?: string;
  samples?: boolean;
  onInspectEvent?: (eventId: string) => void;
}) {
  const [fileUrl, setFileUrl] = useState('');
  const [source, setSource] = useState<'camera' | 'traffic' | 'plate' | 'file'>(
    cameraUrl ? 'camera' : samples && !workspaceId ? 'traffic' : 'file',
  );
  const [intelSettings, setIntelSettings] = useState<CameraIntelSettings>(() =>
    defaultCameraIntelSettings(Boolean(watchlistWorkspaceId)),
  );

  useEffect(
    () => () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    },
    [fileUrl],
  );

  useEffect(() => {
    let active = true;
    async function loadCameraSettings() {
      if (!workspaceId || !cameraId) {
        setIntelSettings(defaultCameraIntelSettings(Boolean(watchlistWorkspaceId)));
        return;
      }
      const { data } = await supabase
        .from('lv_camera_intel_settings')
        .select('settings')
        .eq('camera_id', cameraId)
        .maybeSingle();
      if (!active) return;
      if (data?.settings) {
        setIntelSettings(normalizeCameraIntelSettings(data.settings, Boolean(watchlistWorkspaceId)));
      } else {
        setIntelSettings(defaultCameraIntelSettings(Boolean(watchlistWorkspaceId)));
      }
    }
    void loadCameraSettings();
    return () => {
      active = false;
    };
  }, [workspaceId, cameraId, watchlistWorkspaceId]);

  const sources = {
    camera: cameraUrl,
    traffic: '/demo/street-traffic.webm',
    plate: '/demo/niger-plate-sample.jpg',
    file: fileUrl,
  };
  const src = sources[source];

  return (
    <section className="lv-video-analysis" aria-label="Video analysis">
      <h2>Video analysis & live intelligence</h2>
      <p>
        Detect, classify, track, and count people and vehicles in real time, monitor zones, and match vehicle number
        plates. Footage is processed locally in this browser.
      </p>
      <div className="lv-video-actions">
        {cameraUrl && (
          <button type="button" aria-pressed={source === 'camera'} onClick={() => setSource('camera')}>
            Workspace camera
          </button>
        )}
        {samples && (
          <>
            <button type="button" aria-pressed={source === 'traffic'} onClick={() => setSource('traffic')}>
              Traffic sample
            </button>
            <button type="button" aria-pressed={source === 'plate'} onClick={() => setSource('plate')}>
              Plate OCR sample
            </button>
          </>
        )}
        <label>
          Choose a video{' '}
          <input
            type="file"
            accept="video/*"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              setFileUrl(URL.createObjectURL(file));
              setSource('file');
              event.currentTarget.value = '';
            }}
          />
        </label>
      </div>
      {!src && <p>Choose a local video{cameraUrl ? ' or switch to the open workspace camera' : ''} to start analysis.</p>}
      {source === 'traffic' && (
        <p>
          Practice footage. Object detection starts automatically. Press play to analyze more frames.{' '}
          <a href={sampleCredit} target="_blank" rel="noreferrer">
            Street traffic
          </a>{' '}
          by{' '}
          <a href="https://www.youtube.com/user/Editor" target="_blank" rel="noreferrer">
            Editor
          </a>{' '}
          ·{' '}
          <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">
            CC BY 3.0
          </a>
        </p>
      )}
      {source === 'plate' && (
        <p>
          Real Nigerian plate photograph. Compare the automatic reading with the image.{' '}
          <a
            href="https://commons.wikimedia.org/wiki/File:Nigerian_number_plate_Niger.jpg"
            target="_blank"
            rel="noreferrer"
          >
            Photo by Niegodzisie
          </a>{' '}
          ·{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>{' '}
          · resized
        </p>
      )}
      {src && (
        <VideoViewer
          key={src}
          src={src}
          samplePlate={source === 'plate'}
          isSampleClip={source === 'traffic' || source === 'plate'}
          intelSettings={intelSettings}
          onInspectEvent={onInspectEvent}
          observation={
            workspaceId && (source === 'file' || (source === 'camera' && cameraId))
              ? {
                  workspaceId,
                  cameraId: source === 'camera' ? cameraId : undefined,
                  cameraName: source === 'camera' ? cameraName : 'Uploaded video file',
                  cameraLocation: source === 'camera' ? cameraLocation : undefined,
                }
              : undefined
          }
          watchlistWorkspaceId={source === 'traffic' ? undefined : watchlistWorkspaceId}
        />
      )}
    </section>
  );
}
