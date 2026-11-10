import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CirclePlay, Clock3, Shield, Video } from 'lucide-react';
import { MeridianPreviewMap } from '../components/MeridianPreviewMap';

type Navigate = (page: string) => void;

const cameras = [
  { name: 'North Gate', id: 'CAM-017', image: 'north-gate', status: 'Online' },
  { name: 'Container Yard', id: 'CAM-024', image: 'container-yard', status: 'Online' },
  { name: 'Berth 02', id: 'CAM-041', image: 'berth-02', status: 'Degraded' },
  { name: 'Truck Checkpoint', id: 'CAM-033', image: 'checkpoint', status: 'Online' },
];

const events = [
  { name: 'Perimeter intrusion', source: 'North Gate / CAM-017', time: '22:14', severity: 'High' },
  { name: 'Camera link degraded', source: 'Berth 02 / CAM-041', time: '22:08', severity: 'Medium' },
  { name: 'Vehicle dwell exceeded', source: 'Truck Checkpoint / CAM-033', time: '21:56', severity: 'Medium' },
  { name: 'Restricted line crossing', source: 'Container Yard / CAM-024', time: '21:41', severity: 'Info' },
  { name: 'Edge gateway restored', source: 'Meridian Port / EDGE-02', time: '21:24', severity: 'Info' },
];

const concepts: Record<string, { title: string; description: string }> = {
  playback: { title: 'Playback', description: 'Review recordings, event markers and clip ranges.' },
  evidence: { title: 'Evidence vault', description: 'Review media, retention and chain of custody.' },
  vehicles: { title: 'Vehicle intelligence', description: 'Review checkpoint plate reads and their source images.' },
  rules: { title: 'AI rules and zones', description: 'Review how detection conditions and zones produce alerts.' },
  access: { title: 'Access and audit', description: 'Review team roles, scope and sensitive activity.' },
  integrations: { title: 'Integrations', description: 'Review scoped connectors for a sovereign deployment.' },
};

export function LunarConcept({ page, onPreview }: { page: string; onPreview: () => void }) {
  const concept = concepts[page];
  if (!concept) return null;
  return <div className="lunar-view">
    <Heading title={concept.title} subtitle={concept.description} />
    <section className="lunar-panel lunar-unavailable">
      <Shield size={26} />
      <h2>Design preview available</h2>
      <p>This workspace has no live connection for {concept.title.toLowerCase()}.</p>
      <button className="lunar-button lunar-primary" onClick={onPreview}>Open sample workspace <ArrowRight size={16} /></button>
    </section>
  </div>;
}

function Heading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <header className="lunar-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header>;
}

function Button({ children, onClick, primary = false }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={'lunar-button' + (primary ? ' lunar-primary' : '')}>{children}</button>;
}

function Metrics({ values }: { values: [string, string, string][] }) {
  return <div className="lunar-metrics">{values.map(([name, value, detail]) =>
    <div className="lunar-panel lunar-metric" key={name}><small>{name}</small><strong>{value}</strong><span>{detail}</span></div>)}</div>;
}

function Feed({ index = 0, mode = 'Demo feed' }: { index?: number; mode?: string }) {
  const camera = cameras[index];
  return <figure className="lunar-feed">
    <img src={'/lunar/' + camera.image + '.webp'} alt={'Simulated camera view of ' + camera.name} />
    <div><span>{mode}</span><time>22:14:35 WAT</time></div>
    <figcaption>{camera.name} / {camera.id}</figcaption>
  </figure>;
}

function EventList({ onSelect, selected }: { onSelect: (i: number) => void; selected?: number }) {
  return <div className="lunar-event-list">{events.map((event, i) =>
    <button key={event.name} type="button" data-selected={selected === i} onClick={() => onSelect(i)}>
      <i className={'lunar-severity ' + event.severity.toLowerCase()} />
      <div><strong>{event.name}</strong><small>{event.source}</small></div>
      <div><span className={'lunar-badge ' + event.severity.toLowerCase()}>{event.severity}</span><time>{event.time}</time></div>
    </button>)}</div>;
}

function Table({ title, columns, rows }: { title: string; columns: string[]; rows: string[][] }) {
  return <section className="lunar-panel lunar-table">
    <h2>{title}</h2><div><table><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>
  </section>;
}

function Details({ title, rows, children }: { title: string; rows: [string, string][]; children?: React.ReactNode }) {
  return <section className="lunar-panel lunar-detail"><h2>{title}</h2><dl>{rows.map(([key, value]) =>
    <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{children}</section>;
}

function Onboarding({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="lunar-onboarding" ref={dialog} aria-labelledby="lunar-onboarding-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="lunar-page-heading"><div><h2 id="lunar-onboarding-title">Add a camera</h2>
      <p>Connect a device discovered by the site gateway.</p></div>
      <button type="button" className="lunar-icon" onClick={onClose} aria-label="Close onboarding">×</button>
    </div>
    <ol><li>01 / Discover</li><li aria-current={verified ? undefined : 'step'}>02 / Configure</li><li aria-current={verified ? 'step' : undefined}>03 / Verify</li></ol>
    <Details title="Discovered device" rows={[['Device name', 'South Perimeter'], ['Site', 'Meridian Port'], ['Gateway', 'EDGE-02 · Gatehouse'], ['Camera protocol', 'ONVIF / RTSP'], ['Serial', 'CAM-061 · LV-0061 · H.264']]} />
    <p role="status">{verified ? 'Sample stream verified in the design preview.' : 'Illustrative configuration using a sample device.'}</p>
    <div className="lunar-actions"><Button onClick={onClose}>{verified ? 'Done' : 'Cancel'}</Button>
      {!verified && <Button primary onClick={() => setVerified(true)}>Verify sample stream</Button>}</div>
  </dialog>;
}

export function LunarPreview({ page, navigate }: { page: string; navigate: Navigate }) {
  const [camera, setCamera] = useState(0);
  const [cameraDetail, setCameraDetail] = useState(false);
  const [siteMap, setSiteMap] = useState(false);
  const [selected, setSelected] = useState(0);
  const [alertDetail, setAlertDetail] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [acknowledged, setAcknowledged] = useState<number[]>([]);
  const [cursor, setCursor] = useState(35);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const event = events[selected];
  const openMapCamera = (index: number) => {
    setCamera(index);
    setCameraDetail(true);
    navigate('surveillance');
  };
  const openMapAlert = () => {
    setSelected(0);
    setAlertDetail(true);
    navigate('detection_history');
  };
  let content: React.ReactNode;

  switch (page) {
    case 'surveillance':
      content = <><Heading title="Live cameras" subtitle="Meridian Port / Perimeter and yard"
        action={<Button onClick={() => navigate('playback')}>Open playback <CirclePlay size={15} /></Button>} />
        <div className="lunar-tabs">{['Perimeter and yard', 'Camera detail'].map((label, i) =>
          <button key={label} aria-pressed={i === Number(cameraDetail)} onClick={() => setCameraDetail(i === 1)}>{label}</button>)}</div>
        {cameraDetail ? <Feed index={camera} /> : <div className="lunar-camera-grid">{cameras.map((item, i) =>
          <button type="button" key={item.id} aria-label={'View ' + item.name} onClick={() => { setCamera(i); setCameraDetail(true); }}><Feed index={i} /></button>)}</div>}
        <div className="lunar-mobile-only lunar-panel lunar-detail lunar-camera-group">
          <h2>Camera group</h2>
          <div className="lunar-event-list">{cameras.map((item, i) => <button key={item.id} onClick={() => { setCamera(i); setCameraDetail(true); }}>
            <i className={'lunar-severity ' + (item.status === 'Online' ? '' : 'medium')} />
            <div><strong>{item.name}</strong><small>{item.id} / {item.status}</small></div><ArrowRight size={14} />
          </button>)}</div>
        </div></>;
      break;
    case 'playback':
      content = <><Heading title="Playback" subtitle="Meridian Port / North Gate" />
        <div className="lunar-split"><div><Feed mode="Recording preview" /><section className="lunar-panel lunar-timeline">
          <div><Clock3 size={15} /><output>22:14:{String(cursor).padStart(2, '0')} WAT</output></div>
          <input aria-label="Sample playback position" type="range" min="0" max="59" value={cursor} onChange={e => setCursor(Number(e.target.value))} />
        </section></div><Details title="Recording details" rows={[['Camera', 'North Gate / CAM-017'], ['Recording mode', 'Continuous'], ['Clip range', '22:14:12 – 22:14:58 WAT'], ['Incident', 'INC-1042']]}>
          <Button onClick={() => navigate('cases')}>Open linked incident</Button></Details></div></>;
      break;
    case 'detection_history':
      content = <><Heading title="Alert triage" subtitle="Meridian Port / Review priority events" />
        <div className="lunar-split lunar-alert-split lunar-preview-alerts" data-detail={alertDetail}><section className="lunar-panel lunar-alert-list"><h2>Alert queue</h2><EventList selected={selected} onSelect={i => { setSelected(i); setAlertDetail(true); }} /></section>
          <section className="lunar-panel lunar-detail lunar-alert-detail"><div className="lunar-mobile-only"><Button onClick={() => setAlertDetail(false)}>Back to alert queue</Button></div><span className={'lunar-badge ' + event.severity.toLowerCase()}>{event.severity}</span>
            <h2>{event.name}</h2><p>{event.source} · {event.time} WAT</p>
            <Feed index={selected === 1 ? 2 : selected === 2 ? 3 : selected === 3 ? 1 : 0} mode="Event preview" />
            <div className="lunar-actions">
              {acknowledged.includes(selected) ? <span className="lunar-confirm"><CheckCircle2 size={15} /> Acknowledged in preview</span> :
                <Button primary onClick={() => setAcknowledged([...acknowledged, selected])}>Acknowledge alert</Button>}
              <Button onClick={() => navigate('cases')}>Open incident</Button>
            </div>
          </section></div></>;
      break;
    case 'cases':
      content = <><Heading title="Incident workspace" subtitle="Meridian Port / Incident management" />
        <div className="lunar-split lunar-alert-split">
          <section className="lunar-panel"><h2>Incident queue</h2><div className="lunar-event-list"><button type="button" data-selected="true"><i className="lunar-severity high" /><div><strong>North Gate intrusion</strong><small>INC-1042 / Meridian Port</small></div><span className="lunar-badge high">High</span></button></div></section>
          <Details title="North Gate intrusion" rows={[['Assigned to', 'Team Delta'], ['Zone', 'North Gate / Z-04'], ['22:14:35 WAT', 'Detection recorded'], ['22:15:02 WAT', 'Alert acknowledged'], ['22:16:08 WAT', 'Camera clip linked'], ...(savedNote ? [['Response note', savedNote] as [string, string]] : [])]}>
            {adding ? <form className="lunar-note" onSubmit={e => { e.preventDefault(); if (note.trim()) { setSavedNote(note.trim()); setAdding(false); } }}>
              <label htmlFor="preview-note">Response note</label><textarea id="preview-note" required value={note} onChange={e => setNote(e.target.value)} />
              <button className="lunar-button lunar-primary" type="submit">Save preview note</button></form> :
              <div className="lunar-actions"><Button primary onClick={() => setAdding(true)}>Add response note</Button><Button onClick={() => navigate('evidence')}>View evidence</Button></div>}
          </Details>
        </div></>;
      break;
    case 'evidence':
      content = <><Heading title="Evidence vault" subtitle="Meridian Port / Incident INC-1042" />
        <div className="lunar-split"><div><Table title="Incident evidence" columns={['Evidence', 'Source', 'Captured WAT', 'Status']} rows={[
          ['EV-3201', 'CAM-017 / North Gate', '22:14:12', 'Verified'], ['EV-3202', 'BC-006 / Team Delta', '22:17:04', 'Verified'], ['EV-3203', 'CAM-017 / Snapshot', '22:14:35', 'Verified'],
        ]} /><Details title="Chain of custody" rows={[['22:14:58', 'Camera clip sealed by edge gateway'], ['22:16:08', 'Clip linked to INC-1042'], ['22:21:47', 'BodyCam upload synced']]} /></div>
          <section className="lunar-panel lunar-detail"><h2>EV-3201</h2><Feed mode="Evidence preview" /><p>Incident hold active · Export requires approval</p></section></div></>;
      break;
    case 'vehicles':
      content = <><Heading title="Vehicle intelligence" subtitle="Meridian Port / Truck Checkpoint ANPR" />
        <Metrics values={[[ 'Reads this shift', '386', '4 cameras'], ['Review queue', '07', 'Low confidence'], ['Authorized list', '02', 'Matches this shift']]} />
        <div className="lunar-split"><Table title="Recent plate reads" columns={['Plate reference', 'Captured WAT', 'Source', 'Confidence', 'Review']}
          rows={[['DEMO-083', '22:15:49', 'Truck Checkpoint', '97%', 'Cleared'], ['DEMO-071', '22:13:05', 'Truck Checkpoint', '82%', 'Review'], ['DEMO-110', '22:11:22', 'Service Road', '93%', 'Cleared']]} />
          <section className="lunar-panel lunar-detail"><h2>Read detail / DEMO-071</h2><Feed index={3} mode="Snapshot preview" /><p>Manual review required before linking this read to an incident.</p></section></div></>;
      break;
    case 'camera_management':
      content = <><Heading title="Device fleet" subtitle="Meridian Port / Cameras, gateways and BodyCams" action={<Button primary onClick={() => setOnboarding(true)}>Add device</Button>} />
        <Metrics values={[[ 'Cameras online', '46 / 48', '2 need attention'], ['Edge gateways', '04 / 04', 'All healthy'], ['BodyCams synced', '08 / 09', '1 offline']]} />
        <Table title="Inventory" columns={['Device', 'Name', 'Site', 'Status']} rows={cameras.map(item => [item.id, item.name, 'Meridian Port', item.status])} />
        {onboarding && <Onboarding onClose={() => setOnboarding(false)} />}</>;
      break;
    case 'rules':
      content = <><Heading title="AI rules and zones" subtitle="Meridian Port / North Gate · CAM-017" />
        <div className="lunar-split"><section className="lunar-panel lunar-detail"><h2>Zone editor</h2><div className="lunar-zone"><Feed mode="Zone preview" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="58,77 79,42 96,37 96,65" /></svg></div></section>
          <Details title="North Gate after-hours" rows={[['When', 'Person enters zone'], ['Zone', 'Z-04 · North Gate'], ['Schedule', '22:00 – 06:00 WAT'], ['Minimum confidence', '85%'], ['Then', 'Create high-priority alert']]} /></div></>;
      break;
    case 'analytics':
      content = <><Heading title="Operations analytics" subtitle="Meridian Port / Last 24 hours" />
        <Metrics values={[[ 'Events', '128', 'All categories'], ['Acknowledged', '96%', 'Active shift'], ['Median ack time', '42 sec', 'Active shift'], ['Camera uptime', '98.6%', '24-hour average']]} />
        <div className="lunar-split"><section className="lunar-panel lunar-detail"><h2>Events by hour</h2><div className="lunar-chart" role="img" aria-label="Sample hourly detections, highest at 22:00">
          {[2,3,2,1,3,2,4,5,6,7,10,9,8,6,7,4,4,4,4,5,6,8,13,5].map((n, i) => <span key={i} title={i + ':00 WAT — ' + n + ' events'} style={{ height: n * 7 + '%' }} />)}
        </div><p>00:00 – 23:00 WAT</p></section><Details title="Event mix" rows={[['Line crossing', '52'], ['Vehicle dwell', '34'], ['Camera health', '26'], ['Zone intrusion', '16']]} /></div></>;
      break;
    case 'access':
      content = <><Heading title="Access and audit" subtitle="Meridian Port / Organization administration" />
        <Table title="Workspace access" columns={['Member', 'Role', 'Site scope', 'Status']} rows={[
          ['Ada Okafor', 'Shift supervisor', 'Meridian Port', 'Active'], ['Tunde Bello', 'Investigator', 'Meridian Port', 'Active'], ['Team Delta', 'Field responder', 'North Gate', 'Active'],
        ]} /><Table title="Recent audit activity" columns={['WAT', 'Action', 'Actor', 'Resource', 'Outcome']} rows={[
          ['22:16:08', 'Evidence attached', 'Ada Okafor', 'EV-3201', 'Allowed'], ['22:15:41', 'Incident assigned', 'Ada Okafor', 'INC-1042', 'Allowed'],
        ]} /></>;
      break;
    case 'integrations':
      content = <><Heading title="Integrations" subtitle="Meridian Port / Sovereign deployment" />
        <div className="lunar-split lunar-alert-split"><Details title="Connectors" rows={[['Identity Gateway', 'Sandbox concept'], ['BodyCam evidence', 'Demo'], ['Traffic agency API', 'Disabled'], ['Incident webhooks', 'Demo']]} />
          <Details title="Authorized identity verification" rows={[['Approved purpose', 'Controlled site access'], ['Approval reference', 'AUTH-DEMO-042'], ['Access record', 'ACCESS-DEMO-018'], ['Verification token', 'DEMO-TOKEN-084']]}>
            <p>No agency connection. All values are fictional.</p></Details></div></>;
      break;
    default:
      content = <><div className="lunar-mobile-only lunar-shift">
          <Heading title={siteMap ? 'Site map' : 'Shift home'} subtitle="Meridian Port / Field operations" />
          {siteMap ? <>
            <MeridianPreviewMap onCamera={openMapCamera} onAlert={openMapAlert} onZone={() => navigate('rules')} priorityActive={!acknowledged.includes(0)} />
            <Button onClick={() => setSiteMap(false)}>Back to shift home</Button>
          </> : <>
            <span className="lunar-badge">On shift</span>
            <Metrics values={[[ 'Cameras', '46 / 48', 'Online'], ['Open alerts', String(3 - acknowledged.filter(i => i < 3).length).padStart(2, '0'), 'Meridian Port']]} />
            <section className="lunar-panel lunar-detail"><h2>Priority alert</h2><Button onClick={() => { setSelected(0); setAlertDetail(true); navigate('detection_history'); }}>Perimeter intrusion <ArrowRight size={14} /></Button></section>
            <section className="lunar-panel lunar-detail"><h2>Assigned to your team</h2><Button onClick={() => navigate('cases')}>INC-1042 / North Gate <ArrowRight size={14} /></Button></section>
            <Button onClick={() => setSiteMap(true)}>View site map</Button>
          </>}
        </div><div className="lunar-desktop-only lunar-view">
        <Heading title="Command centre" subtitle="Meridian Port / All sectors" action={<Button primary onClick={() => navigate('cases')}>Open incident</Button>} />
        <Metrics values={[[ 'Cameras online', '46 / 48', '2 need attention'], ['Open alerts', String(3 - acknowledged.filter(i => i < 3).length).padStart(2, '0'), '1 high priority in sample'], ['Active incidents', '01', 'INC-1042'], ['Edge gateways', '04 / 04', 'Last sync 22:16']]} />
        <div className="lunar-split"><MeridianPreviewMap onCamera={openMapCamera} onAlert={openMapAlert} onZone={() => navigate('rules')} priorityActive={!acknowledged.includes(0)} />
          <section className="lunar-panel"><h2>Priority events <span className="lunar-badge">Sample</span></h2>
            <EventList onSelect={i => { setSelected(i); navigate('detection_history'); }} />
            <div className="lunar-panel-action"><Button onClick={() => navigate('detection_history')}>Open alert queue</Button></div></section></div>
        <div className="lunar-map-key"><span><Video size={14} /> Camera</span><span><i className="lunar-severity high" /> Priority event</span><span><i className="lunar-map-key-coverage" /> Coverage</span><span><i className="lunar-map-key-zone" /> Restricted zone</span></div></div></>;
  }
  return <div className="lunar-view">{content}</div>;
}

