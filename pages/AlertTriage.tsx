import React, { useEffect, useState } from 'react';
import { Bell, History } from 'lucide-react';
import { acknowledgeAlert, getAlertsWithDetails } from '../services/alertService';
import { AlertStatus, SurveillanceAlertWithDetails } from '../types';

const timestamp = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lagos',
});

function isOpen(alert: SurveillanceAlertWithDetails) {
  return alert.status === AlertStatus.UNREAD || alert.status === AlertStatus.READ;
}

export function AlertTriage({ officerId, onHistory, onCase }: {
  officerId: string; onHistory: () => void; onCase: (caseId: string) => void;
}) {
  const [alerts, setAlerts] = useState<SurveillanceAlertWithDetails[]>([]);
  const [tab, setTab] = useState<'Unresolved' | 'Acknowledged' | 'All alerts'>('Unresolved');
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    getAlertsWithDetails({ pageSize: 50 }).then(result => {
      if (current) setAlerts(result);
    }).catch(() => {
      if (current) setError('Alert records could not be loaded.');
    }).finally(() => {
      if (current) setPending(false);
    });
    return () => { current = false; };
  }, [attempt]);

  const shown = alerts.filter(alert => tab === 'All alerts' || (tab === 'Unresolved' ? isOpen(alert) : !isOpen(alert)));
  const selected = shown.find(alert => alert.id === selectedId) ?? shown[0];

  async function acknowledge(alert: SurveillanceAlertWithDetails) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await acknowledgeAlert(alert.id, officerId);
      setAlerts(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item));
      setNotice('Alert acknowledged.');
    } catch {
      setError('Could not acknowledge this alert. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="lunar-view">
    <header className="lunar-page-heading">
      <div><h1>Alert triage</h1><p>Operations workspace / Recent surveillance alerts</p></div>
      <button className="lunar-button" onClick={onHistory}><History size={15} /> Detection history</button>
    </header>
    <div className="lunar-tabs">{(['Unresolved', 'Acknowledged', 'All alerts'] as const).map(label =>
      <button key={label} aria-pressed={tab === label} onClick={() => { setTab(label); setNotice(''); }}>{label}</button>)}</div>
    {error && <div className="lunar-panel lunar-panel-action lunar-actions" role="alert">
      <span>{error}</span><button className="lunar-button" onClick={() => { setError(''); setPending(true); setAttempt(attempt + 1); }}>Refresh records</button>
    </div>}
    {notice && <p className="lunar-confirm" role="status">{notice}</p>}
    <div className="lunar-split lunar-alert-split">
      <section className="lunar-panel">
        <h2>Alert queue</h2>
        <div className="lunar-event-list">
          {pending ? <p className="lunar-panel-message">Loading alerts…</p> :
            shown.length ? shown.map(alert => <button key={alert.id} data-selected={alert.id === selected?.id} onClick={() => setSelectedId(alert.id)}>
              <i className={'lunar-severity ' + (isOpen(alert) ? 'medium' : 'info')} />
              <div><strong>{alert.camera?.name ?? 'Camera alert'}</strong><small>{alert.status.replaceAll('_', ' ').toLowerCase()}</small></div>
              <time>{timestamp.format(new Date(alert.createdAt))} WAT</time>
            </button>) : <p className="lunar-panel-message">{error ? 'Records unavailable.' : 'No alerts in this view.'}</p>}
        </div>
      </section>
      <section className="lunar-panel lunar-detail">
        {selected ? <>
          <span className="lunar-badge">{selected.status.replaceAll('_', ' ')}</span>
          <h2>{selected.camera?.name ?? 'Surveillance alert'}</h2>
          <p>{timestamp.format(new Date(selected.createdAt))} WAT</p>
          {selected.detection?.snapshotUrl && <figure className="lunar-record-image">
            <img src={selected.detection.snapshotUrl} alt="Captured event frame" />
            <figcaption>Event snapshot</figcaption>
          </figure>}
          <div className="lunar-actions">
            {isOpen(selected) && <button className="lunar-button lunar-primary" disabled={saving || pending} onClick={() => acknowledge(selected)}>Acknowledge alert</button>}
            {selected.linkedCaseId && <button className="lunar-button" onClick={() => onCase(selected.linkedCaseId!)}>Open linked incident</button>}
          </div>
        </> : <><Bell size={20} /><p>Select an alert to review its source record.</p></>}
      </section>
    </div>
  </div>;
}

