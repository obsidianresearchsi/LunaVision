import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Camera, ClipboardList, Radio } from 'lucide-react';
import { supabase } from '../services/supabase';

type Observation = { id: string; source: 'file' | 'camera'; frame_seconds: number; summary: string; created_at: string };

export default function WorkspaceOverview({ workspaceId, agency, navigate, compact = false }: {
  workspaceId: string;
  agency: boolean;
  navigate: (panel: string) => void;
  compact?: boolean;
}) {
  const [data, setData] = useState<{ cameras: number | null; records: number | null; observations: number | null; recent: Observation[] | null }>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setData(undefined);
    void Promise.all([
      supabase.from('lv_cameras').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('lv_records').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
        .eq('category', agency ? 'investigation' : 'incident').neq('status', 'resolved'),
      supabase.from('lv_video_observations').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      supabase.from('lv_video_observations').select('id,source,frame_seconds,summary,created_at').eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6),
    ]).then(([cameras, records, observations, recent]) => {
      if (current) setData({
        cameras: cameras.error ? null : cameras.count,
        records: records.error ? null : records.count,
        observations: observations.error ? null : observations.count,
        recent: recent.error ? null : recent.data as Observation[],
      });
    });
    return () => { current = false; };
  }, [workspaceId, agency, attempt]);

  const metrics = [
    { title: 'Registered cameras', count: data?.cameras, icon: Camera, panel: 'cameras' },
    { title: agency ? 'Unresolved investigations' : 'Unresolved incidents', count: data?.records, icon: ClipboardList, panel: 'records' },
    { title: 'Saved observations', count: data?.observations, icon: Radio, panel: 'history' },
  ];

  return <>
    <div className="lv-console-metrics">
      {metrics.map(({ title, count, icon: Icon, panel }) => (
        <button key={title} type="button" onClick={() => navigate(panel)}>
          <span><Icon size={18} aria-hidden="true" /><ArrowUpRight size={16} aria-hidden="true" /></span>
          <strong>{count === undefined ? '…' : count === null ? 'Unavailable' : count.toLocaleString()}</strong>
          <span>{title}</span>
        </button>
      ))}
    </div>
    {!compact && <section className="lv-card lv-console-observations">
      <h2>Recent video observations</h2>
      {data === undefined ? <p>Loading observations…</p> : data.recent === null ? <p role="alert">Observations could not be loaded. <button type="button" className="lv-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>
        : data.recent.length === 0 ? <p>Open Cameras, analyze a workspace feed or a local video, and save a frame with detections.</p>
          : data.recent.map(item => <article key={item.id}>
            <p>{item.summary}</p>
            <small>{item.source === 'camera' ? 'Workspace camera' : 'Local video'} · Video time {item.frame_seconds}s · Saved {new Date(item.created_at).toLocaleString()}</small>
          </article>)}
    </section>}
  </>;
}
