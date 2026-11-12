import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { WorkspaceFeatureKey, WorkspaceFeatureMap, defaultFeatureMap } from '../services/videoIntelligence';
import {
  AGENCY_SIDEBAR_MODULES,
  BUSINESS_SIDEBAR_MODULES,
  toDbModuleScopes,
} from '../services/workspaceModules';

type Props = {
  workspace: { id: string; name?: string; kind?: 'business' | 'agency'; active: boolean; entitlement: string };
  platform: boolean;
  role?: string;
  viewMode?: 'full' | 'officers' | 'audit';
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
  viewer: 'Viewer · Read-only operational viewing within clearance',
};

type AuditCategory = 'all' | 'membership' | 'subject' | 'camera' | 'watchlist' | 'alert';

function classifyAuditAction(action: string): {
  category: Exclude<AuditCategory, 'all'>;
  badge: string;
  color: string;
  summary: string;
} {
  const lower = action.toLowerCase();
  if (
    lower.startsWith('membership.') ||
    lower.startsWith('feature.') ||
    lower.includes('staff') ||
    lower.includes('role')
  ) {
    return {
      category: 'membership',
      badge: 'ACCESS / ROLE',
      color: '#a855f7',
      summary: action.replace(/\./g, ' · ').replace(/_/g, ' '),
    };
  }
  if (lower.startsWith('subject.') || lower.includes('subject') || lower.includes('face')) {
    return {
      category: 'subject',
      badge: 'BIOMETRIC SUBJECT',
      color: '#f43f5e',
      summary: action.replace(/\./g, ' · ').replace(/_/g, ' '),
    };
  }
  if (lower.startsWith('camera.') || lower.includes('camera') || lower.includes('rules')) {
    return {
      category: 'camera',
      badge: 'CAMERA / RULES',
      color: '#38bdf8',
      summary: action.replace(/\./g, ' · ').replace(/_/g, ' '),
    };
  }
  if (
    lower.startsWith('vehicle_watch.') ||
    lower.startsWith('registry.') ||
    lower.includes('vehicle') ||
    lower.includes('evidence')
  ) {
    return {
      category: 'watchlist',
      badge: 'WATCHLIST / EVIDENCE',
      color: '#f59e0b',
      summary: action.replace(/\./g, ' · ').replace(/_/g, ' '),
    };
  }
  return {
    category: 'alert',
    badge: 'ALERT / CASE',
    color: '#76efd6',
    summary: action.replace(/\./g, ' · ').replace(/_/g, ' '),
  };
}

const PERSONNEL_PAGE_SIZE = 6;
const AUDIT_PAGE_SIZE = 12;

export default function WorkspaceAccess({ workspace, platform, role, viewMode = 'full', onUpdated }: Props) {
  const isBusiness = workspace.kind === 'business';
  const showPersonnelControls = viewMode !== 'audit';
  const showAuditLogs = viewMode !== 'officers';
  const sidebarModules = isBusiness ? BUSINESS_SIDEBAR_MODULES : AGENCY_SIDEBAR_MODULES;
  const moduleLabelById = useMemo(
    () => new Map(sidebarModules.map((m) => [m.id, m.label])),
    [sidebarModules],
  );

  const [staff, setStaff] = useState<{ user_id: string; email: string; role: string; clearance: number; allowed_modules: string[] }[]>([]);
  const [createAccount, setCreateAccount] = useState(viewMode === 'officers');
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');
  const [selectedClearance, setSelectedClearance] = useState(0);
  const [selectedModules, setSelectedModules] = useState<string[]>(() =>
    isBusiness ? ['overview', 'cameras', 'alerts'] : ['command', 'cameras', 'alerts', 'records'],
  );
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

  // Pagination & filters
  const [staffQuery, setStaffQuery] = useState('');
  const [staffPage, setStaffPage] = useState(0);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditCategory, setAuditCategory] = useState<AuditCategory>('all');
  const [auditPage, setAuditPage] = useState(0);

  useEffect(() => {
    setActive(workspace.active);
    setEntitlement(workspace.entitlement);
    setStaffPage(0);
    setAuditPage(0);
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
            .limit(240)
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

  const staffById = useMemo(() => {
    const map = new Map<string, { email: string; role: string; clearance: number }>();
    for (const s of staff) map.set(s.user_id, { email: s.email, role: s.role, clearance: s.clearance });
    return map;
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((m) => `${m.email} ${m.role}`.toLowerCase().includes(q));
  }, [staff, staffQuery]);

  const totalStaffPages = Math.max(1, Math.ceil(filteredStaff.length / PERSONNEL_PAGE_SIZE));
  const safeStaffPage = Math.min(staffPage, totalStaffPages - 1);
  const pagedStaff = filteredStaff.slice(safeStaffPage * PERSONNEL_PAGE_SIZE, (safeStaffPage + 1) * PERSONNEL_PAGE_SIZE);

  const filteredActivity = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    return activity.filter((ev) => {
      const meta = classifyAuditAction(ev.action);
      if (auditCategory !== 'all' && meta.category !== auditCategory) return false;
      if (!q) return true;
      const actor = staffById.get(ev.actor_id)?.email || ev.actor_id;
      const subj = ev.subject_id ? staffById.get(ev.subject_id)?.email || ev.subject_id : '';
      return `${ev.action} ${meta.summary} ${actor} ${subj}`.toLowerCase().includes(q);
    });
  }, [activity, auditCategory, auditQuery, staffById]);

  const totalAuditPages = Math.max(1, Math.ceil(filteredActivity.length / AUDIT_PAGE_SIZE));
  const safeAuditPage = Math.min(auditPage, totalAuditPages - 1);
  const pagedActivity = filteredActivity.slice(safeAuditPage * AUDIT_PAGE_SIZE, (safeAuditPage + 1) * AUDIT_PAGE_SIZE);

  async function saveStaffPermissions(emailAddress: string, accessRole: string, accessClearance: number, chosenPages: string[]) {
    const modulesToSave = chosenPages.length > 0 ? chosenPages : [sidebarModules[0]?.id || 'monitor'];
    let { error } = await supabase.rpc('lv_set_staff_access', {
      target: workspace.id,
      email_address: emailAddress,
      access_role: accessRole,
      access_clearance: accessClearance,
      modules: modulesToSave,
    });
    // Fallback cleanly if deployed Postgres only accepts coarse module categories
    if (error && error.message.includes('Invalid role, clearance or module access')) {
      const retry = await supabase.rpc('lv_set_staff_access', {
        target: workspace.id,
        email_address: emailAddress,
        access_role: accessRole,
        access_clearance: accessClearance,
        modules: toDbModuleScopes(modulesToSave, isBusiness),
      });
      error = retry.error;
    }
    if (error) throw new Error(error.message);
  }

  async function submit(event: FormEvent<HTMLFormElement>, settings: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice('');
    setSetupLink('');
    try {
      if (!settings && selectedRole !== 'revoke' && selectedModules.length === 0) {
        throw new Error('Select at least one allowed sidebar page for this account.');
      }
      if (!settings && createAccount) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('Sign in again to create a staff account.');
        const response = await fetch('/api/agency-accounts', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: workspace.id,
            email: selectedEmail || fields.get('email'),
            role: selectedRole,
            clearance: selectedClearance,
            modules: selectedModules,
            verified: fields.has('verified'),
          }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? 'Staff account creation failed.');
        setSetupLink(result?.setupLink ?? '');
        setNotice(
          result?.existing
            ? 'Existing account access updated. They use their current password.'
            : 'Officer account created. Share the one-time setup link privately so they can choose their password.',
        );
        setSelectedEmail('');
        setVersion((value) => value + 1);
        return;
      }
      if (settings) {
        const { error } = await supabase.rpc('lv_configure_agency', {
          target: workspace.id,
          enabled: active,
          access_entitlement: entitlement,
        });
        if (error) throw new Error(error.message);
        setNotice('Agency configuration saved.');
        await onUpdated();
      } else {
        await saveStaffPermissions(
          String(selectedEmail || fields.get('email')),
          selectedRole,
          selectedClearance,
          selectedModules,
        );
        form.reset();
        setSelectedEmail('');
        setSelectedRole('member');
        setSelectedClearance(0);
        setNotice('Personnel access, clearance & allowed pages updated.');
      }
      setVersion((previous) => previous + 1);
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

  function renderModuleLabel(modId: string): string {
    return moduleLabelById.get(modId) || modId;
  }

  return (
    <div className={viewMode === 'audit' ? '' : 'lv-grid'}>
      {(showPersonnelControls || platform) && (
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

          {showPersonnelControls && !(platform && isBusiness) && (
            <div style={{ marginTop: platform ? '1.5rem' : 0 }}>
              <h2>Officer Account Provisioning &amp; Page Access</h2>
              <p>
                Create new officer accounts (via one-time private setup link) or update an existing staff member&apos;s
                role, security clearance, and allowed operational pages.
              </p>
              <label>
                Account action
                <select
                  value={createAccount ? 'create' : 'existing'}
                  onChange={(event) => {
                    setCreateAccount(event.target.value === 'create');
                    setSetupLink('');
                  }}
                >
                  <option value="create">Create new officer / staff account</option>
                  <option value="existing">Manage an existing confirmed account</option>
                </select>
              </label>
              {workspace.active ? (
                <form onSubmit={(event) => void submit(event, false)}>
                  <label>
                    Staff email
                    <input
                      name="email"
                      type="email"
                      value={selectedEmail}
                      onChange={(e) => setSelectedEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Role
                    <select name="role" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                      <option value="member">Personnel / Member (view &amp; acknowledge alerts)</option>
                      <option value="viewer">Viewer (read-only)</option>
                      <option value="investigator">Investigator (watchlist add/edit &amp; resolve alerts)</option>
                      <option value="supervisor">Supervisor (watchlist archive &amp; registry import)</option>
                      {(platform || role === 'owner') && <option value="admin">Workspace administrator (full config &amp; delete)</option>}
                      <option value="revoke">Revoke access</option>
                    </select>
                  </label>
                  <label>
                    Clearance
                    <select name="clearance" value={String(selectedClearance)} onChange={(e) => setSelectedClearance(Number(e.target.value))}>
                      <option value="0">0 · General</option>
                      <option value="1">1 · Internal</option>
                      <option value="2">2 · Restricted</option>
                      <option value="3">3 · Confidential</option>
                    </select>
                  </label>
                  <fieldset>
                    <legend>
                      Allowed sidebar pages (excludes admin pages such as Access &amp; audit and Officer management;
                      owners &amp; admins always have full access)
                    </legend>
                    <div className="lv-video-actions" style={{ marginBottom: '0.5rem' }}>
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                        onClick={() => setSelectedModules(sidebarModules.map((m) => m.id))}
                      >
                        Select all pages
                      </button>
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ padding: '3px 10px', fontSize: '0.78rem' }}
                        onClick={() => setSelectedModules([])}
                      >
                        Clear all
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
                        gap: '0.35rem 0.75rem',
                      }}
                    >
                      {sidebarModules.map((mod) => (
                        <label className="lv-verify-recipient" key={mod.id} style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            name="modules"
                            value={mod.id}
                            checked={selectedModules.includes(mod.id)}
                            onChange={(e) =>
                              setSelectedModules((prev) =>
                                e.target.checked ? [...prev, mod.id] : prev.filter((item) => item !== mod.id),
                              )
                            }
                          />
                          {mod.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {createAccount && (
                    <label className="lv-verify-recipient">
                      <input type="checkbox" name="verified" required />I verified this recipient and email address.
                    </label>
                  )}
                  <button disabled={busy}>{createAccount ? 'Create staff account' : 'Update personnel access'}</button>
                </form>
              ) : (
                <p>Reactivate the agency to update its personnel.</p>
              )}
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
          {setupLink && (
            <label>
              Private one-time password setup link
              <input type="text" value={setupLink} readOnly onFocus={(event) => event.currentTarget.select()} />
            </label>
          )}
        </section>
      )}

      {/* Paginated Personnel Roster (shown in Officer Management or Full/Business view, NOT in dedicated Audit-only mode) */}
      {(showPersonnelControls || (platform && isBusiness)) && (
        <section className="lv-card">
          <h2>{platform && isBusiness ? 'Organization isolation notice' : loading ? 'Personnel directory' : `Personnel directory (${filteredStaff.length})`}</h2>
          {platform && isBusiness ? (
            <p>
              Business staff rosters, camera feeds, and incident records remain isolated inside the business workspace and are
              not exposed to the platform feature panel.
            </p>
          ) : loading ? (
            <p>Loading personnel roster…</p>
          ) : loadError ? (
            <p role="alert">Personnel could not be loaded.</p>
          ) : (
            <>
              <label>
                Search officers by email or role
                <input
                  value={staffQuery}
                  onChange={(e) => {
                    setStaffQuery(e.target.value);
                    setStaffPage(0);
                  }}
                  placeholder="Filter staff..."
                />
              </label>
              {pagedStaff.length ? (
                pagedStaff.map((member) => (
                  <article key={member.user_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{member.email}</h3>
                        <p style={{ margin: '0.2rem 0' }}>{ROLE_DESCRIPTIONS[member.role] || member.role}</p>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                          <span className="lv-badge">Clearance {member.clearance}</span>
                          {['owner', 'admin'].includes(member.role) ? (
                            <span className="lv-badge" style={{ borderColor: '#76efd6' }}>All workspace pages</span>
                          ) : (
                            (member.allowed_modules || []).map((mod) => (
                              <span key={mod} className="lv-badge">
                                {renderModuleLabel(mod)}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="lv-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() => {
                          setCreateAccount(false);
                          setSelectedEmail(member.email);
                          setSelectedRole(member.role === 'owner' ? 'admin' : member.role || 'member');
                          setSelectedClearance(Number(member.clearance ?? 0));
                          setSelectedModules(
                            Array.isArray(member.allowed_modules) && member.allowed_modules.length > 0
                              ? member.allowed_modules
                              : ['command', 'cameras'],
                          );
                        }}
                      >
                        Edit access
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p>No personnel match this filter.</p>
              )}

              {filteredStaff.length > PERSONNEL_PAGE_SIZE && (
                <div className="lv-video-actions" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="lv-secondary"
                    disabled={safeStaffPage === 0}
                    onClick={() => setStaffPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span>
                    Page {safeStaffPage + 1} of {totalStaffPages}
                  </span>
                  <button
                    type="button"
                    className="lv-secondary"
                    disabled={safeStaffPage + 1 >= totalStaffPages}
                    onClick={() => setStaffPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Detailed Paginated Audit Log Console (shown in Access & Audit or Full view) */}
      {showAuditLogs && !(platform && isBusiness) && (
        <section className="lv-card" aria-label="Security audit logs">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ marginBottom: '0.2rem' }}>Access &amp; Security Audit Logs</h2>
              <p style={{ marginTop: 0 }}>
                Immutable workspace audit trail covering personnel role changes, biometric enrollments, watchlist updates,
                camera configuration, and alert resolutions. Officer account creation is managed under{' '}
                <strong>Officer management</strong>.
              </p>
            </div>
            <button type="button" className="lv-secondary" onClick={() => setVersion((v) => v + 1)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh logs'}
            </button>
          </div>

          <div
            className="lv-console-metrics"
            style={{ marginBlock: '0.85rem', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          >
            <article>
              <span>Total audit records</span>
              <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>{loading ? '…' : activity.length}</strong>
              <small>Recent event window</small>
            </article>
            <article style={{ borderColor: '#a855f7' }}>
              <span>Access &amp; role changes</span>
              <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                {loading ? '…' : activity.filter((a) => classifyAuditAction(a.action).category === 'membership').length}
              </strong>
              <small>Memberships &amp; clearances</small>
            </article>
            <article style={{ borderColor: '#f43f5e' }}>
              <span>Biometric subject logs</span>
              <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                {loading ? '…' : activity.filter((a) => classifyAuditAction(a.action).category === 'subject').length}
              </strong>
              <small>Enrollments &amp; migrations</small>
            </article>
            <article style={{ borderColor: '#38bdf8' }}>
              <span>Camera, rules &amp; watchlist</span>
              <strong style={{ fontSize: '1.5rem', fontWeight: 800 }}>
                {loading
                  ? '…'
                  : activity.filter((a) => {
                      const c = classifyAuditAction(a.action).category;
                      return c === 'camera' || c === 'watchlist';
                    }).length}
              </strong>
              <small>Device &amp; hotlist events</small>
            </article>
          </div>

          <div className="lv-observation-filters" style={{ marginBottom: '0.85rem' }}>
            <label>
              Search audit logs
              <input
                value={auditQuery}
                onChange={(e) => {
                  setAuditQuery(e.target.value);
                  setAuditPage(0);
                }}
                placeholder="Search action, actor email, or target..."
              />
            </label>
            <label>
              Event category
              <select
                value={auditCategory}
                onChange={(e) => {
                  setAuditCategory(e.target.value as AuditCategory);
                  setAuditPage(0);
                }}
              >
                <option value="all">All categories{loading ? '' : ` (${activity.length})`}</option>
                <option value="membership">Access &amp; role changes</option>
                <option value="subject">Biometric subjects</option>
                <option value="camera">Cameras &amp; AI rules</option>
                <option value="watchlist">Vehicle watchlist &amp; evidence</option>
                <option value="alert">Alerts &amp; cases</option>
              </select>
            </label>
          </div>

          {loading ? (
            <p>Loading audit log timeline…</p>
          ) : loadError ? (
            <p role="alert">Audit logs could not be loaded.</p>
          ) : pagedActivity.length === 0 ? (
            <p>No audit activity matches these filters.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {pagedActivity.map((event) => {
                const meta = classifyAuditAction(event.action);
                const actor = staffById.get(event.actor_id);
                const subject = event.subject_id ? staffById.get(event.subject_id) : undefined;
                return (
                  <article
                    key={event.id}
                    className="lv-card"
                    style={{
                      marginBlock: 0,
                      padding: '0.75rem 0.95rem',
                      background: '#091017',
                      borderLeft: `4px solid ${meta.color}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span className="lv-badge" style={{ borderColor: meta.color, color: meta.color, fontWeight: 800 }}>
                          {meta.badge}
                        </span>
                        <strong style={{ fontSize: '0.96rem', textTransform: 'capitalize' }}>{meta.summary}</strong>
                        <code style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{event.action}</code>
                      </div>
                      <small style={{ color: '#94a3b8', fontWeight: 600 }}>
                        #{event.id} · {new Date(event.created_at).toLocaleString()}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.4rem', fontSize: '0.84rem', color: '#cbd5e1' }}>
                      <span>
                        <strong>Actor:</strong> {actor?.email || event.actor_id}
                        {actor?.role && <span className="lv-badge" style={{ marginLeft: '0.35rem' }}>{actor.role}</span>}
                      </span>
                      {event.subject_id && (
                        <span>
                          <strong>Target:</strong> {subject?.email || event.subject_id}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {filteredActivity.length > AUDIT_PAGE_SIZE && (
            <div className="lv-video-actions" style={{ marginTop: '0.85rem' }}>
              <button
                type="button"
                className="lv-secondary"
                disabled={safeAuditPage === 0}
                onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span>
                Page {safeAuditPage + 1} of {totalAuditPages} ({filteredActivity.length} total logs)
              </span>
              <button
                type="button"
                className="lv-secondary"
                disabled={safeAuditPage + 1 >= totalAuditPages}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
