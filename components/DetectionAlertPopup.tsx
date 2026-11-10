import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, Camera, Clock, Eye, Link, User, ScanFace, ArrowUpRight } from 'lucide-react';
import { SurveillanceAlert, WatchlistPOI, Detection, POIPriority } from '../types';

interface SurveillanceAlertWithDetails extends SurveillanceAlert {
  poi?: WatchlistPOI;
  detection?: Detection;
  cameraName?: string;
}
interface DetectionAlertPopupProps {
  alert: SurveillanceAlertWithDetails;
  onClose: () => void;
  onViewFeed?: (cameraId: string) => void;
  onViewPOI?: (poiId: string) => void;
  onLinkToCase?: (alertId: string) => void;
  playSound?: boolean;
}

export function DetectionAlertPopup({ alert, onClose, onViewFeed, onViewPOI, onLinkToCase, playSound = true }: DetectionAlertPopupProps) {
  const close = useRef(onClose); close.current = onClose;
  const [remaining, setRemaining] = useState(10);
  useEffect(() => {
    const started = Date.now(); setRemaining(10);
    const countdown = setInterval(() => setRemaining(Math.max(0, 10 - Math.floor((Date.now() - started) / 1000))), 1000);
    const timer = setTimeout(() => close.current(), 10000);
    let context: AudioContext | undefined;
    let soundTimer: ReturnType<typeof setTimeout> | undefined;
    if (playSound) {
      try {
        const Audio = window.AudioContext || (window as any).webkitAudioContext;
        if (Audio) {
          context = new Audio();
          const oscillator = context.createOscillator(); const gain = context.createGain();
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.frequency.value = 720; oscillator.type = 'sine';
          gain.gain.setValueAtTime(.08, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .2);
          oscillator.start(); oscillator.stop(context.currentTime + .2);
          soundTimer = setTimeout(() => { if (context?.state !== 'closed') context?.close().catch(() => {}); }, 240);
        }
      } catch { /* Sound is optional when browser audio is unavailable. */ }
    }
    return () => {
      clearTimeout(timer); clearInterval(countdown); clearTimeout(soundTimer);
      if (context && context.state !== 'closed') context.close().catch(() => {});
    };
  }, [alert.id, playSound]);

  const priority = alert.poi?.priority || POIPriority.MEDIUM;
  const isDemo = alert.detection?.metadata?.demo === true;
  const raw = alert.detection?.confidence;
  const confidence = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw * 100)) : null;
  const date = new Date(alert.createdAt);
  return createPortal(<section className="detection-popup" data-priority={priority} aria-label="Detection alert">
    <div className="detection-popup-heading">
      <div className="detection-popup-symbol"><ScanFace size={21}/></div>
      <div className="flex-1"><p>{isDemo ? 'SIMULATION EVENT / FICTIONAL PROFILE' : 'WATCHLIST CORRELATION'}</p><h2>POI Detected</h2></div>
      <button onClick={onClose} aria-label="Dismiss detection alert" title="Dismiss alert"><X size={17}/></button>
    </div>
    <div className="detection-popup-announcement" role="status" aria-live="polite" aria-atomic="true">{isDemo ? 'Simulated detection' : 'Detection'}: {alert.poi?.name || 'Unknown person'} at {alert.cameraName || 'Unknown camera'}.</div>
    <div className="detection-popup-title"><div><h3>{alert.poi?.name || 'Unknown person'}</h3><span>{alert.poiId}</span></div><span className="detection-priority"><AlertTriangle size={11}/>{priority}</span></div>
    <div className="detection-comparison">
      <figure><div className="detection-portrait"><User size={32}/>{alert.poi?.imageUrl && <img src={alert.poi.imageUrl} alt={isDemo ? 'Fictional African demo portrait' : 'Watchlist reference portrait'} onError={event => { event.currentTarget.style.display = 'none'; }}/>}</div><figcaption>{isDemo ? 'DEMO REFERENCE' : 'WATCHLIST REFERENCE'}</figcaption></figure>
      <div className="detection-score"><ScanFace size={18}/><strong>{confidence === null ? '—' : confidence.toFixed(1)}<small>{confidence === null ? '' : '%'}</small></strong><span>{isDemo ? 'SIMULATED SCORE' : 'MATCH CONFIDENCE'}</span></div>
      <figure><div className="detection-portrait detection-capture"><Camera size={32}/>{alert.detection?.snapshotUrl && <img src={alert.detection.snapshotUrl} alt={isDemo ? 'Synthetic demo capture of the same fictional person' : 'Detection snapshot'} onError={event => { event.currentTarget.style.display = 'none'; }}/>}<div className="detection-capture-corners" aria-hidden="true"/></div><figcaption>{isDemo ? 'SYNTHETIC CROP' : 'DETECTION CAPTURE'}</figcaption></figure>
    </div>
    <div className="detection-popup-context"><div><Camera size={14}/><span>CAMERA</span><strong>{alert.cameraName || 'Unknown camera'}</strong></div><div><Clock size={14}/><span>RECORDED</span><strong>{date.toLocaleTimeString()} · {date.toLocaleDateString()}</strong></div></div>
    {alert.poi?.notes && <p className="detection-popup-note">{alert.poi.notes}</p>}
    <p className="detection-popup-disclaimer">{isDemo ? 'Fictional training identity and simulated score. No real detection or biometric search was performed.' : 'Review the source capture before making an identification decision.'}</p>
    <div className="detection-popup-actions">
      {onViewFeed && <button onClick={() => onViewFeed(alert.cameraId)} className="detection-view-feed"><Camera size={14}/>View Feed<ArrowUpRight size={13}/></button>}
      {onViewPOI && alert.poiId && <button onClick={() => onViewPOI(alert.poiId)}><Eye size={14}/>View POI</button>}
      {onLinkToCase && <button onClick={() => onLinkToCase(alert.id)}><Link size={14}/>Link Case</button>}
    </div>
    <div className="detection-popup-timeout"><span>Dismisses automatically in {remaining}s</span><span>{isDemo ? 'DEMO ONLY' : 'REVIEW REQUIRED'}</span></div>
    <div className="detection-popup-progress" aria-hidden="true"><div key={alert.id}/></div>
  </section>, document.body);
}
export default DetectionAlertPopup;
