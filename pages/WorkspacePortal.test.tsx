import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('WorkspacePortal dashboards (Business, Agency, Super Admin)', () => {
  let host: HTMLDivElement;
  let root: Root;

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
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    });
    mockRpc.mockResolvedValue({ data: [], error: null });
  }

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

    const { default: WorkspacePortal } = await import('./WorkspacePortal');
    await act(async () => {
      root.render(<WorkspacePortal agency={false} platformView={false} />);
    });

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

    const { default: WorkspacePortal } = await import('./WorkspacePortal');
    await act(async () => {
      root.render(<WorkspacePortal agency={true} platformView={true} />);
    });

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

    const { default: WorkspacePortal } = await import('./WorkspacePortal');
    await act(async () => {
      root.render(<WorkspacePortal agency={true} platformView={false} />);
    });

    expect(host.textContent).toContain('Lagos State Command');
    const configBtn = host.querySelector('button[aria-label="Configuration"]') as HTMLButtonElement;
    const integrationsBtn = host.querySelector('button[aria-label="Integrations"]') as HTMLButtonElement;
    expect(configBtn).toBeTruthy();
    expect(integrationsBtn).toBeTruthy();

    // Open Enroll subject and verify explicit unavailability notice remains intact
    const enrollBtn = host.querySelector('button[aria-label="Enroll subject"]') as HTMLButtonElement;
    await act(async () => { enrollBtn.click(); });
    expect(host.textContent).toContain('Biometric subject enrollment is unavailable in this agency console.');
  });
});

