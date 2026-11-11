import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import VideoAnalysis from './VideoAnalysis';
import CameraChat from './CameraChat';
import { roleCan } from '../services/videoIntelligence';
import { CameraStream } from './CameraStream';
import CameraSourceFields from './CameraSourceFields';

type Camera = { id: string; name: string; location: string; playback_url: string | null; source_configured: boolean; stream_type: 'video' | 'hls' | 'mjpeg'; revision: number; minimum_clearance: number };
const columns = 'id,name,location,playback_url,source_configured,stream_type,revision,minimum_clearance';
const playbackLabels = {
  connecting: 'Connecting to the playback endpoint…',
  ready: 'Video is ready to play.',
  playing: 'Playing in this browser.',
  paused: 'Playback paused.',
  buffering: 'Waiting for video data…',
  ended: 'Playback finished.',
  error: 'The browser could not play this stream. Check the URL, video format, and camera gateway.',
};

export function WorkspaceCameras({
  workspaceId,
  canAdd,
  agency,
  initialCameraId,
  role = 'member',
  platformAdmin = false,
  onConfigureCamera,
  onInspectEvent,
}: {
  workspaceId: string;
  canAdd: boolean;
  agency: boolean;
  initialCameraId?: string;
  role?: string;
  platformAdmin?: boolean;
  onConfigureCamera?: (cameraId: string) => void;
  onInspectEvent?: (eventId: string) => void;
}) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [active, setActive] = useState<Camera>();
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playback, setPlayback] = useState<keyof typeof playbackLabels>('connecting');
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [inventoryFailed, setInventoryFailed] = useState(false);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [connectionMode, setConnectionMode] = useState('playback');
  const canConfigure = roleCan(role, 'configure', platformAdmin);
  const filteredCameras = cameras.filter((camera) =>
    (camera.name + ' ' + camera.location).toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setInventoryFailed(false);
    void supabase
      .from('lv_cameras')
      .select(columns)
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setInventoryFailed(true);
        else {
          const inventory = data as Camera[];
          setCameras(inventory);
          if (initialCameraId) {
            const selected = inventory.find(camera=>camera.id===initialCameraId);
            setActive(selected?.playback_url ? selected : undefined);
            if (selected && !selected.playback_url) setNotice('This camera source is saved, but a gateway playback URL has not been configured.');
          }
        }
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [workspaceId, initialCameraId, inventoryAttempt]);

  async function reportStreamOffline(cam: Camera) {
    try {
      const { data: cfg } = await supabase
        .from('lv_camera_intel_settings')
        .select('settings')
        .eq('camera_id', cam.id)
        .maybeSingle();
      const cameraHealthEnabled = (cfg?.settings as any)?.capabilities?.camera_health?.enabled ?? true;
      if (!cameraHealthEnabled) return;
      await supabase.rpc('lv_record_intel_events', {
        target: workspaceId,
        events: [
          {
            request_id: crypto.randomUUID(),
            camera: cam.id,
            source: 'camera',
            category: 'camera_offline',
            count: 1,
            occurred_at: new Date().toISOString(),
            payload: {
              camera_name: cam.name,
              camera_location: cam.location,
              summary: 'Camera playback stream failed to connect in browser',
            },
          },
        ],
      });
    } catch {
      // Ignore transient telemetry error
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd || saving || loading) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaving(true);
    setNotice('');
    try {
      if (connectionMode === 'source') {
        const {error}=await supabase.rpc('lv_register_camera_source',{target_workspace:workspaceId,camera_name:String(fields.get('name')).trim(),
          camera_location:String(fields.get('location')).trim(),clearance:Number(fields.get('minimum_clearance')),
          source_url:String(fields.get('source_url')).trim(),source_username:String(fields.get('source_username')),source_password:String(fields.get('source_password'))});
        if(error)throw new Error('Camera source could not be saved. Check the source URL, access and clearance. Enter credentials separately from the URL.');
        form.reset();setInventoryAttempt(value=>value+1);setNotice('Camera source saved encrypted in Supabase Vault. Playback awaits gateway configuration.');return;
      }
      const url = new URL(String(fields.get('url')).trim());
      if (url.protocol === 'rtsp:' || url.protocol === 'rtsps:') {
        throw new Error('RTSP cameras need a streaming gateway. Enter the gateway’s HTTPS HLS or MJPEG playback URL. Keep camera passwords on the gateway.');
      }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new Error('Enter an HTTPS camera or gateway URL without embedded username/password or a fragment. Signed query parameters are supported.');
      }
      const { data, error } = await supabase
        .from('lv_cameras')
        .insert({
          workspace_id: workspaceId,
          stream_type: fields.get('stream_type'),
          minimum_clearance: Number(fields.get('minimum_clearance')),
          name: String(fields.get('name')).trim(),
          location: String(fields.get('location')).trim(),
          playback_url: url.href,
        })
        .select(columns)
        .single();
      if (error) throw new Error('The camera could not be saved.');
      setCameras((previous) => [...previous, data as Camera]);
      setNotice('Camera registered.');
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The camera could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="lv-card">
      <h2>Cameras</h2>
      {cameras.length > 0 && (
        <div className="lv-observation-filters">
          <label>
            Search cameras
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
      )}
      {inventoryFailed ? (
        <p role="alert">
          Camera inventory could not be loaded.{' '}
          <button
            type="button"
            className="lv-secondary"
            onClick={() => setInventoryAttempt((attempt) => attempt + 1)}
          >
            Retry inventory
          </button>
        </p>
      ) : (
        <p>
          {loading
            ? 'Loading camera inventory…'
            : cameras.length === 0
              ? 'No cameras registered.'
              : !filteredCameras.length
                ? 'No cameras match this search.'
                : 'Select a camera to open its feed or configure per-camera analytics and zones.'}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {filteredCameras.map((camera) => (
        <article key={camera.id}>
          <h3>{camera.name}</h3>
          <p>{camera.location}</p>
          <p>Clearance {camera.minimum_clearance} · {camera.stream_type?.toUpperCase()}</p>
          {!camera.playback_url && <p>{camera.source_configured ? 'Encrypted source saved. Waiting for a gateway playback URL.' : 'No playback URL configured.'}</p>}
          <div className="lv-video-actions">
            <button
              type="button"
              className="lv-secondary"
              disabled={!camera.playback_url}
              onClick={() => {
                setPlayback('connecting');
                setFeedAttempt((attempt) => attempt + 1);
                setActive(camera);
              }}
            >
              Open feed
            </button>
            {onConfigureCamera && canConfigure && (
              <button type="button" className="lv-secondary" onClick={() => onConfigureCamera(camera.id)}>
                Configure analytics &amp; zones
              </button>
            )}
          </div>
          {canConfigure && <details><summary>Save or replace encrypted IP camera source</summary>
            <form onSubmit={async event=>{
              event.preventDefault();if(saving)return;const form=event.currentTarget;const fields=new FormData(form);setSaving(true);setNotice('');
              try {
                const {error}=await supabase.rpc('lv_store_camera_source',{target:camera.id,expected_revision:camera.revision,
                  source_url:String(fields.get('source_url')).trim(),source_username:String(fields.get('source_username')),source_password:String(fields.get('source_password'))});
                if(error)throw new Error('Source could not be saved. Refresh and check your camera URL, role and clearance.');
                form.reset();setActive(undefined);setInventoryAttempt(value=>value+1);setNotice('Source credentials saved encrypted. Configure the gateway playback URL to reconnect.');
              }catch(error){setNotice(error instanceof Error?error.message:'Source could not be saved.');}finally{setSaving(false);}
            }}><CameraSourceFields/><button disabled={saving}>Save encrypted source</button></form>
          </details>}
          {canConfigure && <details><summary>Edit connection &amp; access</summary><form onSubmit={async event=>{
            event.preventDefault(); if(saving)return; const fields=new FormData(event.currentTarget);setSaving(true);setNotice('');
            try {
              const url=new URL(String(fields.get('url')).trim());
              if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Enter an HTTPS playback or gateway URL without embedded credentials.');
              const {error}=await supabase.rpc('lv_configure_camera_connection',{target:camera.id,expected_revision:camera.revision,
                device_name:String(fields.get('name')).trim(),device_location:String(fields.get('location')).trim(),endpoint:url.href,
                format:fields.get('stream_type'),clearance:Number(fields.get('clearance'))});
              if(error)throw new Error(error.message);setActive(undefined);setInventoryAttempt(value=>value+1);setNotice('Camera connection and access saved.');
            }catch(error){setNotice(error instanceof Error?error.message:'Camera configuration failed.');}finally{setSaving(false);}
          }}>
            <label>Camera name<input name="name" defaultValue={camera.name} minLength={2} maxLength={100} required/></label>
            <label>Location<input name="location" defaultValue={camera.location} maxLength={200}/></label>
            <label>HTTPS playback URL<input name="url" type="url" defaultValue={camera.playback_url ?? ''} required maxLength={2048}/></label>
            <label>Stream format<select name="stream_type" defaultValue={camera.stream_type}><option value="video">MP4 / WebM</option><option value="hls">HLS</option><option value="mjpeg">MJPEG</option></select></label>
            <label>Minimum clearance<select name="clearance" defaultValue={camera.minimum_clearance}><option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option></select></label>
            <button disabled={saving}>Save camera connection</button>
          </form></details>}
        </article>
      ))}
      {active && (
        <article>
          <h3>{active.name}</h3>
          <CameraStream
            key={active.id + feedAttempt}
            src={active.playback_url ?? undefined}
            streamType={active.stream_type}
            onStreamReady={() => setPlayback('ready')}
            controls
            playsInline
            preload="auto"
            aria-label={active.name}
            style={{ width: '100%', maxHeight: 440 }}
            onLoadedData={() => setPlayback('ready')}
            onPlaying={() => setPlayback('playing')}
            onPause={() => setPlayback((previous) => (previous === 'error' ? previous : 'paused'))}
            onWaiting={() => setPlayback((previous) => (previous === 'error' ? previous : 'buffering'))}
            onEnded={() => setPlayback('ended')}
            onError={() => {
              setPlayback('error');
            }}
            onStreamError={() => setPlayback('error')}
          />
          <p role="status">{playbackLabels[playback]}</p>
          <div className="lv-video-actions">
            {playback === 'error' && (
              <button
                className="lv-secondary"
                type="button"
                onClick={() => {
                  setPlayback('connecting');
                  setFeedAttempt((attempt) => attempt + 1);
                }}
              >
                Retry feed
              </button>
            )}
            {onConfigureCamera && canConfigure && (
              <button type="button" className="lv-secondary" onClick={() => onConfigureCamera(active.id)}>
                Configure analytics &amp; zones
              </button>
            )}
            <button className="lv-secondary" type="button" onClick={() => setActive(undefined)}>
              Close feed
            </button>
          </div>
          <CameraChat
            key={active.id}
            camera={{ name: active.name, location: active.location, playback: playbackLabels[playback] }}
          />
        </article>
      )}
      <details onToggle={(event) => setShowAnalysis(event.currentTarget.open)}>
        <summary>Analyze footage</summary>
        {showAnalysis && (
          <VideoAnalysis
            key={active?.id ?? 'local'}
            cameraUrl={active?.stream_type === 'mjpeg' ? undefined : active?.playback_url ?? undefined}
            cameraId={active?.id}
            cameraName={active?.name}
            cameraLocation={active?.location}
            workspaceId={workspaceId}
            samples
            watchlistWorkspaceId={agency ? workspaceId : undefined}
            onInspectEvent={onInspectEvent}
          />
        )}
      </details>
      {canAdd && (
        <form onSubmit={add}>
          <label>Connection setup<select value={connectionMode} onChange={event=>setConnectionMode(event.target.value)}>
            <option value="playback">Browser-ready playback URL</option><option value="source">IP camera URL + encrypted credentials</option>
          </select></label>
          <label>
            Camera name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            Location
            <input name="location" maxLength={200} />
          </label>
          {connectionMode === 'playback' && <label>
            Stream format
            <select name="stream_type"><option value="video">MP4 / WebM video</option><option value="hls">HLS camera gateway (.m3u8)</option><option value="mjpeg">MJPEG live feed</option></select>
          </label>}
          <label>Minimum clearance<select name="minimum_clearance" defaultValue="0"><option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option></select></label>
          <p>{connectionMode === 'source' ? 'Connection settings are persisted encrypted in Supabase Vault. A trusted gateway connector must load the source and provide a browser-ready playback URL.' : 'Use an HTTPS feed or gateway that converts IP camera video to HLS or MJPEG. H.264 video is recommended. To store a raw camera URL and password securely, choose IP camera URL + encrypted credentials above.'}</p>
          {connectionMode === 'source' ? <CameraSourceFields/> : <label>
            HTTPS playback URL
            <input name="url" type="url" required maxLength={2048} />
          </label>}
          <button disabled={saving || loading}>Add camera</button>
        </form>
      )}
    </section>
  );
}
