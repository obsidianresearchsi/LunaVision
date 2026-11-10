import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

type Action = { id: string; title: string; responsible_team: string; due_on: string; completed_at: string | null };

function ActionList({ incidentId }: { incidentId: string }) {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.from('lv_corrective_actions').select('id,title,responsible_team,due_on,completed_at')
      .eq('incident_id', incidentId).order('due_on').order('id').then(({ data, error }) => {
        if (!active) return;
        setFailed(Boolean(error));
        setActions(data ?? []);
        setLoading(false);
      });
    return () => { active = false; };
  }, [incidentId, revision]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.from('lv_corrective_actions').insert({
        incident_id: incidentId,
        title: String(fields.get('title')).trim(),
        responsible_team: String(fields.get('team')).trim(),
        due_on: fields.get('due'),
      });
      if (error) throw error;
      form.reset();
      setNotice('Corrective action added.');
      setRevision(value => value + 1);
    } catch {
      setNotice('The action could not be added. Check the fields and try again.');
    } finally { setBusy(false); }
  }

  async function complete(id: string) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('lv_complete_corrective_action', { target: id });
      if (error) throw error;
      setNotice('Corrective action completed.');
    } catch {
      setNotice('The action could not be completed. The list has been refreshed.');
    } finally {
      setRevision(value => value + 1);
      setBusy(false);
    }
  }

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return <>
    {loading ? <p>Loading corrective actions...</p> : failed ? <p role="alert">Corrective actions could not be loaded. <button type="button" className="lv-secondary" onClick={() => setRevision(value => value + 1)}>Retry</button></p>
      : !actions.length && <p>No corrective actions have been recorded.</p>}
    {!loading && actions.map(action => <article key={action.id}>
      <h3>{action.title}</h3>
      <p>{action.responsible_team} · Due {action.due_on} · {action.completed_at ? 'Completed' : action.due_on < today ? 'Overdue' : 'Open'}</p>
      {!action.completed_at && <button type="button" className="lv-secondary" disabled={busy} onClick={() => void complete(action.id)}>Mark complete</button>}
    </article>)}
    <form onSubmit={event => void add(event)}>
      <label>Action<input name="title" minLength={2} maxLength={160} required /></label>
      <label>Responsible team<input name="team" maxLength={100} required /></label>
      <label>Due date<input type="date" name="due" required /></label>
      <button type="submit" disabled={busy}>Add corrective action</button>
    </form>
    {notice && <p role="status">{notice}</p>}
  </>;
}

export default function CorrectiveActions({ incidentId }: { incidentId: string }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Corrective actions</summary>
    {open && <ActionList incidentId={incidentId} />}
  </details>;
}
