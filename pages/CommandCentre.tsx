import React, { useEffect, useState } from 'react';
import { ArrowRight, Map } from 'lucide-react';
import { getCameras } from '../services/cameraService';
import { getAlertsWithDetails } from '../services/alertService';
import { AlertStatus, Camera, CameraStatus, SurveillanceAlertWithDetails, Suspect } from '../types';
import { GlobalMap } from './GlobalMap';

const time = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function CommandCentre({ navigate, editSuspect }: {
  navigate: (page: string) => void;
  editSuspect: (suspect: Suspect) => void;
}) {
  const [cameras, setCameras] = useState<Camera[]>();
  const [alerts, setAlerts] = useState<SurveillanceAlertWithDetails[]>();
  const [pending, setPending] = useState(true);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let current = true;
    Promise.allSettled([getCameras(), getAlertsWithDetails({ status: AlertStatus.UNREAD, pageSize: 6 })])
      .then(([cameraResult, alertResult]) => {
        if (!current) return;
        setCameras(cameraResult.status === 'fulfilled' ? cameraResult.value : undefined);
        setAlerts(alertResult.status === 'fulfilled' ? alertResult.value : undefined);
        setPending(false);
      });
    return () => { current = false; };
  }, [request]);

  const online = cameras?.filter(camera => camera.status === CameraStatus.ONLINE || camera.status === CameraStatus.RECORDING).length;
  const offline = cameras?.filter(camera => camera.status === CameraStatus.OFFLINE).length;

  return <div className="lunar-view">
    <header className="lunar-page-heading">
      <div><h1>Command centre</h1><p>Operations workspace / All sectors</p></div>
      <button className="lunar-button lunar-primary" onClick={() => navigate('cases')}>Open incidents <ArrowRight size={16} /></button>
    </header>
    <div className="lunar-metrics">
      {[
        ['Cameras online', cameras ? online + ' / ' + cameras.length : '—', 'Reported camera status'],
        ['Offline cameras', offline ?? '—', 'Registered inventory'],
        ['Unread alerts', alerts ? alerts.length === 6 ? '6+' : alerts.length : '—', 'Recent queue'],
        ['Workspace', 'Operations', 'Lunar Vision'],
      ].map(([label, value, caption]) => <div className="lunar-panel lunar-metric" key={label}><small>{label}</small><strong>{value}</strong><span>{caption}</span></div>)}
    </div>
    <div className="lunar-split">
      <section className="lunar-panel lunar-embedded-map" aria-label="Operations map"><GlobalMap onEditSuspect={editSuspect} compact /></section>
      <section className="lunar-panel">
        <h2>Priority events</h2>
        <div className="lunar-event-list">
          {pending ? <p className="lunar-panel-message" role="status">Loading event records…</p> :
            !alerts ? <p className="lunar-panel-message">Alert records could not be loaded.</p> :
            alerts.length === 0 ? <p className="lunar-panel-message">No unread alerts.</p> :
            alerts.map(alert => <button key={alert.id} onClick={() => navigate('detection_history')}>
              <i className="lunar-severity medium" /><div><strong>{alert.camera?.name ?? 'Camera alert'}</strong><small>Unread detection alert</small></div>
              <time>{time.format(new Date(alert.createdAt))}</time></button>)}
        </div>
        <div className="lunar-panel-action lunar-actions">
          <button className="lunar-button" onClick={() => navigate('detection_history')}>Open alert queue</button>
          {!pending && (!cameras || !alerts) && <button className="lunar-button" onClick={() => { setPending(true); setRequest(request + 1); }}>Retry</button>}
        </div>
      </section>
    </div>
    <div className="lunar-map-key"><Map size={14} /> Operational map · WAT</div>
  </div>;
}

