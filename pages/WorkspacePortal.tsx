import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { supabase, workspaceEnabled } from '../services/supabase';
import BusinessSignup from '../components/BusinessSignup';
import {LocationPicker, RecordLocationEditor, type RecordPosition} from '../components/RecordLocation';
import { signupOrganization } from '../services/businessOnboarding';
import { WorkspaceCameras } from '../components/WorkspaceCameras';
import VehicleWatchlist from '../components/VehicleWatchlist';
import VehicleRegistry from '../components/VehicleRegistry';
import WorkspaceAccess from '../components/WorkspaceAccess';
import FaceComparison from '../components/FaceComparison';
import WorkspaceOverview from '../components/WorkspaceOverview';
import CorrectiveActions from '../components/CorrectiveActions';
import AgencyCommandMap from '../components/AgencyCommandMap';
import AgencyAccountIssuer from '../components/AgencyAccountIssuer';
import CameraControlCenter from '../components/CameraControlCenter';
import IntelligenceDashboard from '../components/IntelligenceDashboard';
import { Layout, type WorkspaceNavigationGroup } from '../components/Layout';
import { UserRole } from '../types';
import WorkspaceObservations from '../components/WorkspaceObservations';
import VideoAnalysis from '../components/VideoAnalysis';
import AgencyOperations from '../components/AgencyOperations';
import SubjectEnrollmentCenter from '../components/SubjectEnrollmentCenter';
import LiveAlertPopupHost from '../components/LiveAlertPopup';
import { subscribeAlertsChanged } from '../services/liveAlertBus';
import { defaultFeatureMap, WorkspaceFeatureMap } from '../services/videoIntelligence';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  Building2,
  Camera,
  Car,
  ClipboardList,
  Database,
  FileText,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Map,
  PlayCircle,
  ScanFace,
  Search,
  Settings,
  Shield,
  Sliders,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';

type Workspace = {
  id: string;
  name: string;
  kind: 'business' | 'agency';
  active: boolean;
  entitlement: string;
  organization_details: string;
};
type PlatformOrg = {
  id: string;
  name: string;
  kind: 'business' | 'agency';
  active: boolean;
  features: WorkspaceFeatureMap;
};
type RecordStatus = 'open' | 'in_review' | 'resolved';
type RecordRow = { id: string; title: string; details: string; category: string; status: RecordStatus; created_at: string; latitude?: number | null; longitude?: number | null };
const recordColumns = 'id,title,details,category,status,created_at,latitude,longitude';
const statusLabel = { open: 'Open', in_review: 'In review', resolved: 'Resolved' };
const statusActions = { open: ['in_review', 'resolved'], in_review: ['open', 'resolved'], resolved: ['open'] } as const;
const portalEnabled = workspaceEnabled && import.meta.env.VITE_WORKSPACE_PORTAL_ENABLED === 'true';
const googleEnabled = import.meta.env.VITE_GOOGLE_SIGN_IN_ENABLED === 'true';
const emailFlowsEnabled = import.meta.env.VITE_EMAIL_AUTH_FLOWS_ENABLED !== 'false';
const panelIcons = {
  overview: LayoutDashboard,
  command: Map,
  intelligence: BarChart3,
  cameras: Camera,
  camera_config: Sliders,
  playback: PlayCircle,
  alerts: Bell,
  records: ClipboardList,
  vehicles: Shield,
  vehicle_registry: Car,
  faces: ScanFace,
  gallery: Search,
  enrollment: UserPlus,
  search_history: Activity,
  access: Users,
  issue: UserPlus,
  password: KeyRound,
  history: Activity,
};

function RecordActivity({ recordId, status }: { recordId: string; status: RecordStatus }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: number; previous_status: RecordStatus; next_status: RecordStatus; created_at: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    void supabase
      .from('lv_record_activity')
      .select('id,previous_status,next_status,created_at')
      .eq('record_id', recordId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!active) return;
        setFailed(Boolean(error));
        setItems((data ?? []) as { id: number; previous_status: RecordStatus; next_status: RecordStatus; created_at: string }[]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, recordId, status, attempt]);

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Status history</summary>
      {open &&
        (loading ? (
          <p>Loading status history…</p>
        ) : failed ? (
          <p role="alert">
            Status history could not be loaded.{' '}
            <button type="button" className="lv-secondary" onClick={() => setAttempt((value) => value + 1)}>
              Retry
            </button>
          </p>
        ) : !items.length ? (
          <p>No status transitions recorded yet.</p>
        ) : (
          items.map((item) => (
            <p key={item.id}>
              <small>
                {statusLabel[item.previous_status] ?? item.previous_status} → {statusLabel[item.next_status] ?? item.next_status} ·{' '}
                {new Date(item.created_at).toLocaleString()}
              </small>
            </p>
          ))
        ))}
    </details>
  );
}

export default function WorkspacePortal({ agency, platformView }: { agency: boolean; platformView: boolean }) {
  const kind = agency ? 'agency' : 'business';
  const signInPath = platformView ? '/agency/admin' : agency ? '/agency' : '/business';
  const [panel, setPanel] = useState(agency && !platformView ? 'command' : 'overview');
  const pageHistory = useRef<string[]>([]);
  const [requestedCamera, setRequestedCamera] = useState<string>();
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const accountRef = useRef<string | null>(null);
  const signupWorkspaceName = useRef<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [ready, setReady] = useState(!portalEnabled);
  const [register, setRegister] = useState(
    () => !agency && emailFlowsEnabled && new URLSearchParams(location.search).get('mode') === 'register',
  );
  const [requestReset, setRequestReset] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [platformOrgs, setPlatformOrgs] = useState<PlatformOrg[]>([]);
  const [memberships, setMemberships] = useState<{ workspace_id: string; role: string; clearance?: number; allowed_modules?: string[] }[]>([]);
  const [admin, setAdmin] = useState(false);
  const [selected, setSelected] = useState('');
  const [features, setFeatures] = useState<WorkspaceFeatureMap>(() => defaultFeatureMap(agency));
  const [alertSummary, setAlertSummary] = useState<{ open: number; high: number }>({ open: 0, high: 0 });
  const [alertTick, setAlertTick] = useState(0);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [recordLocation, setRecordLocation] = useState<RecordPosition | null>(null);
  const [locatingRecord, setLocatingRecord] = useState(false);
  const [recordScope, setRecordScope] = useState('');
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [recordsAttempt, setRecordsAttempt] = useState(0);
  const [recordQuery, setRecordQuery] = useState('');
  const [recordStatusFilter, setRecordStatusFilter] = useState<'all' | RecordStatus>('all');
  const [recordCategoryFilter, setRecordCategoryFilter] = useState<'all' | 'site' | 'incident'>('all');
  const [agencyQuery, setAgencyQuery] = useState('');
  const [agencyStatusFilter, setAgencyStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedAgency = workspaces.find((item) => item.id === selected);
  const selectedPlatformOrg = platformOrgs.find((item) => item.id === selected);
  const workspace: Workspace | undefined =
    loadedFor === account
      ? selectedAgency ||
        (selectedPlatformOrg
          ? {
              id: selectedPlatformOrg.id,
              name: selectedPlatformOrg.name,
              kind: selectedPlatformOrg.kind,
              active: selectedPlatformOrg.active,
              entitlement: '',
              organization_details: '',
            }
          : undefined)
      : undefined;
  const membership = loadedFor === account ? memberships.find((item) => item.workspace_id === selected) : undefined;
  const isMember = Boolean(membership);

  useEffect(() => {
    if (!portalEnabled) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      signupWorkspaceName.current = signupOrganization(session?.user.user_metadata);
      accountRef.current = session?.user.id ?? null;
      setAccount(accountRef.current);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function loadWorkspaces() {
    const requestingAccount = accountRef.current;
    setWorkspaceLoadFailed(false);
    if (workspaceLoadFailed) setLoadedFor(null);
    try {
    let [teams, members, platform] = await Promise.all([
      supabase.from('lv_workspaces').select('id,name,kind,active,entitlement,organization_details').eq('kind', kind).order('name'),
      supabase.from('lv_memberships').select('workspace_id,role,clearance,allowed_modules'),
      agency ? supabase.from('lv_platform_admins').select('user_id') : Promise.resolve({ data: [], error: null }),
    ]);
    if (requestingAccount !== accountRef.current) return;
    if (teams.error || members.error || platform.error) throw new Error('Workspace access could not be loaded.');
    if (!agency && !platformView && signupWorkspaceName.current
        && !teams.data.some(team => members.data.some(member => member.workspace_id === team.id))) {
      const created = await supabase.rpc('lv_create_business', {workspace_name: signupWorkspaceName.current});
      if (requestingAccount !== accountRef.current) return;
      if (created.error) throw new Error('Your account is ready, but workspace setup could not finish. Please retry workspace access.');
      [teams, members] = await Promise.all([
        supabase.from('lv_workspaces').select('id,name,kind,active,entitlement,organization_details').eq('kind', kind).order('name'),
        supabase.from('lv_memberships').select('workspace_id,role,clearance,allowed_modules'),
      ]);
      if (requestingAccount !== accountRef.current) return;
      if (teams.error || members.error) throw new Error('Your workspace was created, but access could not be loaded. Please retry.');
      if (!teams.data.some(team => members.data.some(member => member.workspace_id === team.id))) {
        throw new Error('Your workspace is not accessible yet. Please retry workspace access or contact your administrator.');
      }
    }

    setWorkspaces(teams.data as Workspace[]);
    setMemberships(members.data);
    const isAdminUser = Boolean(platform.data?.length);
    setAdmin(isAdminUser);

    if (platformView && isAdminUser) {
      const { data: orgs } = await supabase.rpc('lv_platform_organizations');
      if (Array.isArray(orgs)) {
        setPlatformOrgs(orgs as PlatformOrg[]);
      }
    } else {
      setPlatformOrgs([]);
    }

    const available = platformView
      ? teams.data
      : teams.data.filter((team) => members.data.some((member) => member.workspace_id === team.id));
    let remembered = '';
    try { remembered = localStorage.getItem(`lv-workspace:${kind}:${requestingAccount}`) ?? ''; } catch { /* Storage can be disabled. */ }
    setSelected((previous) => available.some(item => item.id === previous) ? previous
      : available.some(item => item.id === remembered) ? remembered : available[0]?.id ?? '');
    setWorkspaceLoadFailed(false);
    setLoadedFor(requestingAccount);
    } catch (error) {
      if (requestingAccount === accountRef.current) {
        setWorkspaceLoadFailed(true);
        setLoadedFor(requestingAccount);
      }
      throw error;
    }
  }

  useEffect(() => {
    setLoadedFor(null);
    setPanel(agency && !platformView ? 'command' : 'overview');
    if (!account) {
      setWorkspaces([]);
      setPlatformOrgs([]);
      setMemberships([]);
      setAdmin(false);
      setSelected('');
      return;
    }
    void loadWorkspaces().catch((error) => {
      if (accountRef.current === account) {
        setWorkspaces([]);
        setPlatformOrgs([]);
        setMemberships([]);
        setAdmin(false);
        setSelected('');
        setNotice(error.message);
        setWorkspaceLoadFailed(true);
        setLoadedFor(account);
      }
    });
  }, [account]);

  useEffect(() => {
    if (account && loadedFor === account && selected && !workspaceLoadFailed) {
      try { localStorage.setItem(`lv-workspace:${kind}:${account}`, selected); } catch { /* Optional preference. */ }
    }
  }, [account, loadedFor, selected, kind, workspaceLoadFailed]);

  useEffect(() => {
    if (!account || !selected || platformView || !isMember) {
      setFeatures(defaultFeatureMap(agency));
      setAlertSummary({ open: 0, high: 0 });
      return;
    }
    let active = true;
    void Promise.all([
      supabase.rpc('lv_workspace_feature_map', { target: selected }),
      supabase.rpc('lv_alert_summary', { target: selected }),
    ]).then(([featRes, alertRes]) => {
      if (!active) return;
      if (featRes.data && typeof featRes.data === 'object' && !Array.isArray(featRes.data)) {
        setFeatures({ ...defaultFeatureMap(agency), ...(featRes.data as Partial<WorkspaceFeatureMap>) });
      } else {
        setFeatures(defaultFeatureMap(agency));
      }
      if (alertRes.data && typeof alertRes.data === 'object' && !Array.isArray(alertRes.data)) {
        setAlertSummary({
          open: Number((alertRes.data as any).open || 0),
          high: Number((alertRes.data as any).high || 0),
        });
      }
    });
    const unsub = subscribeAlertsChanged(() => setAlertTick((t) => t + 1));
    return () => {
      active = false;
      unsub();
    };
  }, [account, selected, isMember, platformView, agency, alertTick, panel]);

  useEffect(() => {
    setRecords([]);
    setRecordLocation(null);
    setLocatingRecord(false);
    setRecordScope('');
    setRecordsFailed(false);
    if (!account || !selected || !isMember) return;
    let current = true;
    void supabase
      .from('lv_records')
      .select(recordColumns)
      .eq('workspace_id', selected)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (current) {
          if (error) setRecordsFailed(true);
          else setRecords(data as RecordRow[]);
          setRecordScope(account + selected);
        }
      });
    return () => {
      current = false;
    };
  }, [account, selected, isMember, recordsAttempt]);

  async function transitionRecordStatus(record: RecordRow, nextStatus: RecordStatus) {
    let { data, error } = await supabase.rpc('lv_change_record_status', {
      target_id: record.id,
      expected_status: record.status,
      new_status: nextStatus,
    });
    // Fallback for databases enforcing open -> in_review -> resolved two-step workflow
    if (error && record.status === 'open' && nextStatus === 'resolved' && error.message.includes('Invalid status transition')) {
      const mid = await supabase.rpc('lv_change_record_status', {
        target_id: record.id,
        expected_status: 'open',
        new_status: 'in_review',
      });
      if (mid.error) throw new Error(mid.error.message);
      const fin = await supabase.rpc('lv_change_record_status', {
        target_id: record.id,
        expected_status: 'in_review',
        new_status: 'resolved',
      });
      data = fin.data;
      error = fin.error;
    }
    if (error) throw new Error(error.message);
    const updated = data as RecordRow;
    setRecords((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function submit(event: FormEvent<HTMLFormElement>, operation: (fields: FormData) => Promise<void>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setNotice('');
    try {
      await operation(new FormData(form));
      form.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + signInPath },
      });
      if (error) throw error;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Google sign-in could not be started.');
      setBusy(false);
    }
  }

  const message = notice && <p role="status">{notice}</p>;
  if (recovering && account)
    return (
      <main className="lv-access">
        <section className="lv-card">
          <h1>Set a new password</h1>
          <form
            onSubmit={(event) =>
              submit(event, async (fields) => {
                const { error } = await supabase.auth.updateUser({ password: String(fields.get('password')) });
                if (error) throw new Error(error.message);
                const signedOut = await supabase.auth.signOut();
                if (signedOut.error) throw new Error(signedOut.error.message);
                setRecovering(false);
                setNotice('Password updated. Sign in with your new password.');
              })
            }
          >
            <label>
              New password
              <input type="password" name="password" minLength={platformView ? 16 : 12} autoComplete="new-password" required />
            </label>
            <button disabled={busy}>Update password</button>
          </form>
          {message}
        </section>
      </main>
    );

  if (!account && !agency && register && !requestReset && ready && portalEnabled) {
    return <BusinessSignup onSignIn={() => { setRegister(false); setNotice(''); }}
      onGoogle={googleEnabled ? () => void signInWithGoogle() : undefined} notice={notice} externalBusy={busy}/>;
  }

  if (!account)
    return (
      <main className="lv-access">
        <section className="lv-card">
          <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="220" />
          <h1>
            {requestReset
              ? 'Reset your password'
              : platformView
                ? 'Platform administrator sign-in'
                : agency
                  ? 'Agency sign-in'
                  : register
                    ? 'Create a business account'
                    : 'Business workspace'}
          </h1>
          {!portalEnabled ? (
            <p>Workspace connection is unavailable.</p>
          ) : !ready ? (
            <p>Checking session…</p>
          ) : (
            <form
              onSubmit={(event) =>
                submit(event, async (fields) => {
                  const email = String(fields.get('email')).trim();
                  if (requestReset) {
                    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + signInPath });
                    if (error) throw new Error(error.message);
                    setRequestReset(false);
                    setNotice('If this account can receive mail, a password reset link will arrive shortly.');
                    return;
                  }
                  const credentials = { email, password: String(fields.get('password')) };
                  const result = register
                    ? await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: location.origin + '/business' } })
                    : await supabase.auth.signInWithPassword(credentials);
                  if (result.error) throw new Error(result.error.message);
                  if (register && !result.data.session) setNotice('Check your email to confirm your account.');
                })
              }
            >
              <label>
                Email
                <input type="email" name="email" autoComplete="email" required />
              </label>
              {!requestReset && (
                <label>
                  Password
                  <input
                    type="password"
                    name="password"
                    minLength={register ? 12 : undefined}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    required
                  />
                </label>
              )}
              <button disabled={busy}>{requestReset ? 'Send reset link' : register ? 'Create account' : 'Sign in'}</button>
              {!register && emailFlowsEnabled && (
                <button
                  disabled={busy}
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    setRequestReset(!requestReset);
                    setNotice('');
                  }}
                >
                  {requestReset ? 'Back to sign-in' : 'Forgot password?'}
                </button>
              )}
              {!agency && !requestReset && emailFlowsEnabled && (
                <button
                  disabled={busy}
                  type="button"
                  className="lv-secondary"
                  onClick={() => {
                    setRegister(!register);
                    setNotice('');
                  }}
                >
                  {register ? 'Back to sign-in' : 'Create a business account'}
                </button>
              )}
              {googleEnabled && !requestReset && (
                <button disabled={busy} type="button" className="lv-secondary" onClick={() => void signInWithGoogle()}>
                  Continue with Google
                </button>
              )}
            </form>
          )}
          {message}
        </section>
      </main>
    );

  const canManage = (platformView && admin) || membership?.role === 'owner' || membership?.role === 'admin';
  const panelModules: Record<string,string> = {command:'monitor',cameras:'monitor',fleet:'monitor',intel:'monitor',alerts:'monitor',
    camera_config:'monitor',playback:'analytics',history:'analytics',intelligence:'analytics',rules:'analytics',records:'records',
    evidence:'evidence',vehicles:'vehicles',watchlist:'vehicles',vehicle_registry:'vehicles',access:'access',officers:'access',
    faces:'records',gallery:'records',enrollment:'records',search_history:'records',crawler:'records',crawled_faces:'records'};
  const canOpenPanel = (id: string) => canManage || !panelModules[id] || !membership?.allowed_modules
    || membership.allowed_modules.includes(panelModules[id]);
  const minPasswordLength = platformView ? 16 : 12;

  const businessPanels = [
    ['overview', 'Overview'],
    ...(isMember && features.business_intelligence ? [['intelligence', 'Business intelligence']] : []),
    ...(isMember
      ? [
          ['cameras', 'Cameras'],
          ['camera_config', 'Camera intelligence'],
          ['playback', 'Playback'],
          ['alerts', alertSummary.open > 0 ? `Alerts (${alertSummary.open})` : 'Alerts'],
          ['records', 'Sites & incidents'],
          ['history', 'Detection history'],
        ]
      : []),
    ...(canManage ? [['access', 'Organization staff']] : []),
    ['password', 'Change password'],
  ];

  const agencyPanels = [
    ['overview', 'Overview'],
    ...(isMember
      ? [
          ['command', 'Command Center'],
          ...(features.security_intelligence ? [['intelligence', 'Security intelligence']] : []),
          ['cameras', 'Cameras'],
          ['camera_config', 'Camera intelligence'],
          ['playback', 'Playback'],
          ['alerts', alertSummary.open > 0 ? `Alerts (${alertSummary.open})` : 'Alerts'],
          ['records', 'Investigations'],
          ...(features.anpr ? [['vehicles', 'Vehicle watchlist']] : []),
          ...(features.vehicle_registry ? [['vehicle_registry', 'Vehicle registry']] : []),
          ['faces', 'Face comparison'],
          ['gallery', 'Gallery search'],
          ...(features.biometric_enrollment ? [['enrollment', 'Enroll subject']] : []),
          ...(features.face_search ? [['search_history', 'Search history']] : []),
          ['history', 'Detection history'],
        ]
      : []),
    ...(canManage ? [['access', 'Agency personnel']] : []),
    ['password', 'Change password'],
  ];

  const panels = (agency ? agencyPanels : businessPanels).filter(([id])=>canOpenPanel(id));
  const visiblePanels = platformView
    ? [
        ...(workspace
          ? [
              ['overview', 'Overview'],
              ...(workspace.kind === 'agency' ? [['issue', 'Issue account']] : []),
              ['access', workspace.kind === 'business' ? 'Organization features' : 'Agency personnel & features'],
            ]
          : []),
        ['password', 'Change password'],
      ]
    : panels;

  const section = visiblePanels.find(([id]) => id === panel)?.[1] ?? 'Overview';
  const restoredAgency = agency && !platformView;
  const filteredAgencies = workspaces.filter(
    (item) =>
      (agencyStatusFilter === 'all' || (agencyStatusFilter === 'active' ? item.active : !item.active)) &&
      (item.name + ' ' + item.entitlement).toLowerCase().includes(agencyQuery.trim().toLowerCase()),
  );
  const filteredRecords = records.filter(
    (record) =>
      (agency || recordCategoryFilter === 'all' || record.category === recordCategoryFilter) &&
      (recordStatusFilter === 'all' || (record.category === 'site' && recordStatusFilter === 'open')
        ? recordStatusFilter === 'all'
        : record.status === recordStatusFilter) &&
      (record.title + ' ' + record.details).toLowerCase().includes(recordQuery.trim().toLowerCase()),
  );

  function navigate(id: string) {
    if (!canOpenPanel(id)) { setNotice('Your account does not have access to this module.'); return; }
    if (id === panel) return;
    pageHistory.current.push(panel);
    setRequestedCamera(undefined);
    if (id !== 'intelligence') setRequestedEventId(null);
    setPanel(id);
  }

  function inspectEvent(eventId: string) {
    setRequestedEventId(eventId);
    navigate('intelligence');
  }

  function openCameraConfig(cameraId: string) {
    setRequestedCamera(cameraId);
    navigate('camera_config');
  }

  function goBack() {
    setRequestedCamera(undefined);
    setRequestedEventId(null);
    setPanel(pageHistory.current.pop() ?? (agency && !platformView ? 'command' : 'overview'));
  }

  const shellGroups: WorkspaceNavigationGroup[] = [
    {
      label: 'Command',
      items: [
        { id: 'command', label: 'Command centre', icon: Map },
        ...(features.security_intelligence ? [{ id: 'intelligence', label: 'Security intelligence', icon: BarChart3 }] : []),
      ],
    },
    {
      label: 'Monitor',
      items: [
        { id: 'cameras', label: 'Live cameras', icon: Camera },
        { id: 'camera_config', label: 'Camera intelligence', icon: Sliders },
        { id: 'playback', label: 'Playback', icon: PlayCircle },
        { id: 'alerts', label: alertSummary.open > 0 ? `Alerts (${alertSummary.open})` : 'Alerts', icon: Bell },
      ],
    },
    {
      label: 'Investigate',
      items: [
        { id: 'records', label: 'Incidents', icon: ClipboardList },
        { id: 'evidence', label: 'Evidence', icon: FileText },
        ...(features.anpr ? [{ id: 'vehicles', label: 'Vehicle watchlist', icon: Shield }] : []),
        ...(features.vehicle_registry ? [{ id: 'vehicle_registry', label: 'Vehicle registry', icon: Car }] : []),
      ],
    },
    {
      label: 'Operate',
      items: [
        { id: 'fleet', label: 'Device fleet', icon: Camera },
        { id: 'rules', label: 'AI rules', icon: SlidersHorizontal },
        { id: 'overview', label: 'Analytics', icon: Activity },
        { id: 'password', label: 'Change password', icon: KeyRound },
      ],
    },
    ...(canManage
      ? [
          {
            label: 'Administer',
            items: [
              { id: 'access', label: 'Access & audit', icon: FileText },
              { id: 'integrations', label: 'Integrations', icon: Shield },
            ],
          },
        ]
      : []),
    {
      label: 'EagleEye investigation',
      items: [
        { id: 'gallery', label: 'Face search', icon: Search },
        { id: 'intel', label: 'Intel map', icon: Globe },
        ...(features.biometric_enrollment ? [{ id: 'enrollment', label: 'Enroll subject', icon: UserPlus }] : []),
        ...(features.face_search ? [{ id: 'search_history', label: 'Search history', icon: Activity }] : []),
        { id: 'watchlist', label: 'Watchlist', icon: Users },
        { id: 'history', label: 'Detection history', icon: Activity },
        ...(canManage
          ? [
              { id: 'officers', label: 'Officer management', icon: Users },
              { id: 'crawler', label: 'Web crawler', icon: Globe },
              { id: 'crawled_faces', label: 'Crawled faces', icon: Database },
              { id: 'configuration', label: 'Configuration', icon: Settings },
            ]
          : []),
        { id: 'faces', label: 'Face comparison', icon: ScanFace },
      ],
    },
  ];

  const pendingPages: Record<string, { title: string; detail: string }> = {
    crawler: {
      title: 'Web crawler',
      detail: 'Face collection and biometric indexing from websites are unavailable in this agency console. Use Enroll subject to ingest authorized criminal dossiers and agency photo datasets.',
    },
    crawled_faces: {
      title: 'Crawled faces',
      detail: 'No face-collection crawler is enabled. This page does not contain a web-scraped biometric gallery; open Enroll subject for authorized biometric records.',
    },
  };

  const content = (
    <div className={restoredAgency ? 'lv-restored-agency' : 'lv-console'}>
      {!restoredAgency && (
        <>
          <aside className="lv-console-rail">
            <div className="lv-console-brand">
              <img src="/logo/lunar-vision-white.png" alt="Lunar Vision" width="148" />
              <span>{platformView ? 'Platform administration' : agency ? 'Agency operations' : 'Business operations'}</span>
            </div>
            {workspace && (
              <label className="lv-console-switch">
                <Building2 size={17} aria-hidden="true" />
                <span>Workspace</span>
                <select
                  disabled={busy}
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPanel('overview');
                    setRequestedCamera(undefined);
                    setRequestedEventId(null);
                  }}
                >
                  {(platformView && platformOrgs.length > 0
                    ? platformOrgs
                    : workspaces.filter((item) => platformView || memberships.some((member) => member.workspace_id === item.id))
                  ).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.kind})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {((workspace && !platformView) || (platformView && loadedFor === account && admin)) && (
              <nav aria-label="Workspace navigation">
                {visiblePanels.map(([id, label]) => {
                  const Icon = panelIcons[id as keyof typeof panelIcons] || LayoutDashboard;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-current={panel === id ? 'page' : undefined}
                      onClick={() => navigate(id)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </nav>
            )}
            <div className="lv-console-session">
              {loadedFor === account && agency && admin && (
                <a href={platformView ? '/agency' : '/agency/admin'}>
                  {platformView ? 'Agency workspace' : 'Platform administration'}
                </a>
              )}
              <button
                type="button"
                onClick={() =>
                  void supabase.auth.signOut().then(({ error }) => {
                    if (error) setNotice(error.message);
                  })
                }
              >
                <LogOut size={16} aria-hidden="true" /> Sign out
              </button>
            </div>
          </aside>
        </>
      )}
      <main className="lv-portal lv-console-main">
        <div className="lv-dashboard-return">
          <button type="button" onClick={goBack}>
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          <button type="button" onClick={() => navigate(agency && !platformView ? 'command' : 'overview')}>
            {agency && !platformView ? 'Command centre' : 'Overview'}
          </button>
          {!platformView && isMember && (
            <button
              type="button"
              onClick={() => navigate('alerts')}
              style={{
                color: alertSummary.high > 0 ? '#ff8b89' : alertSummary.open > 0 ? '#ffcc83' : '#76efd6',
                fontWeight: alertSummary.open > 0 ? 700 : 500,
              }}
            >
              <Bell size={14} aria-hidden="true" />{' '}
              {alertSummary.open > 0
                ? `${alertSummary.open} open alerts${alertSummary.high > 0 ? ` (${alertSummary.high} high priority)` : ''}`
                : 'No open alerts'}
            </button>
          )}
          {!agency && <a href="/">Return to website</a>}
        </div>
        <header className="lv-console-heading">
          <div>
            <p>{workspace?.name ?? (agency ? 'Agency workspace' : 'Organization workspace')}</p>
            <h1>
              {workspace
                ? restoredAgency
                  ? shellGroups.flatMap((group) => group.items).find((item) => item.id === panel)?.label ?? section
                  : section
                : platformView
                  ? 'Agency administration'
                  : agency
                    ? 'Agency command workspace'
                    : 'Business operations'}
            </h1>
          </div>
          {workspace && (
            <span className="lv-console-status" data-active={workspace.active}>
              {workspace.active ? 'Active workspace' : 'Suspended'}
            </span>
          )}
        </header>
        {message}
        {workspaceLoadFailed ? (
          <section className="lv-card" role="alert"><h2>Workspace access could not be loaded</h2>
            <p>Your saved organization has not been reset. Retry the connection before creating a workspace.</p>
            <button type="button" disabled={busy} onClick={() => {
              setBusy(true);
              void loadWorkspaces().catch(() => setWorkspaceLoadFailed(true)).finally(() => setBusy(false));
            }}>Retry workspace access</button>
          </section>
        ) : loadedFor !== account ? (
          <p>Loading workspace access…</p>
        ) : platformView && !admin ? (
          <p>Platform administrator access is required.</p>
        ) : (
          <>
            {platformView && admin && panel === 'overview' && (
              <div className="lv-console-metrics">
                <section className="lv-card">
                  <h2>Registered agencies</h2>
                  <strong>{workspaces.length}</strong>
                </section>
                <section className="lv-card">
                  <h2>Active agencies</h2>
                  <strong>{workspaces.filter((item) => item.active).length}</strong>
                </section>
                <section className="lv-card">
                  <h2>Suspended agencies</h2>
                  <strong>{workspaces.filter((item) => !item.active).length}</strong>
                </section>
              </div>
            )}
            {(!platformView || admin) && panel === 'password' && (
              <section className="lv-card">
                <h2>{platformView ? 'Change your administrator password' : 'Change your account password'}</h2>
                <form
                  onSubmit={(event) =>
                    submit(event, async (fields) => {
                      const password = String(fields.get('password'));
                      if (password.length < minPasswordLength || password !== fields.get('confirm'))
                        throw new Error(`Enter matching passwords with at least ${minPasswordLength} characters.`);
                      const { data, error: userError } = await supabase.auth.getUser();
                      if (userError || !data.user?.email || data.user.id !== account)
                        throw new Error('Sign in again before changing your password.');
                      const { error: signInError } = await supabase.auth.signInWithPassword({
                        email: data.user.email,
                        password: String(fields.get('current')),
                      });
                      if (signInError) throw new Error('The current password could not be verified.');
                      const { error } = await supabase.auth.updateUser({ password });
                      if (error) throw error;
                      const signedOut = await supabase.auth.signOut();
                      setNotice(
                        signedOut.error
                          ? 'Password changed. Sign out and sign in with your new password.'
                          : 'Password changed. Sign in with your new password.',
                      );
                    })
                  }
                >
                  <label>
                    Current password
                    <input type="password" name="current" autoComplete="current-password" required />
                  </label>
                  <label>
                    New password, at least {minPasswordLength} characters
                    <input type="password" name="password" minLength={minPasswordLength} autoComplete="new-password" required />
                  </label>
                  <label>
                    Confirm new password
                    <input type="password" name="confirm" minLength={minPasswordLength} autoComplete="new-password" required />
                  </label>
                  <button disabled={busy}>Update password</button>
                </form>
              </section>
            )}
            {((!agency && !workspaces.length) || (platformView && admin && panel === 'overview')) && (
              <section className="lv-card">
                <h2>{agency ? 'Create an agency' : 'Set up your organization'}</h2>
                <form
                  onSubmit={(event) =>
                    submit(event, async (fields) => {
                      const { data, error } = await supabase.rpc(agency ? 'lv_create_agency' : 'lv_create_business', {
                        workspace_name: fields.get('name'),
                      });
                      if (error) throw new Error(error.message);
                      await loadWorkspaces();
                      if (platformView && typeof data === 'string') {
                        setSelected(data);
                        setPanel('issue');
                      }
                    })
                  }
                >
                  <label>
                    Organization name
                    <input name="name" required minLength={2} maxLength={100} />
                  </label>
                  <button disabled={busy}>Create workspace</button>
                </form>
              </section>
            )}
            {platformView && admin && panel === 'overview' && workspaces.length > 0 && (
              <section className="lv-card">
                <h2>Agency directory</h2>
                <div className="lv-observation-filters">
                  <label>
                    Search agencies
                    <input value={agencyQuery} onChange={(event) => setAgencyQuery(event.target.value)} />
                  </label>
                  <label>
                    Agency status
                    <select
                      value={agencyStatusFilter}
                      onChange={(event) => setAgencyStatusFilter(event.target.value as 'all' | 'active' | 'suspended')}
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </label>
                </div>
                {!filteredAgencies.length ? (
                  <p>No agencies match these filters.</p>
                ) : (
                  filteredAgencies.map((item) => (
                    <article key={item.id}>
                      <h3>{item.name}</h3>
                      <p>
                        {item.active ? 'Active' : 'Suspended'}
                        {item.entitlement ? ' · ' + item.entitlement : ''}
                      </p>
                      <div className="lv-video-actions">
                        <button
                          type="button"
                          className="lv-secondary"
                          aria-pressed={selected === item.id}
                          onClick={() => setSelected(item.id)}
                        >
                          {selected === item.id ? 'Selected' : 'Select agency'}
                        </button>
                        <button
                          type="button"
                          className="lv-secondary"
                          onClick={() => {
                            setSelected(item.id);
                            navigate('issue');
                          }}
                        >
                          Issue account
                        </button>
                        <button
                          type="button"
                          className="lv-secondary"
                          onClick={() => {
                            setSelected(item.id);
                            navigate('access');
                          }}
                        >
                          Agency personnel &amp; features
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </section>
            )}
            {platformView && admin && panel === 'overview' && platformOrgs.some((o) => o.kind === 'business') && (
              <section className="lv-card">
                <h2>Business Organizations &amp; Feature Governance</h2>
                <p>Configure commercial intelligence and analytics feature entitlements for registered businesses.</p>
                {platformOrgs
                  .filter((o) => o.kind === 'business')
                  .map((org) => (
                    <article key={org.id}>
                      <h3>{org.name}</h3>
                      <p>{org.active ? 'Active' : 'Suspended'} · Business organization</p>
                      <div className="lv-video-actions">
                        <button
                          type="button"
                          className="lv-secondary"
                          onClick={() => {
                            setSelected(org.id);
                            navigate('access');
                          }}
                        >
                          Configure features
                        </button>
                      </div>
                    </article>
                  ))}
              </section>
            )}
            {agency && !platformView && !isMember && <p>Your account needs active membership in the selected agency.</p>}
            {workspace && (
              <>
                {platformView && admin && panel === 'issue' && (
                  <section className="lv-card">
                    {workspace.active ? (
                      <AgencyAccountIssuer key={workspace.id} workspaceId={workspace.id} agencyName={workspace.name} />
                    ) : (
                      <p>Reactivate {workspace.name} before issuing accounts.</p>
                    )}
                  </section>
                )}
                {panel === 'overview' && isMember && !platformView && (
                  <WorkspaceOverview key={account + selected} workspaceId={selected} agency={agency} navigate={setPanel} />
                )}
                {panel === 'overview' && (
                  <section className="lv-card">
                    <h2>{workspace.name}</h2>
                    <p>
                      {workspace.active ? 'Active workspace' : 'Agency access suspended'}
                      {workspace.entitlement && ' · ' + workspace.entitlement}
                    </p>
                    <p>
                      {platformView
                        ? 'Manage organization status, feature entitlements, and personnel.'
                        : agency
                          ? 'Open investigations, configure camera analytics, monitor real-time ANPR watchlists, or inspect security intelligence.'
                          : 'Connect cameras, configure detection zones, review commercial analytics, and manage your organization’s sites and incidents.'}
                    </p>
                    {!agency &&
                      (canManage ? (
                        <form
                          key={workspace.id}
                          onSubmit={(event) =>
                            submit(event, async (fields) => {
                              const { error } = await supabase.rpc('lv_set_business_details', {
                                target: selected,
                                details: fields.get('details'),
                                minimum_clearance: Number(fields.get('minimum_clearance')),
                              });
                              if (error) throw new Error(error.message);
                              setNotice('Organization details saved.');
                              await loadWorkspaces();
                            })
                          }
                        >
                          <label>
                            Organization details
                            <textarea name="details" defaultValue={workspace.organization_details} maxLength={1000} />
                          </label>
                          <button disabled={busy}>Save details</button>
                        </form>
                      ) : (
                        workspace.organization_details && <p>{workspace.organization_details}</p>
                      ))}
                  </section>
                )}
                {canManage && ['access', 'officers'].includes(panel) && (
                  <WorkspaceAccess
                    key={account + workspace.id}
                    workspace={workspace}
                    platform={platformView && admin}
                    role={membership?.role}
                    onUpdated={loadWorkspaces}
                  />
                )}
                {!platformView && isMember && agency && panel === 'command' && (
                  <>
                    <WorkspaceOverview key={account + selected + 'command'} workspaceId={selected} agency navigate={navigate} compact />
                    <AgencyCommandMap
                      key={account + selected}
                      workspaceId={selected}
                      commandView
                      canManageCameras={canManage || admin}
                      openCamera={(id) => {
                        navigate('cameras');
                        setRequestedCamera(id);
                      }}
                    />
                  </>
                )}
                {!platformView && isMember && panel === 'intelligence' && (
                  <IntelligenceDashboard
                    key={account + selected + 'intelligence'}
                    workspaceId={selected}
                    agency={agency}
                    initialEventId={requestedEventId}
                    openCamera={(id) => {
                      navigate('cameras');
                      setRequestedCamera(id);
                    }}
                    onNavigate={navigate}
                  />
                )}
                {!platformView && isMember && agency && panel === 'intel' && (
                  <AgencyCommandMap
                    key={account + selected}
                    workspaceId={selected}
                    canManageCameras={canManage || admin}
                    openCamera={(id) => {
                      navigate('cameras');
                      setRequestedCamera(id);
                    }}
                  />
                )}
                {!platformView && isMember && (panel === 'cameras' || (!agency && panel === 'fleet')) && (
                  <WorkspaceCameras
                    key={account + selected}
                    workspaceId={selected}
                    agency={agency}
                    initialCameraId={requestedCamera}
                    canAdd={canManage || admin}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    onConfigureCamera={openCameraConfig}
                    onInspectEvent={inspectEvent}
                  />
                )}
                {!platformView && isMember && panel === 'camera_config' && (
                  <CameraControlCenter
                    key={account + selected + 'camcfg'}
                    workspaceId={selected}
                    agency={agency}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    initialCameraId={requestedCamera}
                    onManageCameras={() => navigate('cameras')}
                    onRefreshAccess={loadWorkspaces}
                  />
                )}
                {!platformView && isMember && panel === 'playback' && (
                  <section className="lv-card">
                    <VideoAnalysis
                      workspaceId={selected}
                      watchlistWorkspaceId={agency && features.anpr ? selected : undefined}
                      samples
                      onInspectEvent={inspectEvent}
                    />
                  </section>
                )}
                {!platformView && isMember && !agency && panel === 'alerts' && (
                  <AgencyOperations
                    key={account + selected + 'bizalerts'}
                    workspaceId={selected}
                    mode="alerts"
                    agency={false}
                    canManage={canManage}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    onInspectEvent={inspectEvent}
                    onAlertsChanged={() => setAlertTick((t) => t + 1)}
                    openCamera={(id) => {
                      navigate('cameras');
                      setRequestedCamera(id);
                    }}
                  />
                )}
                {!platformView && isMember && agency && ['alerts', 'evidence', 'rules', 'fleet', 'integrations', 'configuration'].includes(panel) && (
                  <AgencyOperations
                    key={account + selected + panel}
                    workspaceId={selected}
                    mode={(panel === 'configuration' ? 'integrations' : panel) as 'alerts' | 'evidence' | 'rules' | 'fleet' | 'integrations'}
                    agency
                    canManage={canManage}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    onConfigureCamera={openCameraConfig}
                    onInspectEvent={inspectEvent}
                    onAlertsChanged={() => setAlertTick((t) => t + 1)}
                    openCamera={(id) => {
                      navigate('cameras');
                      setRequestedCamera(id);
                    }}
                  />
                )}
                {!platformView && isMember && agency && pendingPages[panel] && (
                  <section className="lv-card">
                    <h2>{pendingPages[panel].title}</h2>
                    <p role="status">{pendingPages[panel].detail}</p>
                    <button type="button" onClick={() => navigate('playback')}>
                      Open playback and analysis
                    </button>
                  </section>
                )}
                {!platformView && isMember && agency && ['vehicles', 'watchlist'].includes(panel) && (
                  <VehicleWatchlist
                    key={account + selected}
                    workspaceId={selected}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                  />
                )}
                {!platformView && isMember && agency && panel === 'vehicle_registry' && (
                  <VehicleRegistry
                    key={account + selected + 'registry'}
                    workspaceId={selected}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                  />
                )}
                {!platformView && isMember && agency && panel === 'faces' && (
                  <FaceComparison key={account + selected} workspaceId={selected} />
                )}
                {!platformView && isMember && agency && panel === 'gallery' && (
                  <FaceComparison
                    key={account + selected + 'gallery'}
                    workspaceId={selected}
                    gallery
                    searchEnabled={features.face_search}
                    onOpenEnrollment={features.biometric_enrollment ? () => navigate('enrollment') : undefined}
                    onOpenHistory={features.face_search ? () => navigate('search_history') : undefined}
                  />
                )}
                {!platformView && isMember && agency && panel === 'enrollment' && (
                  <SubjectEnrollmentCenter
                    key={account + selected + 'enrollment'}
                    workspaceId={selected}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    initialTab="enroll"
                    enrollmentEnabled={features.biometric_enrollment}
                    searchEnabled={features.face_search}
                    onOpenFaceSearch={features.face_search ? () => navigate('gallery') : undefined}
                  />
                )}
                {!platformView && isMember && agency && panel === 'search_history' && (
                  <SubjectEnrollmentCenter
                    key={account + selected + 'search_history'}
                    workspaceId={selected}
                    role={membership?.role}
                    platformAdmin={platformView && admin}
                    initialTab="history"
                    enrollmentEnabled={features.biometric_enrollment}
                    searchEnabled={features.face_search}
                    onOpenFaceSearch={features.face_search ? () => navigate('gallery') : undefined}
                  />
                )}
                {!platformView && isMember && panel === 'history' && (
                  <WorkspaceObservations key={account + selected} workspaceId={selected} />
                )}
                {!platformView && isMember && panel === 'records' && (
                  <div className="lv-grid lv-records-grid">
                    <section className="lv-card">
                      <h2>{agency ? 'Investigation register' : 'Site and incident records'}</h2>
                      <div className="lv-observation-filters">
                        <label>
                          Search records
                          <input value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} />
                        </label>
                        {!agency && (
                          <label>
                            Filter category
                            <select
                              value={recordCategoryFilter}
                              onChange={(event) => setRecordCategoryFilter(event.target.value as 'all' | 'site' | 'incident')}
                            >
                              <option value="all">All categories</option>
                              <option value="site">Site</option>
                              <option value="incident">Incident</option>
                            </select>
                          </label>
                        )}
                        <label>
                          Status filter
                          <select
                            value={recordStatusFilter}
                            onChange={(event) => setRecordStatusFilter(event.target.value as 'all' | RecordStatus)}
                          >
                            <option value="all">All statuses</option>
                            <option value="open">Open</option>
                            <option value="in_review">In review</option>
                            <option value="resolved">Resolved</option>
                          </select>
                        </label>
                      </div>
                      {recordScope !== account + selected ? (
                        <p>Loading records…</p>
                      ) : recordsFailed ? (
                        <p role="alert">
                          Records could not be loaded.{' '}
                          <button
                            type="button"
                            className="lv-secondary"
                            onClick={() => setRecordsAttempt((attempt) => attempt + 1)}
                          >
                            Retry records
                          </button>
                        </p>
                      ) : !records.length ? (
                        <p>No records in this workspace yet.</p>
                      ) : (
                        !filteredRecords.length && <p>No records match these filters.</p>
                      )}
                      {recordScope === account + selected &&
                        filteredRecords.map((record) => (
                          <article key={record.id}>
                            <small>
                              {record.category} · {new Date(record.created_at).toLocaleDateString()}
                            </small>
                            <h3>{record.title}</h3>
                            <p>{record.details}</p>
                            <RecordLocationEditor workspaceId={selected} record={record} readOnly={membership?.role === 'viewer'} onUpdated={position => setRecords(previous => previous.map(item => item.id === record.id ? {...item, latitude:position?.latitude??null, longitude:position?.longitude??null} : item))}/>
                            {record.category !== 'site' && (
                              <>
                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                                  <span className="lv-badge" style={{ borderColor: record.status === 'resolved' ? '#2dd4bf' : '#f59e0b', fontWeight: 700 }}>
                                    Status: {statusLabel[record.status]}
                                  </span>
                                  {record.status !== 'resolved' && (
                                    <button
                                      type="button"
                                      disabled={busy || membership?.role === 'viewer'}
                                      onClick={() => {
                                        setBusy(true);
                                        setNotice('');
                                        void transitionRecordStatus(record, 'resolved')
                                          .then(() => setNotice(`Case "${record.title}" resolved.`))
                                          .catch((err) => setNotice(err instanceof Error ? err.message : 'Could not resolve incident.'))
                                          .finally(() => setBusy(false));
                                      }}
                                    >
                                      Resolve case
                                    </button>
                                  )}
                                </div>
                                <form
                                  onSubmit={(event) =>
                                    submit(event, async (fields) => {
                                      const nextStatus = String(fields.get('status') || '') as RecordStatus;
                                      await transitionRecordStatus(record, nextStatus);
                                    })
                                  }
                                >
                                  <label>
                                    {statusLabel[record.status]}
                                    <select name="status" aria-label={'New status for ' + record.title}>
                                      {statusActions[record.status].map((status) => (
                                        <option key={status} value={status}>
                                          {statusLabel[status]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <button className="lv-secondary" disabled={busy}>
                                    Update status
                                  </button>
                                </form>
                                <RecordActivity recordId={record.id} status={record.status} />
                              </>
                            )}
                            {!agency && record.category === 'incident' && <CorrectiveActions incidentId={record.id} />}
                          </article>
                        ))}
                    </section>
                    <section className="lv-card">
                      <h2>{agency ? 'Record an investigation' : 'Add a site or incident'}</h2>
                      <form
                        onSubmit={(event) =>
                          submit(event, async (fields) => {
                            const { data, error } = await supabase
                              .from('lv_records')
                              .insert({
                                workspace_id: selected,
                                category: agency ? 'investigation' : fields.get('category'),
                                title: String(fields.get('title')).trim(),
                                details: fields.get('details'),
                                minimum_clearance: Number(fields.get('minimum_clearance')),
                                latitude: recordLocation?.latitude ?? null,
                                longitude: recordLocation?.longitude ?? null,
                              })
                              .select(recordColumns)
                              .single();
                            if (error) throw new Error(error.message);
                            setRecords((previous) => [data as RecordRow, ...previous]);
                            setRecordLocation(null);
                          })
                        }
                      >
                        {!agency && (
                          <label>
                            Category
                            <select name="category">
                              <option value="site">Site</option>
                              <option value="incident">Incident</option>
                            </select>
                          </label>
                        )}
                        <label>
                          Title
                          <input name="title" required minLength={2} maxLength={140} />
                        </label>
                        <label>
                          Details
                          <textarea name="details" maxLength={4000} />
                        </label>
                        <label>Minimum clearance<select name="minimum_clearance" defaultValue="0">
                          <option value="0">0 · General</option><option value="1">1 · Internal</option><option value="2">2 · Restricted</option><option value="3">3 · Confidential</option>
                        </select></label>
                        <LocationPicker value={recordLocation} onChange={setRecordLocation} onLocatingChange={setLocatingRecord} disabled={busy || membership?.role === 'viewer'}/>
                        <button disabled={busy || locatingRecord || recordScope !== account + selected || membership?.role === 'viewer'}>Save record</button>
                      </form>
                    </section>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {!platformView && isMember && selected && (
          <LiveAlertPopupHost
            workspaceId={selected}
            onOpenAlerts={() => navigate('alerts')}
            onInspectEvent={inspectEvent}
            onOpenCamera={(camId) => {
              setRequestedCamera(camId);
              navigate('cameras');
            }}
          />
        )}
      </main>
    </div>
  );
  if (!restoredAgency) return content;
  return (
    <Layout
      user={{ id: account, username: 'Agency operator', role: canManage ? UserRole.CHIEF_COMMANDER : UserRole.OFFICER, createdAt: '' }}
      currentPage={panel}
      onNavigate={navigate}
      onLogout={() =>
        void supabase.auth.signOut().then(({ error }) => {
          if (error) setNotice(error.message);
        })
      }
      scopedWorkspace={{
        name: workspace?.name ?? 'Agency workspace',
      groups: isMember ? shellGroups.map(group=>({...group,items:group.items.filter(item=>canOpenPanel(item.id))})).filter(group=>group.items.length) : [],
        controls: (
          <>
            {workspace && (
              <label>
                Agency
                <select
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPanel('command');
                    setRequestedCamera(undefined);
                    setRequestedEventId(null);
                  }}
                >
                  {workspaces
                    .filter((item) => memberships.some((member) => member.workspace_id === item.id))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {admin && <a href="/agency/admin">Platform administration</a>}
          </>
        ),
      }}
    >
      {content}
    </Layout>
  );
}
