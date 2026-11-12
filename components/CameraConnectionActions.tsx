import React, { FormEvent, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { cameraSource } from '../services/cameraConnection';
import CameraSourceFields from './CameraSourceFields';
import type {SiteGateway} from './SiteGatewayPanel';

type ManagedCamera = {
  id: string; name: string; location: string; revision: number; minimum_clearance: number;
  playback_url: string | null; stream_type: string;
};

function actionError(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/changed|revision/i.test(message)) return 'This camera changed. Refresh the camera list before editing or removing it.';
  if (/unavailable|scope|clearance|permission/i.test(message)) return 'Camera management requires an active workspace owner or administrator with sufficient clearance.';
  return 'The camera could not be updated. Your details are retained. Check your connection and refresh the camera list before retrying.';
}

export default function CameraConnectionActions({camera, onChanged,gateways=[],gatewayId}: {camera: ManagedCamera; onChanged: (message?: string) => void;gateways?:SiteGateway[];gatewayId?:string|null}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const focusFeedback = () => requestAnimationFrame(() => feedback.current?.focus({preventScroll: true}));

  async function mutate(operation: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      await operation(); setMessage(success); onChanged(success); setConfirming(false);
    } catch (error) { setMessage(actionError(error)); setFailed(true); }
    finally { lock.current = false; setBusy(false); focusFeedback(); }
  }

  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const endpoint = String(fields.get('url') ?? '').trim();
    if (endpoint) {
      try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      } catch {
        setFailed(true); setMessage('Use an HTTPS playback URL without embedded credentials, or leave it blank while waiting for a gateway.'); focusFeedback(); return;
      }
    }
    void mutate(async () => {
      const {error} = await supabase.rpc('lv_configure_camera_connection', {
        target: camera.id, expected_revision: camera.revision,
        device_name: String(fields.get('name')).trim(), device_location: String(fields.get('location')).trim(),
        endpoint: endpoint || null, format: fields.get('stream_type'), clearance: Number(fields.get('clearance')),
      });
      if (error) throw error;
    }, 'Camera details saved. Connection credentials have not been tested.');
  }

  function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    let source: ReturnType<typeof cameraSource>;
    try { source = cameraSource(String(fields.get('source_url')), String(fields.get('source_username') ?? ''), String(fields.get('source_password') ?? '')); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Check the source URL.'); focusFeedback(); return; }
    void mutate(async () => {
      const {data, error} = await supabase.rpc('lv_store_camera_source', {target: camera.id, expected_revision: camera.revision, ...source});
      if (error) throw error;
      if (!data) throw new Error('No save confirmation');
      form.reset();
    }, 'Camera source and credentials replaced securely. Connection unverified: a gateway must test the password and provide playback.');
  }

  return <section aria-label={`Manage ${camera.name}`}>
    <div className="lv-video-actions">
      <button type="button" className="lv-secondary" aria-expanded={editing} disabled={busy} onClick={() => {setEditing(value => !value); setConfirming(false); setMessage('');}}>Edit camera</button>
      <button type="button" className="lv-secondary" disabled={busy} onClick={() => {setConfirming(true); setMessage('');}}>Remove camera</button>
      <button type="button" className="lv-secondary" disabled={busy} onClick={() => {setEditing(false); setConfirming(false); setMessage(''); onChanged();}}>Refresh camera</button>
    </div>
    {editing && <div>
      {gateways.length>0&&<form aria-label={`Assign site gateway for ${camera.name}`} onSubmit={event=>{
        event.preventDefault();const fields=new FormData(event.currentTarget);
        void mutate(async()=>{const {error}=await supabase.rpc('lv_assign_camera_gateway',{target:camera.id,expected_revision:camera.revision,selected_gateway:String(fields.get('gateway'))||null});if(error)throw error;},'Camera gateway assignment saved.');
      }}>
        <label>Site gateway<select name="gateway" defaultValue={gatewayId??''}><option value="">No gateway assigned</option>{gateways.filter(gateway=>gateway.enabled).map(gateway=><option key={gateway.id} value={gateway.id}>{gateway.name}</option>)}</select></label>
        <button disabled={busy}>Save gateway assignment</button>
      </form>}
      <form aria-label={`Edit details for ${camera.name}`} onSubmit={saveDetails}>
        <h4>Camera details &amp; playback</h4>
        <label>Camera name<input name="name" defaultValue={camera.name} required minLength={2} maxLength={100}/></label>
        <label>Location<input name="location" defaultValue={camera.location} maxLength={200}/></label>
        <label>HTTPS playback URL (optional)<input name="url" type="url" defaultValue={camera.playback_url ?? ''} maxLength={2048}/></label>
        <p>Leave playback blank for an unconnected IP camera. Saving a URL does not verify that the feed works.</p>
        <label>Stream format<select name="stream_type" defaultValue={camera.stream_type}><option value="video">MP4 / WebM</option><option value="hls">HLS</option><option value="mjpeg">MJPEG</option></select></label>
        <label>Minimum clearance<select name="clearance" defaultValue={camera.minimum_clearance}><option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option></select></label>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save camera details'}</button>
      </form>
      <form aria-label={`Replace credentials for ${camera.name}`} onSubmit={saveSource}>
        <h4>Correct camera URL or password</h4>
        <p>Re-enter the complete source URL and credentials. Existing passwords cannot be displayed. Replacing the source clears its old playback connection.</p>
        <CameraSourceFields/>
        <button disabled={busy}>{busy ? 'Saving…' : 'Replace camera credentials'}</button>
      </form>
    </div>}
    {confirming && <div className="lv-notice" role="group" aria-label={`Confirm removal of ${camera.name}`}>
      <p>Remove “{camera.name}”? This deletes its connection, encrypted credentials and camera configuration. Previously saved observations remain in history.</p>
      <button type="button" className="lv-secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel removal</button>{' '}
      <button type="button" className="lv-btn" disabled={busy} onClick={() => void mutate(async () => {
        const {data, error} = await supabase.rpc('lv_remove_camera', {target: camera.id, expected_revision: camera.revision});
        if (error) throw error;
        if (data !== camera.id) throw new Error('No removal confirmation');
      }, 'Camera removed.')}>{busy ? 'Removing…' : 'Confirm remove camera'}</button>
    </div>}
    {message && <p ref={feedback} tabIndex={-1} role={failed ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
