import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import AgencyAccountIssuer from './AgencyAccountIssuer';

type Props = {
  workspace: { id: string; active: boolean; entitlement: string };
  platform: boolean;
  role?: string;
  onUpdated: () => Promise<void>;
};

export default function WorkspaceAccess({ workspace, platform, role, onUpdated }: Props) {
  const [staff, setStaff] = useState<{ user_id: string; email: string; role: string }[]>([]);
  const [activity, setActivity] = useState<{ id: number; action: string; actor_id: string; subject_id: string | null; created_at: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(workspace.active);
  const [entitlement, setEntitlement] = useState(workspace.entitlement);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void Promise.all([
      supabase.rpc('lv_workspace_staff', { target: workspace.id }),
      supabase.from('lv_workspace_activity').select('id,action,actor_id,subject_id,created_at')
        .eq('workspace_id', workspace.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50),
    ]).then(([personnel, events]) => {
      if (!current) return;
      setLoadError(Boolean(personnel.error || events.error));
      setStaff(personnel.data ?? []);
      setActivity(events.data ?? []);
      setLoading(false);
    });
    return () => { current = false; };
  }, [workspace.id, version]);

  async function submit(event: FormEvent<HTMLFormElement>, settings: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    try {
      const { error } = settings
        ? await supabase.rpc('lv_configure_agency', { target: workspace.id, enabled: active, access_entitlement: entitlement })
        : await supabase.rpc('lv_manage_workspace_access', { target: workspace.id, email_address: fields.get('email'), access_role: fields.get('role') });
      if (error) throw new Error(error.message);
      if (!settings) form.reset();
      setVersion(previous => previous + 1);
      setNotice(settings ? 'Agency configuration saved.' : 'Workspace access updated.');
      await onUpdated();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The request failed.');
    } finally { setBusy(false); }
  }

  return <div className="lv-grid">
    <section className="lv-card">
      {platform && <>
        <h2>Agency configuration</h2>
        <form onSubmit={event => void submit(event, true)}>
          <label>Status<select value={active ? 'active' : 'suspended'} onChange={event => setActive(event.target.value === 'active')}>
            <option value="active">Active</option><option value="suspended">Suspended</option>
          </select></label>
          <label>Access entitlement<input value={entitlement} onChange={event => setEntitlement(event.target.value)} maxLength={120} /></label>
          <button disabled={busy}>Save agency configuration</button>
        </form>
      </>}
      {platform && workspace.active && <AgencyAccountIssuer workspaceId={workspace.id}
        onIssued={() => setVersion(previous => previous + 1)} />}
      <h2>Personnel access</h2>
      {workspace.active ? <form onSubmit={event => void submit(event, false)}>
        <label>Confirmed account email<input name="email" type="email" required /></label>
        <label>Role<select name="role">
          <option value="member">Member</option>
          {(platform || role === 'owner') && <option value="admin">Workspace administrator</option>}
          <option value="revoke">Revoke access</option>
        </select></label>
        <button disabled={busy}>Update personnel access</button>
      </form> : <p>Reactivate the agency to update its personnel.</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="lv-card">
      <h2>Personnel and access activity</h2>
      {loading ? <p>Loading personnel and access activity…</p> : loadError ? <p role="alert">Personnel or activity could not be loaded.</p> : <>
        {staff.length ? staff.map(member => <article key={member.user_id}><h3>{member.email}</h3><p>{member.role}</p></article>) : <p>No personnel have been assigned.</p>}
        <h3>Recent access activity</h3>
        {activity.length ? activity.map(event => <article key={event.id}>
          <h3>{event.action.replace('.', ' · ')}</h3>
          <p>By {staff.find(member => member.user_id === event.actor_id)?.email ?? event.actor_id}</p>
          {event.subject_id && <p>Account {staff.find(member => member.user_id === event.subject_id)?.email ?? event.subject_id}</p>}
          <small>{new Date(event.created_at).toLocaleString()}</small>
        </article>) : <p>No access changes have been recorded.</p>}
      </>}
    </section>
  </div>;
}
