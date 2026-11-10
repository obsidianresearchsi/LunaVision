import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

type Observation = {
  id: string;
  summary: string;
  source: 'camera' | 'file';
  camera_id: string | null;
  frame_seconds: number;
  created_at: string;
};

export default function WorkspaceObservations({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<Observation[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    const fetchRows = async () => {
      let request = supabase.from('lv_video_observations')
        .select('id,summary,source,camera_id,frame_seconds,created_at')
        .eq('workspace_id', workspaceId);
      if (source !== 'all') request = request.eq('source', source);
      if (query.trim()) request = request.ilike('summary', '%' + query.trim().replace(/[%_]/g, '') + '%');
      const result = await request.order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize);
      if (!active) return;
      setError(Boolean(result.error));
      setRows((result.data ?? []).slice(0, pageSize));
      setMore((result.data?.length ?? 0) > pageSize);
      setLoading(false);
    };
    void fetchRows();
    return () => { active = false; };
  }, [workspaceId, query, source, attempt, page]);

  function exportRows() {
    const data = { workspaceId, exportedAt: new Date().toISOString(), observations: rows };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lunar-vision-observations-page-' + (page + 1) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="lv-card">
    <h2>Detection history</h2>
    <div className="lv-observation-filters">
      <label>Search detections<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>Source<select value={source} onChange={event => { setSource(event.target.value); setPage(0); }}>
        <option value="all">All sources</option><option value="camera">Workspace cameras</option><option value="file">Uploaded footage</option>
      </select></label>
    </div>
    <div className="lv-video-actions">
      <button type="button" className="lv-secondary" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Refresh</button>
      <button type="button" className="lv-secondary" disabled={loading || error || !rows.length} onClick={exportRows}>Export this page</button>
    </div>
    {loading ? <p>Loading saved detections…</p> : error ? <p role="alert">Detection history could not be loaded. Select Refresh to retry.</p>
      : rows.length === 0 ? <p>No saved observations match these filters. Analyze footage under Live cameras &amp; playback and save frame detections to build this history.</p>
        : <div className="lv-observation-table"><table>
          <thead><tr><th>Saved</th><th>Source</th><th>Video time</th><th>Detections</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td>{new Date(row.created_at).toLocaleString()}</td>
            <td>{row.source === 'camera' ? 'Workspace camera' : 'Local video'}</td>
            <td>{Number(row.frame_seconds).toFixed(2)}s</td><td>{row.summary}</td>
          </tr>)}</tbody>
        </table></div>}
    <div className="lv-video-actions">
      <button type="button" className="lv-secondary" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
      <span>Page {page + 1}</span>
      <button type="button" className="lv-secondary" disabled={loading || error || !more} onClick={() => setPage(value => value + 1)}>Next</button>
    </div>
  </section>;
}
