import React, { useEffect, useRef, useState } from 'react';
import type { DetectedObject } from '@tensorflow-models/coco-ssd';
import { PlateWatchlistCheck } from './VehicleWatchlist';
import { supabase } from '../services/supabase';
import ocrWorkerUrl from 'tesseract.js/dist/worker.min.js?url';
import ocrCoreUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';

const sampleCredit = 'https://commons.wikimedia.org/wiki/File:Street_traffic.webm';
const detectionFrameLimit = 320;

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
const samplePlateRegion: Box = { x: 0.13, y: 0.33, width: 0.73, height: 0.47 };

function selection(start: Point, end: Point): Box {
  return {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y),
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
      return await model.detect(frame, 20, 0.5);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') throw error;
      if (tf.getBackend() === 'cpu') throw error;
      await tf.setBackend('cpu');
      return model.detect(frame, 20, 0.5);
    }
  };
}

let detector: ReturnType<typeof loadDetector> | undefined;

type ObservationTarget = { workspaceId: string; cameraId?: string };

function VideoViewer({ src, samplePlate, watchlistWorkspaceId, observation }: {
  src: string; samplePlate: boolean; watchlistWorkspaceId?: string; observation?: ObservationTarget;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Point | null>(null);
  const mounted = useRef(false);
  const [size, setSize] = useState({ width: 640, height: 360 });
  const [ready, setReady] = useState(false);
  const [detecting, setDetecting] = useState(!samplePlate);
  const [detections, setDetections] = useState<DetectedObject[]>([]);
  const [frameSeconds, setFrameSeconds] = useState(0);
  const [savingObservation, setSavingObservation] = useState(false);
  const [observationNotice, setObservationNotice] = useState('');
  const [status, setStatus] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [crop, setCrop] = useState<Box | null>(null);
  const [reading, setReading] = useState(false);
  const [plate, setPlate] = useState<{ text: string; confidence: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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
        detector ??= loadDetector().catch(error => {
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
          setDetections(objects);
          setFrameSeconds(lastTime);
          setStatus(objects.length ? '' : 'No objects detected in this frame.');
          const elapsed = performance.now() - started;
          delay = Math.max(25, 120 - elapsed, elapsed / 4);
        }
        timer = setTimeout(analyze, delay);
      } catch (error) {
        if (cancelled) return;
        setDetecting(false);
        setStatus(error instanceof DOMException && error.name === 'SecurityError'
          ? 'This camera does not allow frame access. Enable cross-origin video access or choose a local file.'
          : 'Object detection could not process this frame. Try a different frame or local video.');
      }
    }

    void analyze();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [detecting, frozen, size]);

  async function saveObservation() {
    if (!observation || savingObservation || detections.length === 0) return;
    setSavingObservation(true);
    setObservationNotice('');
    const summary = detections.map(item => item.class + ' ' + Math.round(item.score * 100) + '%').join(' · ');
    try {
      const { error } = await supabase.from('lv_video_observations').insert({
        workspace_id: observation.workspaceId,
        camera_id: observation.cameraId ?? null,
        source: observation.cameraId ? 'camera' : 'file',
        frame_seconds: frameSeconds.toFixed(2),
        summary,
        detections: detections.map(item => ({ label: item.class, score: item.score })),
      });
      if (error) throw error;
      if (mounted.current) setObservationNotice('Observation saved. Find it in Workspace Overview.');
    } catch {
      if (mounted.current) setObservationNotice('The observation could not be saved. Try again.');
    } finally {
      if (mounted.current) setSavingObservation(false);
    }
  }

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
      input.height = Math.max(1, Math.round(height * input.width / width));
      input.getContext('2d')?.drawImage(canvas, region.x * canvas.width, region.y * canvas.height, width, height, 0, 0, input.width, input.height);
      // Read the pixels here so a restricted source fails before loading the OCR worker.
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
        const value = data.text.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        setPlate(value ? { text: value, confidence: data.confidence } : null);
        setStatus(value ? '' : 'No readable plate text. Try a sharper frame and a tighter selection.');
      } finally {
        await worker.terminate();
      }
    } catch {
      if (mounted.current) setStatus('Plate OCR could not read this video or load its model. Try a local clip and check your connection.');
    } finally {
      if (mounted.current) setReading(false);
    }
  }

  return (
    <>
      <div className="lv-video-frame" style={{ aspectRatio: size.width + '/' + size.height }}>
        {samplePlate ? <img src={src} alt="Photograph of a Niger State vehicle plate"
          hidden={frozen} onError={() => setStatus('The sample photo could not be loaded.')}
          onLoad={event => {
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
          }} /> : <video ref={video} crossOrigin="anonymous" src={src} controls={!frozen} playsInline preload="auto"
          onLoadedMetadata={event => {
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
            setStatus('Video could not load. Remote sources must allow cross-origin access. You can also select a local video.');
          }} />}
        {detecting && !frozen && (
          <svg viewBox={'0 0 ' + size.width + ' ' + size.height} aria-hidden="true">
            {detections.map(({ bbox: [x, y, width, height], class: label, score }, index) => (
              <g key={index}>
                <rect x={x} y={y} width={width} height={height} />
                <text x={x + 3} y={Math.max(12, y + 12)}>{label} {Math.round(score * 100)}%</text>
              </g>
            ))}
          </svg>
        )}
        <canvas ref={still} hidden={!frozen} aria-label="Frozen frame. Drag around the plate."
          onPointerDown={event => {
            if (reading || !event.isPrimary || event.button !== 0) return;
            const point = pointerPosition(event);
            drag.current = point;
            event.currentTarget.setPointerCapture(event.pointerId);
            setPlate(null);
            setCrop(selection(point, point));
          }}
          onPointerMove={event => {
            if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
              setCrop(selection(drag.current, pointerPosition(event)));
            }
          }}
          onPointerUp={event => {
            if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const region = selection(drag.current, pointerPosition(event));
            setCrop(region);
            drag.current = null;
            void readPlate(region);
          }}
          onLostPointerCapture={() => { drag.current = null; }} />
        {frozen && crop && (
          <div className="lv-video-selection" style={{
            left: crop.x * 100 + '%', top: crop.y * 100 + '%',
            width: crop.width * 100 + '%', height: crop.height * 100 + '%',
          }} />
        )}
      </div>
      <div className="lv-video-actions">
        {frozen ? (
          <>
            {!samplePlate && <button type="button" disabled={reading} onClick={() => {
              setFrozen(false);
              setPlate(null);
              setStatus('');
            }}>Back to video</button>}
            <button type="button" disabled={reading || !crop} onClick={() => void readPlate()}>Read selected plate</button>
          </>
        ) : !samplePlate && (
          <>
            <button type="button" disabled={!ready} onClick={() => {
              setDetections([]);
              setStatus(detecting ? '' : 'Loading object detection…');
              setDetecting(!detecting);
            }}>{detecting ? 'Stop object detection' : 'Start object detection'}</button>
            <button type="button" disabled={!ready} onClick={freezeFrame}>Freeze frame for plate OCR</button>
          </>
        )}
      </div>
      {frozen && <p>{samplePlate ? 'The sample plate is read automatically. Redraw the selection to read a different region.' : 'Drag around the plate characters to read them automatically.'}</p>}
      {detecting && detections.length > 0 && <p>{detections.map(({ class: label, score }) => label + ' ' + Math.round(score * 100) + '%').join(' · ')}</p>}
      {observation && detecting && detections.length > 0 && <div className="lv-video-actions">
        <button type="button" disabled={savingObservation} onClick={() => void saveObservation()}>{savingObservation ? 'Saving…' : 'Save frame detections'}</button>
      </div>}
      {observationNotice && <p role="status">{observationNotice}</p>}
      {status && <p role="status">{status}</p>}
      {plate && <p role="status"><strong>{plate.text}</strong> · {Math.round(plate.confidence)}% OCR confidence. Verify against the frame.</p>}
      {plate && !samplePlate && watchlistWorkspaceId && (
        <PlateWatchlistCheck key={plate.text} workspaceId={watchlistWorkspaceId} initialPlate={plate.text} />
      )}
    </>
  );
}

export default function VideoAnalysis({ cameraUrl, cameraId, workspaceId, watchlistWorkspaceId, samples = false }: {
  cameraUrl?: string; cameraId?: string; workspaceId?: string; watchlistWorkspaceId?: string; samples?: boolean;
}) {
  const [fileUrl, setFileUrl] = useState('');
  const [source, setSource] = useState<'camera' | 'traffic' | 'plate' | 'file'>(cameraUrl ? 'camera' : samples && !workspaceId ? 'traffic' : 'file');

  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  const sources = {
    camera: cameraUrl,
    traffic: '/demo/street-traffic.webm',
    plate: '/demo/niger-plate-sample.jpg',
    file: fileUrl,
  };
  const src = sources[source];

  return (
    <section className="lv-video-analysis" aria-label="Video analysis">
      <h2>Video analysis</h2>
      <p>Detect objects in video and read plate text from a selected frame. Footage is processed in this browser.</p>
      <div className="lv-video-actions">
        {cameraUrl && <button type="button" aria-pressed={source === 'camera'} onClick={() => setSource('camera')}>Workspace camera</button>}
        {samples && <>
          <button type="button" aria-pressed={source === 'traffic'} onClick={() => setSource('traffic')}>Traffic sample</button>
          <button type="button" aria-pressed={source === 'plate'} onClick={() => setSource('plate')}>Plate OCR sample</button>
        </>}
        <label>Choose a video <input type="file" accept="video/*" onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          setFileUrl(URL.createObjectURL(file));
          setSource('file');
          event.currentTarget.value = '';
        }} /></label>
      </div>
      {!src && <p>Choose a local video{cameraUrl ? ' or switch to the open workspace camera' : ''} to start analysis.</p>}
      {source === 'traffic' && <p>
        Practice footage. Object detection starts automatically. Press play to analyze more frames.{' '}
        <a href={sampleCredit} target="_blank" rel="noreferrer">Street traffic</a> by{' '}
        <a href="https://www.youtube.com/user/Editor" target="_blank" rel="noreferrer">Editor</a> ·{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>
      </p>}
      {source === 'plate' && <p>Real Nigerian plate photograph. Compare the automatic reading with the image.{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Nigerian_number_plate_Niger.jpg" target="_blank" rel="noreferrer">Photo by Niegodzisie</a> ·{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> · resized
      </p>}
      {src && <VideoViewer key={src} src={src} samplePlate={source === 'plate'}
        observation={workspaceId && (source === 'file' || source === 'camera' && cameraId)
          ? { workspaceId, cameraId: source === 'camera' ? cameraId : undefined } : undefined}
        watchlistWorkspaceId={source === 'traffic' ? undefined : watchlistWorkspaceId} />}
    </section>
  );
}
