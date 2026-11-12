import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, Camera, Car, ScanFace, Shield, ShieldAlert, X } from 'lucide-react';
import { LiveAlertKind, LiveAlertPayload, subscribeLiveAlerts } from '../services/liveAlertBus';
import {supabase} from '../services/supabase';
import {emitLiveAlert} from '../services/liveAlertBus';

const KIND_LABELS: Record<LiveAlertKind, string> = {
  person_presence:'PERSON PRESENCE DETECTED',
  vehicle_presence:'VEHICLE DETECTED',
  watchlist_match: 'VEHICLE WATCHLIST MATCH',
  face_match: 'BIOMETRIC FACE MATCH',
  weapon: 'WEAPON / THREAT DETECTED',
  vehicle_recognition: 'VEHICLE RECOGNITION ALERT',
  rule_trigger: 'AI DETECTION RULE TRIGGERED',
  intrusion: 'PERIMETER / ZONE BREACH',
  tamper: 'CAMERA TAMPER ALERT',
  camera_offline: 'DEVICE OFFLINE ALERT',
};

function kindIcon(kind: LiveAlertKind) {
  switch (kind) {
    case 'face_match':
      return <ScanFace size={18} aria-hidden="true" />;
    case 'watchlist_match':
    case 'vehicle_presence':
    case 'vehicle_recognition':
      return <Car size={18} aria-hidden="true" />;
    case 'weapon':
      return <ShieldAlert size={18} aria-hidden="true" />;
    case 'camera_offline':
    case 'tamper':
      return <Camera size={18} aria-hidden="true" />;
    default:
      return <Shield size={18} aria-hidden="true" />;
  }
}

function playAlertTone(severity: 'low' | 'medium' | 'high') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = severity === 'high' ? 'triangle' : 'sine';
    osc.frequency.value = severity === 'high' ? 880 : 660;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => {
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
    }, 300);
  } catch {
    // Ignore when WebAudio is unavailable in restricted/headless environments
  }
}

export default function LiveAlertPopupHost({
  workspaceId,
  onOpenAlerts,
  onInspectEvent,
  onOpenCamera,
}: {
  workspaceId: string;
  onOpenAlerts: () => void;
  onInspectEvent?: (eventId: string) => void;
  onOpenCamera?: (cameraId: string) => void;
}) {
  const [queue, setQueue] = useState<LiveAlertPayload[]>([]);
  useEffect(()=>{
    let active=true,busy=false,cursor=new Date(Date.now()-1000).toISOString(),cursorId='00000000-0000-0000-0000-000000000000';const seen=new Set<string>();
    async function check(){if(busy||document.visibilityState==='hidden')return;busy=true;
      try{const {data,error}=await supabase.from('lv_agency_alerts').select('id,title,details,severity,camera_id,event_id,category,created_at').eq('workspace_id',workspaceId).in('category',['person_presence','vehicle_presence']).or(`created_at.gt.${cursor},and(created_at.eq.${cursor},id.gt.${cursorId})`).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(100);
        if(!active||error)return;
        for(const row of data??[]){if(!seen.has(row.id)&&Date.now()-Date.parse(row.created_at)<60000){seen.add(row.id);emitLiveAlert({id:row.id,workspaceId,kind:row.category as LiveAlertKind,title:row.title,details:row.details,severity:row.severity,cameraId:row.camera_id,eventId:row.event_id,occurredAt:row.created_at,dedupeKey:'presence:'+row.id});}cursor=row.created_at;cursorId=row.id;}
        if(seen.size>1000){const keep=[...seen].slice(-500);seen.clear();for(const id of keep)seen.add(id);}
      }catch{/* Next poll retries without publishing an unsaved alert. */}finally{busy=false;}
    }
    void check();const timer=setInterval(()=>void check(),5000);return()=>{active=false;clearInterval(timer);};
  },[workspaceId]);

  useEffect(() => {
    return subscribeLiveAlerts((incoming) => {
      if (incoming.workspaceId !== workspaceId) return;
      playAlertTone(incoming.severity);
      setQueue((prev) => [incoming, ...prev.filter((item) => item.id !== incoming.id)].slice(0, 4));
    });
  }, [workspaceId]);

  useEffect(() => {
    if (queue.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setQueue((prev) => prev.filter((item) => now - new Date(item.occurredAt).getTime() < 16_000));
    }, 1000);
    return () => clearInterval(timer);
  }, [queue.length]);

  if (queue.length === 0 || typeof document === 'undefined') return null;

  const visible = queue.slice(0, 2);

  return createPortal(
    <div
      role="region"
      aria-label="Live operational alerts"
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '410px',
        width: 'calc(100vw - 2rem)',
      }}
    >
      {visible.map((alert) => {
        const isHigh = alert.severity === 'high';
        const borderColor = isHigh ? '#ef4444' : alert.severity === 'medium' ? '#f59e0b' : '#2dd4bf';
        const bgColor = isHigh ? '#1f0b10' : '#0b1924';
        return (
          <section
            key={alert.id}
            role="alert"
            aria-live="assertive"
            style={{
              background: bgColor,
              border: `2px solid ${borderColor}`,
              borderRadius: '10px',
              padding: '0.9rem 1rem',
              color: '#f8fafc',
              boxShadow: '0 16px 40px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: borderColor, fontWeight: 800, fontSize: '0.76rem', letterSpacing: '0.04em' }}>
                {kindIcon(alert.kind)}
                <span>{KIND_LABELS[alert.kind]}</span>
              </div>
              <button
                type="button"
                aria-label="Dismiss popup alert"
                onClick={() => setQueue((prev) => prev.filter((item) => item.id !== alert.id))}
                style={{
                  background: 'transparent',
                  border: '1px solid #334155',
                  color: '#cbd5e1',
                  borderRadius: '6px',
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', alignItems: 'flex-start' }}>
              {alert.snapshotUrl && (
                <img
                  src={alert.snapshotUrl}
                  alt={alert.title}
                  style={{
                    width: '72px',
                    height: '72px',
                    objectFit: 'cover',
                    borderRadius: '6px',
                    border: `1px solid ${borderColor}`,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#ffffff' }}>{alert.title}</h3>
                <p style={{ margin: '0.3rem 0', fontSize: '0.86rem', color: '#e2e8f0', lineHeight: 1.35 }}>{alert.details}</p>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                  <span
                    className={`lunar-badge ${alert.severity}`}
                    style={{ fontWeight: 800, textTransform: 'uppercase' }}
                  >
                    <AlertTriangle size={11} style={{ marginRight: '3px' }} />
                    {alert.severity} priority
                  </span>
                  {alert.plate && (
                    <span className="lv-badge" style={{ fontWeight: 800, fontFamily: 'monospace' }}>
                      {alert.plate}
                    </span>
                  )}
                  {alert.subjectCode && (
                    <span className="lv-badge" style={{ fontWeight: 700 }}>
                      {alert.subjectCode}
                    </span>
                  )}
                  {typeof alert.confidence === 'number' && (
                    <span className="lv-badge" style={{ fontWeight: 700 }}>
                      {Math.round(alert.confidence)}% match
                    </span>
                  )}
                </div>
              </div>
            </div>

            {alert.recommendedAction && (
              <p
                style={{
                  margin: '0.55rem 0 0',
                  padding: '0.4rem 0.6rem',
                  borderLeft: `3px solid ${borderColor}`,
                  background: 'rgba(15, 23, 42, 0.75)',
                  fontSize: '0.8rem',
                  color: '#cbd5e1',
                  borderRadius: '4px',
                }}
              >
                <strong>Recommended action:</strong> {alert.recommendedAction}
              </p>
            )}

            <div className="lv-video-actions" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
              <button
                type="button"
                onClick={() => {
                  onOpenAlerts();
                  setQueue((prev) => prev.filter((item) => item.id !== alert.id));
                }}
              >
                <Bell size={13} style={{ marginRight: '4px' }} />
                View Alerts
              </button>
              {alert.eventId && onInspectEvent && (
                <button
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    onInspectEvent(alert.eventId!);
                    setQueue((prev) => prev.filter((item) => item.id !== alert.id));
                  }}
                >
                  Investigate Event
                </button>
              )}
              {alert.cameraId && onOpenCamera && (
                <button
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    onOpenCamera(alert.cameraId!);
                    setQueue((prev) => prev.filter((item) => item.id !== alert.id));
                  }}
                >
                  Open Camera
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>,
    document.body,
  );
}

