import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';
import { UserRole } from '../types';

vi.mock('./NotificationBell', () => ({
  NotificationBell: ({ onNavigateToCase, onNavigateToSurveillance }: any) => (
    <div>
      <button onClick={() => onNavigateToCase?.('case-123')}>Case notification</button>
      <button onClick={onNavigateToSurveillance}>Surveillance notification</button>
    </div>
  )
}));
vi.mock('../services/supabaseDb', () => ({
  supabaseDb: { getSuspects: vi.fn().mockResolvedValue([]), getAuditLogs: vi.fn().mockResolvedValue([]) }
}));

describe('Layout workflow preservation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onNavigate = vi.fn();
  const onLogout = vi.fn();
  const onNavigateToCase = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(role = UserRole.CHIEF_COMMANDER, currentPage = 'search') {
    await act(async () => root.render(
      <Layout user={{ id: 'officer-1', username: 'Test Officer', role, createdAt: '2026-01-01' }}
        currentPage={currentPage} onNavigate={onNavigate} onLogout={onLogout}
        onNavigateToCase={onNavigateToCase} rightPanel={<div>Inspector content</div>}>
        <div>Workspace content</div>
      </Layout>
    ));
  }
  function button(label: string) {
    const match = Array.from(container.querySelectorAll('button')).find(el =>
      el.getAttribute('aria-label') === label || el.textContent?.trim() === label || el.title === label);
    expect(match, `Button ${label} exists`).toBeTruthy();
    return match!;
  }
  async function click(label: string) { await act(async () => button(label).click()); }

  it('preserves every navigation destination for commanders', async () => {
    await render();
    const destinations = {
      'Face search': 'search', 'Intel map': 'global_map', 'Enroll subject': 'enrollment',
      'Search history': 'history', Incidents: 'cases', 'Live cameras': 'surveillance',
      Watchlist: 'watchlist', Alerts: 'detection_history', 'Command centre': 'dashboard',
      'Detection history': 'detection_records', 'Officer management': 'users', 'Web crawler': 'crawler', 'Crawled faces': 'crawled_faces',
      'Device fleet': 'camera_management', Configuration: 'settings'
    };
    for (const [label, destination] of Object.entries(destinations)) {
      await click(label);
      expect(onNavigate).toHaveBeenLastCalledWith(destination);
    }
  });

  it('preserves officer restrictions and active navigation', async () => {
    await render(UserRole.OFFICER, 'results');
    expect(container.textContent).not.toContain('Administer');
    expect(container.querySelector('[aria-label="Device fleet"]')).toBeNull();
    expect(container.querySelector('[aria-label="Configuration"]')).toBeNull();
    expect(button('Face search').getAttribute('aria-current')).toBe('page');
    await click('Incidents');
    expect(onNavigate).toHaveBeenLastCalledWith('cases');
  });

  it('preserves sidebar controls, workspace, inspector, and logout', async () => {
    await render();
    await click('Toggle Panel');
    expect(button('Expand navigation').getAttribute('aria-expanded')).toBe('false');
    await click('Expand navigation');
    expect(button('Collapse navigation').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Workspace content');
    expect(container.textContent).toContain('Inspector content');
    expect(container.textContent).not.toContain('v2.4.1');
    await click('End Session');
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('preserves notification navigation callbacks', async () => {
    await render();
    await click('Case notification');
    expect(onNavigateToCase).toHaveBeenCalledWith('case-123');
    await click('Surveillance notification');
    expect(onNavigate).toHaveBeenLastCalledWith('surveillance');
  });

  it('preserves case export and releases its temporary URL', async () => {
    const { supabaseDb } = await import('../services/supabaseDb');
    const createObjectURL = vi.fn(() => 'blob:case-export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class {}, { createObjectURL, revokeObjectURL }));
    vi.stubGlobal('alert', vi.fn());
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await render();
    await click('Export Case');
    expect(supabaseDb.getSuspects).toHaveBeenCalledOnce();
    expect(supabaseDb.getAuditLogs).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(download).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:case-export');
    expect(alert).toHaveBeenCalledWith('Case File Exported to Local Drive.');
  });
});
