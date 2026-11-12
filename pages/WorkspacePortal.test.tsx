import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockRpc, mockAuth } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockAuth: {
    onAuthStateChange: vi.fn(),
    getUser: vi.fn(),
    getSession: vi.fn(),
    signInWithPassword: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('../services/supabase', () => ({
  workspaceEnabled: true,
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: mockAuth,
  },
}));

vi.mock('../components/AgencyCommandMap', () => ({
  default: () => <div>Mock AgencyCommandMap</div>,
}));

vi.mock('../components/VideoAnalysis', () => ({
  default: ({ workspaceId }: { workspaceId?: string }) => <div>Mock VideoAnalysis {workspaceId}</div>,
}));

vi.mock('../components/RecordLocation', () => ({
  LocationPicker: () => <div>Location picker</div>,
  RecordLocationEditor: () => null,
}));

describe('WorkspacePortal dashboards (Business, Agency, Super Admin)', () => {
  let host: HTMLDivElement;
  let root: Root;
  let WorkspacePortalComp: React.ComponentType<{ agency: boolean; platformView: boolean }>;

  beforeAll(async () => {
    ({ default: WorkspacePortalComp } = await import('./WorkspacePortal'));
  }, 20000);

  async function renderAndFlush(element: React.ReactElement) {
    await act(async () => {
      root.render(element);
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_WORKSPACE_PORTAL_ENABLED', 'true');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    mockAuth.onAuthStateChange.mockImplementation((callback: any) => {
      callback('SIGNED_IN', { user: { id: 'user-1', email: 'operator@example.com' } });
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllEnvs();
  });

  function setupMockDb({
    workspaces = [],
    memberships = [],
    platformAdmins = [],
    records = [],
    recordActivity = [],
  }: {
    workspaces?: any[];
    memberships?: any[];
    platformAdmins?: any[];
    records?: any[];
    recordActivity?: any[];
  }) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'lv_workspaces') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: workspaces, error: null }),
              single: () => Promise.resolve({ data: workspaces[0] ?? { id: 'ws-1', active: true }, error: null }),
            }),
          }),
        };
      }
      if (table === 'lv_memberships') {
        return {
          select: () => Promise.resolve({ data: memberships, error: null }),
        };
      }
      if (table === 'lv_platform_admins') {
        return {
          select: () => Promise.resolve({ data: platformAdmins, error: null }),
        };
      }
      if (table === 'lv_records') {
        return {
          select: (_cols?: string, opts?: any) => {
            if (opts?.head) {
              return {
                eq: () => ({
                  eq: () => ({
                    neq: () => Promise.resolve({ count: records.length, error: null }),
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: records, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'lv_record_activity') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: recordActivity, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'lv_cameras') {
        return {
          select: (_cols?: string, opts?: any) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 2, error: null }) };
            }
            return {
              eq: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          },
        };
      }
      if (table === 'lv_video_observations') {
        return {
          select: (_cols?: string, opts?: any) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 5, error: null }) };
            }
            return {
              eq: () => ({
                order: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                    range: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'lv_workspace_activity') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        is: () => chain,
        not: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        range: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any, reject?: any) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject),
      };
      return chain;
    });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'lv_workspace_feature_map') {
        return Promise.resolve({
          data: {
            people_analytics: true,
            vehicle_analytics: true,
            advanced_detection: true,
            anpr: true,
            vehicle_registry: true,
            security_intelligence: true,
            business_intelligence: true,
            biometric_enrollment: true,
            face_search: true,
          },
          error: null,
        });
      }
      if (fn === 'lv_alert_summary') {
        return Promise.resolve({ data: { open: 2, high: 1 }, error: null });
      }
      if (fn === 'lv_platform_organizations') {
        return Promise.resolve({
          data: [
            ...workspaces.map((w) => ({ id: w.id, name: w.name, kind: w.kind, active: w.active, features: {} })),
            { id: 'biz-global-1', name: 'Global Retail Mall', kind: 'business', active: true, features: {} },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
  }

  it('opens camera registration directly from the business camera-settings empty state', async () => {
    setupMockDb({
      workspaces: [{id:'business-camera',name:'Business cameras',kind:'business',active:true,entitlement:'',organization_details:''}],
      memberships: [{workspace_id:'business-camera',role:'owner'}],
    });
    await renderAndFlush(<WorkspacePortalComp agency={false} platformView={false}/>);
    const settings=Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find(button=>button.textContent==='Camera intelligence')!;
    await act(async()=>settings.click());
    expect(host.textContent).toContain('No connected cameras yet');
    const add=Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent==='Add camera')!;
    await act(async()=>add.click());
    expect(host.querySelector('form[aria-label="Register a camera"]')).not.toBeNull();
    expect(host.querySelector('[name=name]')).not.toBeNull();
  });

  it('renders Business Dashboard with Playback, Change password, record filtering, and status history', async () => {
    setupMockDb({
      workspaces: [{ id: 'biz-1', name: 'Meridian Logistics', kind: 'business', active: true, entitlement: 'Enterprise', organization_details: 'Apapa port terminal' }],
      memberships: [{ workspace_id: 'biz-1', role: 'owner' }],
      records: [
        { id: 'rec-1', title: 'North Gate Perimeter', details: 'Main truck gate', category: 'site', status: 'open', created_at: '2026-11-10T10:00:00Z' },
        { id: 'rec-2', title: 'Forklift collision', details: 'Berth 2 incident', category: 'incident', status: 'in_review', created_at: '2026-11-11T10:00:00Z' },
      ],
      recordActivity: [
        { id: 1, previous_status: 'open', next_status: 'in_review', created_at: '2026-11-11T11:00:00Z' },
      ],
    });

    await renderAndFlush(<WorkspacePortalComp agency={false} platformView={false} />);

    expect(host.textContent).toContain('Meridian Logistics');
    const navButtons = Array.from(host.querySelectorAll('nav button')).map(b => b.textContent?.trim());
    expect(navButtons).toEqual(expect.arrayContaining(['Overview', 'Cameras', 'Playback', 'Sites & incidents', 'Detection history', 'Organization staff', 'Change password']));

    // Navigate from Saved observations metric card to Detection history
    const savedObservationsMetric = Array.from(host.querySelectorAll<HTMLButtonElement>('.lv-console-metrics button')).find(b => b.textContent?.includes('Saved observations'));
    expect(savedObservationsMetric).toBeTruthy();
    await act(async () => { savedObservationsMetric!.click(); });
    expect(host.querySelector('h2')?.textContent).toBe('Detection history');

    // Open Playback tab in Business workspace
    const playbackBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find(b => b.textContent?.trim() === 'Playback')!;
    await act(async () => { playbackBtn.click(); });
    expect(host.textContent).toContain('Mock VideoAnalysis biz-1');

    // Open Sites & incidents and test filters + Status history
    const recordsBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find(b => b.textContent?.trim() === 'Sites & incidents')!;
    await act(async () => { recordsBtn.click(); });
    expect(host.textContent).toContain('North Gate Perimeter');
    expect(host.textContent).toContain('Forklift collision');

    const statusHistoryDetails = host.querySelector('details')!;
    await act(async () => {
      statusHistoryDetails.open = true;
      statusHistoryDetails.dispatchEvent(new Event('toggle'));
    });
    expect(host.textContent).toContain('Open → In review');
  });

  it('renders Super Admin console with Agency directory search, filter, and quick actions', async () => {
    setupMockDb({
      workspaces: [
        { id: 'ag-1', name: 'Lagos State Command', kind: 'agency', active: true, entitlement: 'Tier 1', organization_details: '' },
        { id: 'ag-2', name: 'Abuja Central Unit', kind: 'agency', active: false, entitlement: 'Suspended review', organization_details: '' },
      ],
      memberships: [],
      platformAdmins: [{ user_id: 'user-1' }],
    });

    await renderAndFlush(<WorkspacePortalComp agency={true} platformView={true} />);

    expect(host.textContent).toContain('Agency directory');
    expect(host.textContent).toContain('Lagos State Command');
    expect(host.textContent).toContain('Abuja Central Unit');

    // Click Issue account on Lagos State Command
    const issueButtons = Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Issue account');
    expect(issueButtons.length).toBeGreaterThan(0);
    await act(async () => { issueButtons[0].click(); });
    expect(host.textContent).toContain('Issue an account for Lagos State Command');
  });

  it('renders Agency Security Dashboard with distinct Configuration item, Incident status history, and explicit pending notices', async () => {
    setupMockDb({
      workspaces: [{ id: 'ag-1', name: 'Lagos State Command', kind: 'agency', active: true, entitlement: 'Tier 1', organization_details: '' }],
      memberships: [{ workspace_id: 'ag-1', role: 'admin' }],
      records: [
        { id: 'inv-1', title: 'Apapa Corridor Case', details: 'Vehicle sighting inquiry', category: 'investigation', status: 'open', created_at: '2026-11-11T09:00:00Z' },
      ],
    });

    await renderAndFlush(<WorkspacePortalComp agency={true} platformView={false} />);

    expect(host.textContent).toContain('Lagos State Command');
    const configBtn = host.querySelector('button[aria-label="Configuration"]') as HTMLButtonElement;
    const integrationsBtn = host.querySelector('button[aria-label="Integrations"]') as HTMLButtonElement;
    expect(configBtn).toBeTruthy();
    expect(integrationsBtn).toBeTruthy();

    // Open Enroll subject and verify live police/convict biometric booking form renders immediately
    const enrollBtn = host.querySelector('button[aria-label="Enroll subject"]') as HTMLButtonElement;
    expect(enrollBtn).toBeTruthy();
    await act(async () => { enrollBtn.click(); });
    expect(host.textContent).toContain('Agency Subject Enrollment, Bulk Migration & Biometric Dossiers');
    expect(host.textContent).toContain('Enroll New Biometric Subject / Convict Dossier');
    expect(host.textContent).toContain('Enroll Convict / Subject & Register on Face++');

    // Open Search history and verify live search audit history renders
    const histBtn = host.querySelector('button[aria-label="Search history"]') as HTMLButtonElement;
    expect(histBtn).toBeTruthy();
    await act(async () => { histBtn.click(); });
    expect(host.textContent).toContain('Forensic Face Search Audit History');

    // Verify Web crawler remains explicitly unavailable (no non-consensual public web scraping)
    const crawlerBtn = host.querySelector('button[aria-label="Web crawler"]') as HTMLButtonElement;
    expect(crawlerBtn).toBeTruthy();
    await act(async () => { crawlerBtn.click(); });
    expect(host.textContent).toContain('Face collection and biometric indexing from websites are unavailable in this agency console.');

    // Verify Security Intelligence, Vehicle Registry, and Camera Intelligence panels work
    const intelBtn = host.querySelector('button[aria-label="Security intelligence"]') as HTMLButtonElement;
    expect(intelBtn).toBeTruthy();
    await act(async () => { intelBtn.click(); });
    expect(host.textContent).toContain('Security Agency Intelligence Dashboard');

    const registryBtn = host.querySelector('button[aria-label="Vehicle registry"]') as HTMLButtonElement;
    expect(registryBtn).toBeTruthy();
    await act(async () => { registryBtn.click(); });
    expect(host.textContent).toContain('Pre-Populated Vehicle Registration Database');

    const camCfgBtn = host.querySelector('button[aria-label="Camera intelligence"]') as HTMLButtonElement;
    expect(camCfgBtn).toBeTruthy();
  });

  it('isolates Business Intelligence from security-agency ANPR & watchlist features and renders commercial analytics', async () => {
    setupMockDb({
      workspaces: [{ id: 'biz-2', name: 'Victoria Island Mall', kind: 'business', active: true, entitlement: 'Commercial', organization_details: 'Retail complex' }],
      memberships: [{ workspace_id: 'biz-2', role: 'owner' }],
    });

    await renderAndFlush(<WorkspacePortalComp agency={false} platformView={false} />);

    const navLabels = Array.from(host.querySelectorAll('nav button')).map((b) => b.textContent?.trim());
    expect(navLabels).toContain('Business intelligence');
    expect(navLabels).toContain('Camera intelligence');
    expect(navLabels.some((l) => l?.startsWith('Alerts'))).toBe(true);
    expect(navLabels).not.toContain('Vehicle watchlist');
    expect(navLabels).not.toContain('Vehicle registry');
    expect(navLabels).not.toContain('Security intelligence');
    expect(navLabels).not.toContain('Enroll subject');
    expect(navLabels).not.toContain('Face comparison');
    expect(navLabels).not.toContain('Gallery search');
    expect(navLabels).not.toContain('Search history');

    const bizIntelBtn = Array.from(host.querySelectorAll<HTMLButtonElement>('nav button')).find(
      (b) => b.textContent?.trim() === 'Business intelligence',
    )!;
    await act(async () => {
      bizIntelBtn.click();
    });
    expect(host.textContent).toContain('Business Intelligence & Operations Analytics');
    expect(host.textContent).toContain('Customer footfall');
    expect(host.textContent).toContain('Peak Visiting Hours');
    expect(host.textContent).not.toContain('ANPR plate reads');
  });

  it('finishes a confirmed business signup once and reuses an existing membership', async () => {
    mockAuth.onAuthStateChange.mockImplementation((callback: any) => {
      callback('SIGNED_IN', {user: {id: 'user-1', user_metadata: {business_signup_version: 1, organization_name: 'New customer'}}});
      return {data: {subscription: {unsubscribe: vi.fn()}}};
    });
    setupMockDb({});
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'lv_create_business') {
        setupMockDb({workspaces: [{id: 'created-biz', name: 'New customer', kind: 'business', active: true, entitlement: '', organization_details: ''}], memberships: [{workspace_id: 'created-biz', role: 'owner'}]});
        return {data: 'created-biz', error: null};
      }
      return {data: [], error: null};
    });
    const {default: WorkspacePortal} = await import('./WorkspacePortal');
    await act(async () => {root.render(<WorkspacePortal agency={false} platformView={false}/>);});
    expect(mockRpc.mock.calls.filter(([name]) => name === 'lv_create_business')).toHaveLength(1);
    expect(host.textContent).toContain('New customer');
    expect(host.textContent).not.toContain('Set up your organization');
    await act(async () => root.render(<div/>));
    await act(async () => root.render(<WorkspacePortal agency={false} platformView={false}/>));
    expect(mockRpc.mock.calls.filter(([name]) => name === 'lv_create_business')).toHaveLength(1);
  });

  it('does not offer organization setup when workspace loading fails, and restores the saved workspace on retry', async () => {
    setupMockDb({});
    const normal=mockFrom.getMockImplementation()!;
    mockFrom.mockImplementation((table:string)=> table==='lv_workspaces' ? {
      select:()=>({eq:()=>({order:()=>Promise.resolve({data:null,error:{message:'Network unavailable'}})})}),
    } : normal(table));
    await renderAndFlush(<WorkspacePortalComp agency={false} platformView={false} />);
    expect(host.textContent).toContain('Workspace access could not be loaded');
    expect(host.textContent).not.toContain('Set up your organization');
    setupMockDb({workspaces:[{id:'saved-biz',name:'Existing organization',kind:'business',active:true,entitlement:'',organization_details:''}],memberships:[{workspace_id:'saved-biz',role:'owner'}]});
    const retry=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Retry workspace access')!;
    await act(async()=>{retry.click();});
    expect(host.textContent).toContain('Existing organization');
    expect(host.textContent).not.toContain('Set up your organization');
  });

  it('hides modules that are not assigned to a staff account',async()=>{
    setupMockDb({workspaces:[{id:'limited-biz',name:'Limited organization',kind:'business',active:true,entitlement:'',organization_details:''}],memberships:[{workspace_id:'limited-biz',role:'viewer',clearance:0,allowed_modules:['monitor']}]});
    await renderAndFlush(<WorkspacePortalComp agency={false} platformView={false}/>);
    const labels=Array.from(host.querySelectorAll('nav button')).map(button=>button.textContent);
    expect(labels).toContain('Cameras');expect(labels).not.toContain('Playback');expect(labels).not.toContain('Sites & incidents');
  });
});

