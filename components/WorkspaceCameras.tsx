import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import VideoAnalysis from './VideoAnalysis';
import CameraChat from './CameraChat';
import { roleCan } from '../services/videoIntelligence';
import { CameraStream } from './CameraStream';
import CameraSourceFields from './CameraSourceFields';
import CameraConnectionActions from './CameraConnectionActions';
import GatewayCameraFeed from './GatewayCameraFeed';
import SiteGatewayPanel,{type SiteGateway} from './SiteGatewayPanel';
import {cameraConnectionLabel,useCameraConnectionStates} from '../services/cameraGateway';
import {cameraSource,cameraRegistrationError} from '../services/cameraConnection';
import { LocationPicker, type RecordPosition } from './RecordLocation';

type Camera = { id: string; name: string; location: string; latitude?: number | null; longitude?: number | null; playback_url: string | null; source_configured: boolean; stream_type: 'video' | 'hls' | 'mjpeg'; revision: number; minimum_clearance: number };
const columns = 'id,name,location,latitude,longitude,playback_url,source_configured,stream_type,revision,minimum_clearance';
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
  const [gatewayFeed,setGatewayFeed]=useState<Camera>();
  const connections=useCameraConnectionStates(workspaceId);
  const [gateways,setGateways]=useState<SiteGateway[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playback, setPlayback] = useState<keyof typeof playbackLabels>('connecting');
  const [feedAttempt, setFeedAttempt] = useState(0);
  const [inventoryFailed, setInventoryFailed] = useState(false);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [connectionMode, setConnectionMode] = useState('source');
  const [registrationMessage,setRegistrationMessage]=useState('');
  const [registrationFailed,setRegistrationFailed]=useState(false);
  const registrationFeedback=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{
    if(registrationMessage){registrationFeedback.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});registrationFeedback.current?.focus({preventScroll:true});}
  },[registrationMessage]);
  const [cameraLocation, setCameraLocation] = useState<RecordPosition | null>(null);
  const [pinDrafts, setPinDrafts] = useState<Record<string, RecordPosition | null>>({});
  const registrationForm = useRef<HTMLFormElement>(null);
  const registrationId = `camera-registration-${workspaceId}`;
  function showRegistration() {
    registrationForm.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    registrationForm.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus({preventScroll: true});
  }
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
            if (selected?.playback_url) setShowAnalysis(true);
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
    setRegistrationMessage('');setRegistrationFailed(false);
    try {
      const rawUrl=String(fields.get(connectionMode==='source'?'source_url':'url')??'').trim();
      if (connectionMode === 'source' || /^r(?:ts|st)ps?:/i.test(rawUrl)) {
        const connection=cameraSource(rawUrl,String(fields.get('source_username')??''),String(fields.get('source_password')??''));
        const {data,error}=await supabase.rpc('lv_register_camera_source',{target_workspace:workspaceId,camera_name:String(fields.get('name')).trim(),
          camera_location:String(fields.get('location')).trim(),clearance:Number(fields.get('minimum_clearance')),
          ...connection});
        if(error)throw new Error(cameraRegistrationError(error));
        if(!data)throw new Error('The server did not confirm camera registration. Refresh the camera list before retrying.');
        let locationSaved=true;
        if(cameraLocation){
          try {
            const {data:pin,error:pinError}=await supabase.from('lv_cameras')
              .update({latitude:cameraLocation.latitude,longitude:cameraLocation.longitude})
              .eq('workspace_id',workspaceId).eq('id',data).select('id').single();
            locationSaved=!pinError&&Boolean(pin);
          }catch{locationSaved=false;}
        }
        const result='Camera source saved encrypted in Supabase Vault. Connection unverified: the password has not been tested. Playback awaits gateway configuration.'+
          (locationSaved?'':' The camera was saved, but its map location could not be saved. Update the saved camera’s map pin; do not register it again.');
        setRegistrationFailed(!locationSaved);
        form.reset();setCameraLocation(null);setInventoryAttempt(value=>value+1);setNotice(result);setRegistrationMessage(result);return;
      }
      const url = new URL(String(fields.get('url')).trim());
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
      if (error) throw new Error(cameraRegistrationError(error));
      let savedCamera = data as Camera;
      if (cameraLocation) {
        const { data: geoData, error: geoError } = await supabase
          .from('lv_cameras')
          .update({ latitude: cameraLocation.latitude, longitude: cameraLocation.longitude })
          .eq('workspace_id', workspaceId)
          .eq('id', savedCamera.id)
          .select(columns)
          .single();
        if (!geoError && geoData) savedCamera = geoData as Camera;
      }
      setCameras((previous) => [...previous, savedCamera]);
      setCameraLocation(null);
      setNotice('Camera registered.');
      setRegistrationMessage('Camera registered.');
      form.reset();
    } catch (error) {
      const message=error instanceof Error ? error.message : 'The camera could not be saved.';
      setNotice(message);setRegistrationMessage(message);setRegistrationFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="lv-card">
      <div className="lv-panel-head">
        <div><h2>Cameras</h2><p>Register camera connections and open available feeds.</p></div>
        {canAdd && <button type="button" className="lv-btn lv-btn-primary" aria-controls={registrationId} disabled={loading || saving} onClick={showRegistration}>Add camera</button>}
      </div>
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
              ? canAdd ? 'No cameras registered. Use Add camera to connect your first device.' : 'No cameras registered. Ask your workspace owner or administrator to add a camera.'
              : !filteredCameras.length
                ? 'No cameras match this search.'
                : 'Select a camera to open its feed or configure per-camera analytics and zones.'}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <SiteGatewayPanel workspaceId={workspaceId} canManage={canConfigure} onGateways={setGateways} onPaired={()=>setInventoryAttempt(value=>value+1)}/>
      {filteredCameras.map((camera) => (
        <article key={camera.id}>
          <h3>{camera.name}</h3>
          <p>{camera.location}</p>
          <p>
            Clearance {camera.minimum_clearance} · {camera.stream_type?.toUpperCase()}
            {camera.latitude != null && camera.longitude != null && (
              <> · <span className="lv-badge">GPS {camera.latitude.toFixed(4)}, {camera.longitude.toFixed(4)}</span></>
            )}
          </p>
          {canConfigure && (
            <details style={{ marginBottom: '0.5rem' }}>
              <summary>Map GPS location</summary>
              <div style={{ marginTop: '0.45rem' }}>
                <LocationPicker
                  value={
                    pinDrafts[camera.id] !== undefined
                      ? pinDrafts[camera.id]
                      : camera.latitude != null && camera.longitude != null
                        ? { latitude: camera.latitude, longitude: camera.longitude }
                        : null
                  }
                  onChange={(pos) => setPinDrafts((prev) => ({ ...prev, [camera.id]: pos }))}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="lv-secondary"
                  disabled={saving}
                  style={{ marginTop: '0.45rem' }}
                  onClick={async () => {
                    if (saving) return;
                    const draft =
                      pinDrafts[camera.id] !== undefined
                        ? pinDrafts[camera.id]
                        : camera.latitude != null && camera.longitude != null
                          ? { latitude: camera.latitude, longitude: camera.longitude }
                          : null;
                    setSaving(true);
                    setNotice('');
                    try {
                      const { error } = await supabase
                        .from('lv_cameras')
                        .update({
                          latitude: draft?.latitude ?? null,
                          longitude: draft?.longitude ?? null,
                        })
                        .eq('workspace_id', workspaceId)
                        .eq('id', camera.id)
                        .select('id')
                        .single();
                      if (error) throw new Error(error.message);
                      setCameras((prev) =>
                        prev.map((item) =>
                          item.id === camera.id
                            ? { ...item, latitude: draft?.latitude ?? null, longitude: draft?.longitude ?? null }
                            : item,
                        ),
                      );
                      setNotice(draft ? `Map location pinned for "${camera.name}".` : `Map location cleared for "${camera.name}".`);
                    } catch (err) {
                      setNotice(err instanceof Error ? err.message : 'Camera map location could not be updated.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save map location
                </button>
              </div>
            </details>
          )}
          <p className="lv-notice">{camera.playback_url ? 'Playback URL configured — open the feed to check it in this browser.' : camera.source_configured ? connections.unavailable?'Gateway status could not be loaded. Refresh before relying on the connection status.':cameraConnectionLabel(connections.states[camera.id]?.state) : 'Not connected — no playback URL configured.'}</p>
          {connections.states[camera.id]?.gateway_name&&<p>Site gateway: {connections.states[camera.id].gateway_name}</p>}
          <div className="lv-video-actions">
            <button
              type="button"
              className="lv-secondary"
              disabled={!camera.playback_url&&!connections.states[camera.id]?.gateway_id}
              onClick={() => {
                if(!camera.playback_url){setActive(undefined);setShowAnalysis(false);setGatewayFeed(camera);return;}
                setGatewayFeed(undefined);
                setPlayback('connecting');
                setFeedAttempt((attempt) => attempt + 1);
                setActive(camera);
                setShowAnalysis(true);
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
          {canConfigure && <CameraConnectionActions camera={camera} gateways={gateways} gatewayId={connections.states[camera.id]?.gateway_id} onChanged={message => {
            setActive(undefined);setGatewayFeed(undefined); setInventoryAttempt(value => value + 1); if(message) setNotice(message);
          }}/>}
        </article>
      ))}
      {gatewayFeed&&<GatewayCameraFeed key={gatewayFeed.id} cameraId={gatewayFeed.id} name={gatewayFeed.name} onClose={()=>setGatewayFeed(undefined)}/>}
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
      <details open={showAnalysis} onToggle={(event) => setShowAnalysis(event.currentTarget.open)}>
        <summary>
          Analyze footage &amp; live intelligence (ANPR, face recognition, weapon &amp; vehicle logging)
        </summary>
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
        <form id={registrationId} ref={registrationForm} onSubmit={add} aria-label="Register a camera" onInvalidCapture={()=>{setRegistrationFailed(true);setRegistrationMessage('Check the required camera name and URL fields before saving.');}}>
          <h3>Add a camera</h3>
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
          <LocationPicker value={cameraLocation} onChange={setCameraLocation} disabled={saving || loading} />
          {connectionMode === 'playback' && <label>
            Stream format
            <select name="stream_type"><option value="video">MP4 / WebM video</option><option value="hls">HLS camera gateway (.m3u8)</option><option value="mjpeg">MJPEG live feed</option></select>
          </label>}
          <label>Minimum clearance<select name="minimum_clearance" defaultValue="0"><option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option></select></label>
          <p>{connectionMode === 'source' ? 'This saves an unverified connection, not a working feed. A gateway on the camera’s network must test the password and convert video for this website. Connection settings are encrypted in Supabase Vault.' : 'Use an HTTPS feed or gateway that converts IP camera video to HLS or MJPEG. H.264 video is recommended. To store a raw camera URL and password securely, choose IP camera URL + encrypted credentials above.'}</p>
          {connectionMode === 'source' ? <CameraSourceFields/> : <label>
            HTTPS playback URL
            <input name="url" type="url" required maxLength={2048} />
          </label>}
          <button disabled={saving || loading}>{saving ? 'Saving camera…' : 'Register camera'}</button>
          {registrationMessage&&<p ref={registrationFeedback} tabIndex={-1} role={registrationFailed?'alert':'status'}>{registrationMessage}</p>}
        </form>
      )}
    </section>
  );
}
