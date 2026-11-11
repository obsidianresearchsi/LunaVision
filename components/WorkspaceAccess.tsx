import React, { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { WorkspaceFeatureKey, WorkspaceFeatureMap, defaultFeatureMap } from '../services/videoIntelligence';

type Props = {
  workspace: { id: string; name?: string; kind?: 'business' | 'agency'; active: boolean; entitlement: string };
  platform: boolean;
  role?: string;
  onUpdated: () => Promise<void>;
};

const FEATURE_LABELS: { key: WorkspaceFeatureKey; label: string; description: string; kindScope?: 'agency' | 'business' }[] = [
  {
    key: 'people_analytics',
    label: 'People Analytics',
    description: 'People detection, directional counting, live occupancy, and overcrowding alerts.',
  },
  {
    key: 'vehicle_analytics',
    label: 'Vehicle Analytics',
    description: 'Vehicle classification (car/motorcycle/bus/truck), counting, and stationary/parked vehicle detection.',
  },
  {
    key: 'advanced_detection',
    label: 'Advanced Security & Behavior Detection',
    description: 'Loitering, restricted-area intrusion, perimeter monitoring, unattended items, tamper & camera health.',
  },
  {
    key: 'anpr',
    label: 'ANPR & Vehicle Watchlist',
    description: 'Automatic number plate reading and real-time matching against the security watchlist.',
    kindScope: 'agency',
  },
  {
    key: 'vehicle_registry',
    label: 'Pre-Populated Vehicle Registration DB',
    description: 'Bulk CSV/Excel vehicle registry import, synchronization, and plate enrichment.',
    kindScope: 'agency',
  },
  {
    key: 'security_intelligence',
    label: 'Security Agency Intelligence Dashboard',
    description: 'Agency operational intelligence, ANPR logs, watchlist alerts, and historical investigation reports.',
    kindScope: 'agency',
  },
  {
    key: 'biometric_enrollment',
    label: 'Biometric Subject Enrollment & Bulk Migration',
    description: 'Enroll multi-angle subjects into an isolated agency Face++ FaceSet and bulk migrate criminal dossiers and photo batches.',
    kindScope: 'agency',
  },
  {
    key: 'face_search',
    label: '1:N Face Search & Audit History',
    description: 'Search probe images against the agency enrolled biometric database with clearance filtering and immutable search audit logs.',
    kindScope: 'agency',
  },
  {
    key: 'business_intelligence',
    label: 'Business Intelligence Dashboard',
    description: 'Commercial customer footfall, peak visiting hours, occupancy, and parking analytics.',
    kindScope: 'business',
  },
];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Owner · Full workspace control, staff & camera configuration',
  admin: 'Administrator · Camera config, staff, watchlist archive/delete, alerts',
  supervisor: 'Supervisor · Watchlist write & archive, registry import, resolve alerts',
  investigator: 'Investigator · Watchlist add/edit, acknowledge & resolve alerts',
  member: 'Operator / Member · Monitor cameras, acknowledge/resolve assigned alerts',
};

export default function WorkspaceAccess({ workspace, platform, role, onUpdated }: Props) {
  const isBusiness = workspace.kind === 'business';
  const [staff, setStaff] = useState<{ user_id: string; email: string; role: string; clearance: number; allowed_modules: string[] }[]>([]);
  const [createAccount, setCreateAccount] = useState(false);
  const [setupLink, setSetupLink] = useState('');
  const [activity, setActivity] = useState<{ id: number; action: string; actor_id: string; subject_id: string | null; created_at: string }[]>([]);
  const [features, setFeatures] = useState<WorkspaceFeatureMap>(() => defaultFeatureMap(!isBusiness));
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [active, setActive] = useState(workspace.active);
  const [entitlement, setEntitlement] = useState(workspace.entitlement);

  useEffect(() => {
    setActive(workspace.active);
    setEntitlement(workspace.entitlement);
  }, [workspace.id, workspace.active, workspace.entitlement]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);

    const canReadPersonnel = !(platform && isBusiness);

    void Promise.all([
      canReadPersonnel ? supabase.rpc('lv_workspace_staff_access', { target: workspace.id }) : Promise.resolve({ data: [], error: null }),
      canReadPersonnel
        ? supabase
            .from('lv_workspace_activity')
            .select('id,action,actor_id,subject_id,created_at')
            .eq('workspace_id', workspace.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(60)
        : Promise.resolve({ data: [], error: null }),
      supabase.rpc('lv_workspace_feature_map', { target: workspace.id }),
    ]).then(([personnel, events, featRes]) => {
      if (!current) return;
      setLoadError(Boolean(personnel.error || events.error));
      setStaff(personnel.data ?? []);
      setActivity(events.data ?? []);
      if (featRes.data && typeof featRes.data === 'object' && !Array.isArray(featRes.data)) {
        setFeatures({ ...defaultFeatureMap(!isBusiness), ...(featRes.data as Partial<WorkspaceFeatureMap>) });
      }
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [workspace.id, version, platform, isBusiness]);

  async function submit(event: FormEvent<HTMLFormElement>, settings: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    setSetupLink('');
    try {
      if (!settings && createAccount) {
        const {data} = await supabase.auth.getSession();
        if (!data.session) throw new Error('Sign in again to create a staff account.');
        const response = await fetch('/api/agency-accounts', {method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},
          body:JSON.stringify({workspaceId:workspace.id,email:fields.get('email'),role:fields.get('role'),clearance:Number(fields.get('clearance')),modules:fields.getAll('modules'),verified:fields.has('verified')})});
        const result=await response.json().catch(()=>null);
        if(!response.ok)throw new Error(result?.error ?? 'Staff account creation failed.');
        setSetupLink(result?.setupLink ?? '');
        setNotice(result?.existing ? 'Existing account access updated. They use their current password.' : 'Staff account created. Share the one-time setup link privately so they can choose their password.');
        setVersion(value=>value+1); return;
      }
      const { error } = settings
        ? await supabase.rpc('lv_configure_agency', { target: workspace.id, enabled: active, access_entitlement: entitlement })
        : await supabase.rpc('lv_set_staff_access', {
            target: workspace.id,
            email_address: fields.get('email'),
            access_role: fields.get('role'),
            access_clearance: Number(fields.get('clearance')),
            modules: fields.getAll('modules'),
          });
      if (error) throw new Error(error.message);
      if (!settings) form.reset();
      setVersion((previous) => previous + 1);
      setNotice(settings ? 'Agency configuration saved.' : 'Workspace access & role updated.');
      if (settings) await onUpdated();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeature(featureKey: WorkspaceFeatureKey, nextEnabled: boolean) {
    if (!platform) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('lv_set_workspace_feature', {
        target: workspace.id,
        feature_name: featureKey,
        is_enabled: nextEnabled,
      });
      if (error) throw new Error(error.message);
      setFeatures((prev) => ({ ...prev, [featureKey]: nextEnabled }));
      setVersion((v) => v + 1);
      setNotice(`Feature "${featureKey}" ${nextEnabled ? 'enabled' : 'disabled'} for ${workspace.name || 'organization'}.`);
      await onUpdated();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Feature setting could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lv-grid">
      <section className="lv-card">
        {platform && !isBusiness && (
          <>
            <h2>Agency configuration</h2>
            <form onSubmit={(event) => void submit(event, true)}>
              <label>
                Status
                <select value={active ? 'active' : 'suspended'} onChange={(event) => setActive(event.target.value === 'active')}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              <label>
                Access entitlement
                <input value={entitlement} onChange={(event) => setEntitlement(event.target.value)} maxLength={120} />
              </label>
              <button disabled={busy}>Save agency configuration</button>
            </form>
          </>
        )}

        {platform && (
          <div style={{ marginTop: !isBusiness ? '1.5rem' : 0 }}>
            <h2>Organization Feature Entitlements</h2>
            <p>
              Control which intelligence and analytics capabilities are available to{' '}
              <strong>{workspace.name || 'this organization'}</strong> ({isBusiness ? 'Business' : 'Security Agency'}).
            </p>
            {FEATURE_LABELS.filter((f) => !f.kindScope || f.kindScope === (workspace.kind || 'agency')).map((feat) => {
              const enabled = Boolean(features[feat.key]);
              return (
                <article key={feat.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                    <div>
                      <h3 style={{ margin: 0 }}>{feat.label}</h3>
                      <small>{feat.description}</small>
                    </div>
                    <button
                      type="button"
                      className={enabled ? undefined : 'lv-secondary'}
                      disabled={busy}
                      onClick={() => void toggleFeature(feat.key, !enabled)}
                    >
                      {enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!(platform && isBusiness) && (
          <div style={{ marginTop: platform ? '1.5rem' : 0 }}>
            <h2>Personnel access &amp; roles</h2>
            <p>Grant existing account access, or create a new account with a one-time password setup link. No email is sent automatically; share that link privately with the verified recipient.</p>
            <label>Account action<select value={createAccount ? 'create' : 'existing'} onChange={event=>{setCreateAccount(event.target.value==='create');setSetupLink('');}}>
              <option value="existing">Manage an existing confirmed account</option><option value="create">Create a staff account</option>
            </select></label>
            {workspace.active ? (
              <form onSubmit={(event) => void submit(event, false)}>
                <label>
                  Staff email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Role
                  <select name="role" defaultValue="member">
                    <option value="member">Personnel / Member (view &amp; acknowledge alerts)</option>
                    <option value="viewer">Viewer (read-only)</option>
                    <option value="investigator">Investigator (watchlist add/edit &amp; resolve alerts)</option>
                    <option value="supervisor">Supervisor (watchlist archive &amp; registry import)</option>
                    {(platform || role === 'owner') && <option value="admin">Workspace administrator (full config &amp; delete)</option>}
                    <option value="revoke">Revoke access</option>
                  </select>
                </label>
                <label>Clearance<select name="clearance" defaultValue="0"><option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option></select></label>
                <fieldset><legend>Allowed modules (owners and administrators have full module access)</legend>
                  {['monitor','analytics','records',...(!isBusiness?['evidence','vehicles']:[])].map(module=><label className="lv-verify-recipient" key={module}>
                    <input type="checkbox" name="modules" value={module} defaultChecked={module==='monitor'} />{module}
                  </label>)}
                </fieldset>
                {createAccount && <label className="lv-verify-recipient"><input type="checkbox" name="verified" required />I verified this recipient and email address.</label>}
                <button disabled={busy}>{createAccount ? 'Create staff account' : 'Update personnel access'}</button>
              </form>
            ) : (
              <p>Reactivate the agency to update its personnel.</p>
            )}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {setupLink && <label>Private one-time password setup link<input type="text" value={setupLink} readOnly onFocus={event=>event.currentTarget.select()} /></label>}
      </section>

      <section className="lv-card">
        <h2>{platform && isBusiness ? 'Organization isolation notice' : 'Personnel and audit log'}</h2>
        {platform && isBusiness ? (
          <p>
            Business staff rosters, camera feeds, and incident records remain isolated inside the business workspace and are
            not exposed to the platform feature panel.
          </p>
        ) : loading ? (
          <p>Loading personnel and audit activity…</p>
        ) : loadError ? (
          <p role="alert">Personnel or audit logs could not be loaded.</p>
        ) : (
          <>
            {staff.length ? (
              staff.map((member) => (
                <article key={member.user_id}>
                  <h3>{member.email}</h3>
                  <p>{ROLE_DESCRIPTIONS[member.role] || member.role}</p>
                  <p>Clearance {member.clearance} · {member.allowed_modules?.join(', ')}</p>
                </article>
              ))
            ) : (
              <p>No personnel have been assigned.</p>
            )}
            <h3 style={{ marginTop: '1rem' }}>Recent audit activity</h3>
            {activity.length ? (
              activity.map((event) => (
                <article key={event.id}>
                  <h3>{event.action.replace('.', ' · ')}</h3>
                  <p>By {staff.find((member) => member.user_id === event.actor_id)?.email ?? event.actor_id}</p>
                  {event.subject_id && (
                    <p>Target {staff.find((member) => member.user_id === event.subject_id)?.email ?? event.subject_id}</p>
                  )}
                  <small>{new Date(event.created_at).toLocaleString()}</small>
                </article>
              ))
            ) : (
              <p>No audit activity has been recorded yet.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
