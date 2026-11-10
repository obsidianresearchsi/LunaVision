/**
 * Demo Simulation Service
 * 
 * Provides simulated camera feeds and detection events for demonstration purposes.
 * This allows showcasing the surveillance system without real camera infrastructure.
 */

import { Camera, CameraStatus, WatchlistPOI, Detection, SurveillanceAlert, POIPriority, AlertStatus } from '../types';

// Demo camera data
export const DEMO_CAMERAS: Camera[] = [
  {
    id: 'demo-cam-1',
    name: 'Abuja / Entry Plaza',
    description: 'Fictional training site · entrance concourse',
    streamUrl: 'demo://main-entrance',
    coordinates: { lat: 9.0765, lng: 7.3986 },
    status: CameraStatus.ONLINE,
    lastOnline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'demo-cam-2',
    name: 'Lagos / Transit Forecourt',
    description: 'Fictional training site · outdoor forecourt',
    streamUrl: 'demo://parking-a',
    coordinates: { lat: 6.5244, lng: 3.3792 },
    status: CameraStatus.RECORDING,
    lastOnline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'demo-cam-3',
    name: 'Abuja / Civic Concourse',
    description: 'Fictional training site · interior walkway',
    streamUrl: 'demo://lobby',
    coordinates: { lat: 9.08, lng: 7.4 },
    status: CameraStatus.ONLINE,
    lastOnline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'demo-cam-4',
    name: 'Lagos / Service Gate',
    description: 'Fictional training site · service approach',
    streamUrl: 'demo://emergency-exit',
    coordinates: { lat: 6.52, lng: 3.38 },
    status: CameraStatus.ONLINE,
    lastOnline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Demo POI data
export const DEMO_POIS: WatchlistPOI[] = [
  {
    id: 'demo-poi-1',
    faceToken: 'demo-face-token-1',
    name: 'Demo Subject 01',
    imageUrl: '/demo/subject-01.jpg',
    priority: POIPriority.CRITICAL,
    notes: 'Fictional training profile · critical-priority alert scenario.',
    isActive: true,
    createdAt: new Date().toISOString(),
    createdBy: 'demo-user'
  },
  {
    id: 'demo-poi-2',
    faceToken: 'demo-face-token-2',
    name: 'Demo Subject 02',
    imageUrl: '/demo/subject-02.jpg',
    priority: POIPriority.HIGH,
    notes: 'Fictional training profile · high-priority review scenario.',
    isActive: true,
    createdAt: new Date().toISOString(),
    createdBy: 'demo-user'
  },
  {
    id: 'demo-poi-3',
    faceToken: 'demo-face-token-3',
    name: 'Demo Subject 03',
    imageUrl: '/demo/subject-03.jpg',
    priority: POIPriority.MEDIUM,
    notes: 'Fictional training profile · welfare-check demonstration.',
    isActive: true,
    createdAt: new Date().toISOString(),
    createdBy: 'demo-user'
  }
];

// Simulation state
let simulationInterval: NodeJS.Timeout | null = null;
let initialDetectionTimer: ReturnType<typeof setTimeout> | null = null;
let eventSequence = 0;
let detectionCallbacks: ((alert: SimulatedAlert) => void)[] = [];

export interface SimulatedAlert {
  alert: SurveillanceAlert;
  detection: Detection;
  poi: WatchlistPOI;
  camera: Camera;
}

/**
 * Start the demo simulation
 * Generates random detection events at specified intervals
 */
export function startDemoSimulation(
  intervalMs: number = 15000,
  onDetection?: (alert: SimulatedAlert) => void
): void {
  if (simulationInterval) {
    stopDemoSimulation();
  }

  if (onDetection) {
    detectionCallbacks.push(onDetection);
  }

  // Generate initial detection after 8 seconds (let people watch the feeds first)
  initialDetectionTimer = setTimeout(() => {
    initialDetectionTimer = null;
    generateRandomDetection();
  }, 8000);

  // Then generate at regular intervals
  simulationInterval = setInterval(() => {
    generateRandomDetection();
  }, intervalMs);

  console.log('[Demo] Simulation started - detections every', intervalMs / 1000, 'seconds');
}

/**
 * Stop the demo simulation
 */
export function stopDemoSimulation(): void {
  if (initialDetectionTimer) { clearTimeout(initialDetectionTimer); initialDetectionTimer = null; }
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  detectionCallbacks = [];
  console.log('[Demo] Simulation stopped');
}

/**
 * Check if simulation is running
 */
export function isSimulationRunning(): boolean {
  return simulationInterval !== null;
}

/**
 * Register a callback for detection events
 */
export function onDetectionEvent(callback: (alert: SimulatedAlert) => void): () => void {
  detectionCallbacks.push(callback);
  return () => {
    detectionCallbacks = detectionCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Generate a random detection event
 */
export function generateRandomDetection(): SimulatedAlert {
  const camera = DEMO_CAMERAS[Math.floor(Math.random() * DEMO_CAMERAS.length)];
  const poi = DEMO_POIS[Math.floor(Math.random() * DEMO_POIS.length)];
  const confidence = 0.75 + Math.random() * 0.24; // 75-99% confidence
  const now = new Date().toISOString();
  const eventId = `${Date.now()}-${++eventSequence}`;

  const detection: Detection = {
    id: `demo-detection-${eventId}`,
    cameraId: camera.id,
    poiId: poi.id,
    snapshotUrl: poi.imageUrl || '',
    confidence,
    boundingBox: {
      x: Math.floor(Math.random() * 400) + 100,
      y: Math.floor(Math.random() * 200) + 50,
      width: 80 + Math.floor(Math.random() * 40),
      height: 100 + Math.floor(Math.random() * 50)
    },
    detectedAt: now,
    metadata: { demo: true, syntheticPortrait: true }
  };

  const alert: SurveillanceAlert = {
    id: `demo-alert-${eventId}`,
    detectionId: detection.id,
    poiId: poi.id,
    cameraId: camera.id,
    status: AlertStatus.UNREAD,
    createdAt: now
  };

  const simulatedAlert: SimulatedAlert = {
    alert,
    detection,
    poi,
    camera
  };

  // Notify all callbacks
  detectionCallbacks.forEach(cb => {
    try {
      cb(simulatedAlert);
    } catch (err) {
      console.error('[Demo] Error in detection callback:', err);
    }
  });

  console.log('[Demo] Detection generated:', poi.name, 'at', camera.name, `(${(confidence * 100).toFixed(1)}%)`);

  return simulatedAlert;
}

/**
 * Generate simulated video frame data (for visual effect)
 */
export function generateFrameNoise(): string {
  // Generate a simple noise pattern as base64
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  
  if (ctx) {
    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add some noise
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const noise = Math.random() * 20;
      imageData.data[i] += noise;     // R
      imageData.data[i + 1] += noise; // G
      imageData.data[i + 2] += noise; // B
    }
    ctx.putImageData(imageData, 0, 0);
  }
  
  return canvas.toDataURL('image/jpeg', 0.5);
}

/**
 * Get demo cameras
 */
export function getDemoCameras(): Camera[] {
  return [...DEMO_CAMERAS];
}

/**
 * Get demo POIs
 */
export function getDemoPOIs(): WatchlistPOI[] {
  return [...DEMO_POIS];
}
