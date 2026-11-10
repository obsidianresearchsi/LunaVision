import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase, workspaceEnabled } from '../services/supabase';
import { WorkspaceCameras } from '../components/WorkspaceCameras';
import VehicleWatchlist from '../components/VehicleWatchlist';
import WorkspaceAccess from '../components/WorkspaceAccess';
import FaceComparison from '../components/FaceComparison';
import WorkspaceOverview from '../components/WorkspaceOverview';
import CorrectiveActions from '../components/CorrectiveActions';
import AgencyCommandMap from '../components/AgencyCommandMap';
import { Building2, Camera, ClipboardList, LayoutDashboard, LogOut, Map, ScanFace, Search, Shield, Users } from 'lucide-react';

type Workspace = { id: string; name: string; kind: 'business' | 'agency'; active: boolean; entitlement: string; organization_details: string };
type RecordStatus = 'open' | 'in_review' | 'resolved';
type RecordRow = { id: string; title: string; details: string; category: string; status: RecordStatus; created_at: string };
const recordColumns = 'id,title,details,category,status,created_at';
const statusLabel = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const statusActions = { open: ['in_review'], in_review: ['open', 'resolved'], resolved: ['open'] } as const;
const portalEnabled = workspaceEnabled && import.meta.env.VITE_WORKSPACE_PORTAL_ENABLED === 'true';
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN_ENABLED === 'true';
const emailFlowsEnabled = import.meta.env.VITE_EMAIL_AUTH_FLOWS_ENABLED !== 'false';
const panelIcons = { overview: LayoutDashboard, command: Map, cameras: Camera, records: ClipboardList, vehicles: Shield, faces: ScanFace, gallery: Search, access: Users };

export default function WorkspacePortal({ agency, platformView }: { agency: boolean; platformView: boolean }) {
  const kind = agency ? 'agency' : 'business';
  const signInPath = platformView ? '/agency/admin' : agency ? '/agency' : '/business';
  const [panel, setPanel] = useState('overview');
  const [requestedCamera, setRequestedCamera] = useState<string>();
  const [account, setAccount] = useState<string | null>(null);
  const accountRef = useRef<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [ready, setReady] = useState(!portalEnabled);
  const [register, setRegister] = useState(() => !agency && emailFlowsEnabled && new URLSearchParams(location.search).get('mode') === 'register');
  const [requestReset, setRequestReset] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<{ workspace_id: string; role: string }[]>([]);
  const [admin, setAdmin] = useState(false);
  const [selected, setSelected] = useState('');
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordScope, setRecordScope] = useState('');
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [recordsAttempt, setRecordsAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const workspace = loadedFor === account ? workspaces.find(item => item.id === selected) : undefined;
  const membership = loadedFor === account ? memberships.find(item => item.workspace_id === selected) : undefined;
  const isMember = Boolean(membership);

  useEffect(() => {
    if (!portalEnabled) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      accountRef.current = session?.user.id ?? null;
      setAccount(accountRef.current);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function loadWorkspaces() {
    const requestingAccount = accountRef.current;
    const [teams, members, platform] = await Promise.all([
      supabase.from('lv_workspaces').select('id,name,kind,active,entitlement,organization_details').eq('kind', kind).order('name'),
      supabase.from('lv_memberships').select('workspace_id,role'),
      agency ? supabase.from('lv_platform_admins').select('user_id') : Promise.resolve({ data: [], error: null }),
    ]);
    if (requestingAccount !== accountRef.current) return;
    if (teams.error || members.error || platform.error) throw new Error('Workspace access could not be loaded.');
    setWorkspaces(teams.data as Workspace[]);
    setMemberships(members.data);
    setAdmin(Boolean(platform.data?.length));
    const available = platformView ? teams.data : teams.data.filter(team => members.data.some(member => member.workspace_id === team.id));
    setSelected(previous => available.some(item => item.id === previous) ? previous : available[0]?.id ?? '');
    setLoadedFor(requestingAccount);
  }

  useEffect(() => {
    setLoadedFor(null);
    setPanel('overview');
    if (!account) { setWorkspaces([]); setMemberships([]); setAdmin(false); setSelected(''); return; }
    void loadWorkspaces().catch(error => {
      if (accountRef.current === account) {
        setWorkspaces([]); setMemberships([]); setAdmin(false); setSelected('');
        setNotice(error.message); setLoadedFor(account);
      }
    });
  }, [account]);

  useEffect(() => {
    setRecords([]);
    setRecordScope('');
    setRecordsFailed(false);
    if (!account || !selected || !isMember) return;
    let current = true;
    void supabase.from('lv_records').select(recordColumns).eq('workspace_id', selected)
      .order('created_at', { ascending: false }).limit(100).then(({ data, error }) => {
        if (current) {
          if (error) setRecordsFailed(true);
          else setRecords(data as RecordRow[]);
          setRecordScope(account + selected);
        }
      });
    return () => { current = false; };
  }, [account, selected, isMember, recordsAttempt]);

  async function submit(event: FormEvent<HTMLFormElement>, operation: (fields: FormData) => Promise<void>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setNotice('');
    try { await operation(new FormData(form)); form.reset(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'The request failed.'); }
    finally { setBusy(false); }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: location.origin + signInPath },
      });
      if (error) throw error;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google sign-in could not be started.');
      setBusy(false);
    }
  }

  const message = notice && <p role="status">{notice}</p>;
  if (recovering && account) return <main className="lv-access">
    <section className="lv-card">
      <h1>Set a new password</h1>
      <form onSubmit={event => submit(event, async fields => {
        const { error } = await supabase.auth.updateUser({ password: String(fields.get('password')) });
        if (error) throw new Error(error.message);
        const signedOut = await supabase.auth.signOut();
        if (signedOut.error) throw new Error(signedOut.error.message);
        setRecovering(false);
        setNotice('Password updated. Sign in with your new password.');
      })}>
        <label>New password<input type="password" name="password" minLength={12} autoComplete="new-password" required /></label>
        <button disabled={busy}>Update password</button>
      </form>
      {message}
    </section>
  </main>;

  if (!account) return <main className="lv-access">
    <section className="lv-card">
      <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="220" />
      <h1>{requestReset ? 'Reset your password' : platformView ? 'Platform administrator sign-in' : agency ? 'Agency sign-in' : register ? 'Create a business account' : 'Business workspace'}</h1>
      {!portalEnabled ? <p>Workspace connection is unavailable.</p> : !ready ? <p>Checking session…</p> :
        <form onSubmit={event => submit(event, async fields => {
          const email = String(fields.get('email')).trim();
          if (requestReset) {
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + signInPath });
            if (error) throw new Error(error.message);
            setRequestReset(false);
            setNotice('If this account can receive mail, a password reset link will arrive shortly.');
            return;
          }
          const credentials = { email, password: String(fields.get('password')) };
          const result = register ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin + '/business' } })
            : await supabase.auth.signInWithPassword(credentials);
          if (result.error) throw new Error(result.error.message);
          if (register && !result.data.session) setNotice('Check your email to confirm your account.');
        })}>
          <label>Email<input type="email" name="email" autoComplete="email" required /></label>
          {!requestReset && <label>Password<input type="password" name="password" minLength={register ? 12 : undefined} autoComplete={register ? 'new-password' : 'current-password'} required /></label>}
          <button disabled={busy}>{requestReset ? 'Send reset link' : register ? 'Create account' : 'Sign in'}</button>
          {!register && emailFlowsEnabled && <button disabled={busy} type="button" className="lv-secondary" onClick={() => { setRequestReset(!requestReset); setNotice(''); }}>{requestReset ? 'Back to sign-in' : 'Forgot password?'}</button>}
          {!agency && !requestReset && emailFlowsEnabled && <button disabled={busy} type="button" className="lv-secondary" onClick={() => { setRegister(!register); setNotice(''); }}>{register ? 'Back to sign-in' : 'Create a business account'}</button>}
          {googleEnabled && !requestReset && <button disabled={busy} type="button" className="lv-secondary" onClick={() => void signInWithGoogle()}>Continue with Google</button>}
        </form>}
      {message}
    </section>
  </main>;

  const canManage = platformView && admin || membership?.role === 'owner' || membership?.role === 'admin';
  const panels = [
    ['overview', 'Overview'],
    ...(isMember && agency ? [['command', 'Command Center']] : []),
    ...(isMember ? [['cameras', 'Cameras'], ['records', agency ? 'Investigations' : 'Sites & incidents']] : []),
    ...(isMember && agency ? [['vehicles', 'Vehicle watchlist']] : []),
    ...(isMember && agency ? [['faces', 'Face comparison'], ['gallery', 'Gallery search']] : []),
    ...(canManage ? [['access', agency ? 'Agency personnel' : 'Organization staff']] : []),
  ];
  const visiblePanels = panels.filter(([id]) => !platformView || id === 'overview' || id === 'access');
  const section = visiblePanels.find(([id]) => id === panel)?.[1] ?? 'Overview';
  return <div className="lv-console">
    <aside className="lv-console-rail">
      <div className="lv-console-brand"><img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="148" />
        <span>{platformView ? 'Platform administration' : agency ? 'Agency operations' : 'Business operations'}</span></div>
      {workspace && <label className="lv-console-switch"><Building2 size={17} aria-hidden="true" /><span>Workspace</span>
        <select disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setPanel('overview'); setRequestedCamera(undefined); }}>
          {workspaces.filter(item => platformView || memberships.some(member => member.workspace_id === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {workspace && (!platformView || admin) && <nav aria-label="Workspace navigation">
        {visiblePanels.map(([id, label]) => {
          const Icon = panelIcons[id as keyof typeof panelIcons];
          return <button key={id} type="button" aria-current={panel === id ? 'page' : undefined} onClick={() => { if (id !== panel) setRequestedCamera(undefined); setPanel(id); }}><Icon size={17} aria-hidden="true" />{label}</button>;
        })}
      </nav>}
      <div className="lv-console-session">
        {loadedFor === account && agency && admin && <a href={platformView ? '/agency' : '/agency/admin'}>{platformView ? 'Agency workspace' : 'Platform administration'}</a>}
        <button type="button" onClick={() => void supabase.auth.signOut().then(({ error }) => { if (error) setNotice(error.message); })}><LogOut size={16} aria-hidden="true" /> Sign out</button>
      </div>
    </aside>
    <main className="lv-portal lv-console-main">
    <header className="lv-console-heading"><div><p>{workspace?.name ?? (agency ? 'Agency workspace' : 'Organization workspace')}</p>
      <h1>{workspace ? section : platformView ? 'Agency administration' : agency ? 'Agency command workspace' : 'Business operations'}</h1></div>
      {workspace && <span className="lv-console-status" data-active={workspace.active}>{workspace.active ? 'Active workspace' : 'Suspended'}</span>}
    </header>
    {message}
    {loadedFor !== account ? <p>Loading workspace access…</p> : platformView && !admin ? <p>Platform administrator access is required.</p> : <>
    {(!agency && !workspaces.length || platformView && admin) && <section className="lv-card">
      <h2>{agency ? 'Create an agency' : 'Set up your organization'}</h2>
      <form onSubmit={event => submit(event, async fields => {
        const { error } = await supabase.rpc(agency ? 'lv_create_agency' : 'lv_create_business', { workspace_name: fields.get('name') });
        if (error) throw new Error(error.message);
        await loadWorkspaces();
      })}><label>Organization name<input name="name" required minLength={2} maxLength={100} /></label><button disabled={busy}>Create workspace</button></form>
    </section>}
    {agency && !platformView && !isMember && <p>Your account needs active membership in the selected agency.</p>}
    {workspace && <>
      {panel === 'overview' && isMember && !platformView && <WorkspaceOverview key={account + selected} workspaceId={selected} agency={agency} navigate={setPanel} />}
      {panel === 'overview' && <section className="lv-card"><h2>{workspace.name}</h2>
        <p>{workspace.active ? 'Active workspace' : 'Agency access suspended'}{workspace.entitlement && ' · ' + workspace.entitlement}</p>
        <p>{platformView ? 'Manage agency status, access entitlement and personnel.' : agency ? 'Open investigations or check verified plates against agency cases.' : 'Connect cameras and manage your organization’s sites and incidents.'}</p>
        {!agency && (canManage ? <form key={workspace.id} onSubmit={event => submit(event, async fields => {
          const { error } = await supabase.rpc('lv_set_business_details', { target: selected, details: fields.get('details') });
          if (error) throw new Error(error.message);
          setNotice('Organization details saved.');
          await loadWorkspaces();
        })}>
          <label>Organization details<textarea name="details" defaultValue={workspace.organization_details} maxLength={1000} /></label>
          <button disabled={busy}>Save details</button>
        </form> : workspace.organization_details && <p>{workspace.organization_details}</p>)}
      </section>}
      {canManage && panel === 'access' && <WorkspaceAccess key={account + selected} workspace={workspace} platform={platformView && admin} role={membership?.role} onUpdated={loadWorkspaces} />}
      {!platformView && isMember && agency && panel === 'command' && <AgencyCommandMap key={account + selected} workspaceId={selected}
        canManageCameras={canManage || admin} openCamera={id => { setRequestedCamera(id); setPanel('cameras'); }} />}
      {!platformView && isMember && panel === 'cameras' && <WorkspaceCameras key={account + selected} workspaceId={selected} agency={agency}
        initialCameraId={requestedCamera} canAdd={canManage || admin} />}
      {!platformView && isMember && agency && panel === 'vehicles' && <VehicleWatchlist key={account + selected} workspaceId={selected} />}
      {!platformView && isMember && agency && panel === 'faces' && <FaceComparison key={account + selected} workspaceId={selected} />}
      {!platformView && isMember && agency && panel === 'gallery' && <FaceComparison key={account + selected + 'gallery'} workspaceId={selected} gallery />}
      {!platformView && isMember && panel === 'records' && <div className="lv-grid">
        <section className="lv-card"><h2>{agency ? 'Investigation register' : 'Site and incident records'}</h2>
          {recordScope !== account + selected ? <p>Loading records…</p> : recordsFailed ? (
            <p role="alert">Records could not be loaded. <button type="button" className="lv-secondary" onClick={() => setRecordsAttempt(attempt => attempt + 1)}>Retry records</button></p>
          ) : !records.length && <p>No records in this workspace yet.</p>}
          {recordScope === account + selected && records.map(record => <article key={record.id}>
            <small>{record.category} · {new Date(record.created_at).toLocaleDateString()}</small>
            <h3>{record.title}</h3><p>{record.details}</p>
            {record.category !== 'site' && <form onSubmit={event => submit(event, async fields => {
              const { data, error } = await supabase.rpc('lv_change_record_status', {
                target_id: record.id, expected_status: record.status, new_status: fields.get('status'),
              });
              if (error) throw new Error(error.message);
              const updated = data as RecordRow;
              setRecords(previous => previous.map(item => item.id === updated.id ? updated : item));
            })}>
              <label>{statusLabel[record.status]}
                <select name="status" aria-label={'New status for ' + record.title}>
                  {statusActions[record.status].map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}
                </select>
              </label>
              <button className="lv-secondary" disabled={busy}>Update status</button>
            </form>}
            {!agency && record.category === 'incident' && <CorrectiveActions incidentId={record.id} />}
          </article>)}
        </section>
        <section className="lv-card"><h2>{agency ? 'Record an investigation' : 'Add a site or incident'}</h2>
          <form onSubmit={event => submit(event, async fields => {
            const { data, error } = await supabase.from('lv_records').insert({ workspace_id: selected, category: agency ? 'investigation' : fields.get('category'), title: String(fields.get('title')).trim(), details: fields.get('details') }).select(recordColumns).single();
            if (error) throw new Error(error.message);
            setRecords(previous => [data as RecordRow, ...previous]);
          })}>
            {!agency && <label>Category<select name="category"><option value="site">Site</option><option value="incident">Incident</option></select></label>}
            <label>Title<input name="title" required minLength={2} maxLength={140} /></label>
            <label>Details<textarea name="details" maxLength={4000} /></label><button disabled={busy || recordScope !== account + selected}>Save record</button>
          </form>
        </section>
      </div>}
    </>}
    </>}
    </main>
  </div>;
}
