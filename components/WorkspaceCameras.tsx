import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import VideoAnalysis from './VideoAnalysis';
import CameraChat from './CameraChat';

type Camera = { id: string; name: string; location: string; playback_url: string };
const columns = 'id,name,location,playback_url';
const playbackLabels = {
  connecting: 'Connecting to the playback endpoint…',
  ready: 'Video is ready to play.',
  playing: 'Playing in this browser.',
  paused: 'Playback paused.',
  buffering: 'Waiting for video data…',
  ended: 'Playback finished.',
  error: 'The browser could not play this stream. Check the URL, video format, and camera gateway.',
};

export function WorkspaceCameras({ workspaceId, canAdd, agency, initialCameraId }: {
  workspaceId: string; canAdd: boolean; agency: boolean; initialCameraId?: string;
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

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setInventoryFailed(false);
    void supabase.from('lv_cameras').select(columns).eq('workspace_id', workspaceId).order('name')
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) setInventoryFailed(true);
        else {
          const inventory = data as Camera[];
          setCameras(inventory);
          if (initialCameraId) setActive(inventory.find(camera => camera.id === initialCameraId));
        }
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [workspaceId, initialCameraId, inventoryAttempt]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAdd || saving || loading) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaving(true);
    setNotice('');
    try {
      const url = new URL(String(fields.get('url')).trim());
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('Enter a direct HTTPS playback URL without credentials or query parameters.');
      }
      const { data, error } = await supabase.from('lv_cameras').insert({
        workspace_id: workspaceId,
        name: String(fields.get('name')).trim(),
        location: String(fields.get('location')).trim(),
        playback_url: url.href,
      }).select(columns).single();
      if (error) throw new Error('The camera could not be saved.');
      setCameras(previous => [...previous, data as Camera]);
      setNotice('Camera registered.');
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The camera could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="lv-card">
    <h2>Cameras</h2>
    {inventoryFailed ? <p role="alert">Camera inventory could not be loaded. <button type="button" className="lv-secondary" onClick={() => setInventoryAttempt(attempt => attempt + 1)}>Retry inventory</button></p>
      : <p>{loading ? 'Loading camera inventory…' : cameras.length === 0 ? 'No cameras registered.' : 'Select a camera to open its feed.'}</p>}
    {notice && <p role="status">{notice}</p>}
    {cameras.map(camera => <article key={camera.id}>
      <h3>{camera.name}</h3><p>{camera.location}</p>
      <button type="button" className="lv-secondary" onClick={() => {
        setPlayback('connecting');
        setFeedAttempt(attempt => attempt + 1);
        setActive(camera);
      }}>Open feed</button>
    </article>)}
    {active && <article>
      <h3>{active.name}</h3>
      <video key={active.id + feedAttempt} src={active.playback_url} controls playsInline preload="auto" aria-label={active.name}
        style={{ width: '100%', maxHeight: 440 }}
        onLoadedData={() => setPlayback('ready')} onPlaying={() => setPlayback('playing')}
        onPause={() => setPlayback(previous => previous === 'error' ? previous : 'paused')}
        onWaiting={() => setPlayback(previous => previous === 'error' ? previous : 'buffering')}
        onEnded={() => setPlayback('ended')} onError={() => setPlayback('error')}/>
      <p role="status">{playbackLabels[playback]}</p>
      {playback === 'error' && <button className="lv-secondary" type="button" onClick={() => {
        setPlayback('connecting');
        setFeedAttempt(attempt => attempt + 1);
      }}>Retry feed</button>}
      <button className="lv-secondary" type="button" onClick={() => setActive(undefined)}>Close feed</button>
      <CameraChat key={active.id} camera={{ name: active.name, location: active.location, playback: playbackLabels[playback] }} />
    </article>}
    <details onToggle={event => setShowAnalysis(event.currentTarget.open)}>
      <summary>Analyze footage</summary>
      {showAnalysis && <VideoAnalysis key={active?.id ?? 'local'} cameraUrl={active?.playback_url} cameraId={active?.id} workspaceId={workspaceId} samples
        watchlistWorkspaceId={agency ? workspaceId : undefined} />}
    </details>
    {canAdd && <form onSubmit={add}>
      <label>Camera name<input name="name" required minLength={2} maxLength={100} /></label>
      <label>Location<input name="location" maxLength={200} /></label>
      <label>HTTPS playback URL<input name="url" type="url" required maxLength={2048} /></label>
      <button disabled={saving || loading}>Add camera</button>
    </form>}
  </section>;
}
