import React, { useState } from 'react';
import {
  Activity, Bell, CarFront, ChevronLeft, ChevronRight, ClipboardList, Database, FileText,
  Globe, Grid2X2, History, LogOut, Map, Menu, PlayCircle, Save, Search, Settings, Shield,
  SlidersHorizontal, UserPlus, Users, Video,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { supabaseDb } from '../services/supabaseDb';
import { NotificationBell } from './NotificationBell';

const investigationItems = [
  { id: 'search', label: 'Face search', icon: Search },
  { id: 'global_map', label: 'Intel map', icon: Globe },
  { id: 'enrollment', label: 'Enroll subject', icon: UserPlus },
  { id: 'history', label: 'Search history', icon: History },
  { id: 'watchlist', label: 'Watchlist', icon: Users },
  { id: 'detection_records', label: 'Detection history', icon: Activity },
  { id: 'users', label: 'Officer management', icon: Users, admin: true },
  { id: 'crawler', label: 'Web crawler', icon: Globe, admin: true },
  { id: 'crawled_faces', label: 'Crawled faces', icon: Database, admin: true },
  { id: 'settings', label: 'Configuration', icon: Settings, admin: true },
];

export function canOpenInvestigationPage(page: string, role: UserRole) {
  return investigationItems.some(item => item.id === page && (!item.admin || role === UserRole.CHIEF_COMMANDER));
}

const groups = [
  { label: 'Command', items: [
    { id: 'dashboard', label: 'Command centre', icon: Map },
  ] },
  { label: 'Monitor', items: [
    { id: 'surveillance', label: 'Live cameras', icon: Video },
    { id: 'playback', label: 'Playback', icon: PlayCircle },
    { id: 'detection_history', label: 'Alerts', icon: Bell },
  ] },
  { label: 'Investigate', items: [
    { id: 'cases', label: 'Incidents', icon: ClipboardList },
    { id: 'evidence', label: 'Evidence', icon: FileText },
    { id: 'vehicles', label: 'Vehicle intelligence', icon: CarFront },
  ] },
  { label: 'Operate', items: [
    { id: 'camera_management', label: 'Device fleet', icon: Grid2X2, admin: true },
    { id: 'rules', label: 'AI rules', icon: SlidersHorizontal },
    { id: 'analytics', label: 'Analytics', icon: Activity, admin: true },
  ] },
  { label: 'Administer', items: [
    { id: 'access', label: 'Access & audit', icon: FileText, admin: true },
    { id: 'integrations', label: 'Integrations', icon: Shield, admin: true },
  ] },
  { label: 'EagleEye investigation', items: investigationItems },
];

export type WorkspaceNavigationGroup = {
  label: string;
  items: { id: string; label: string; icon: typeof Map }[];
};

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  onLogout: () => void;
  currentPage: string;
  onNavigate: (page: string) => void;
  onNavigateToCase?: (caseId: string) => void;
  rightPanel?: React.ReactNode;
  preview?: boolean;
  onOpenInvestigation?: (page: string) => void;
  scopedWorkspace?: { name: string; groups: WorkspaceNavigationGroup[]; controls?: React.ReactNode };
}

const mobileItems = [
  { id: 'dashboard', label: 'Home', icon: Grid2X2 },
  { id: 'surveillance', label: 'Cameras', icon: Video },
  { id: 'detection_history', label: 'Alerts', icon: Bell },
  { id: 'cases', label: 'Incidents', icon: ClipboardList },
];

const time = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const Layout: React.FC<LayoutProps> = ({
  children, user, onLogout, currentPage, onNavigate, onNavigateToCase, rightPanel, preview = false, onOpenInvestigation, scopedWorkspace,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const commander = user.role === UserRole.CHIEF_COMMANDER;
  const visibleGroups = scopedWorkspace?.groups ?? groups
    .map(group => ({ ...group, items: group.items.filter(item => !('admin' in item && item.admin) || commander) }))
    .filter(group => group.items.length);
  const items = visibleGroups.flatMap(group => group.items)
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
  const active = currentPage === 'case_detail' ? 'cases' : currentPage === 'results' ? 'search' : currentPage;
  const heading = items.find(item => item.id === active)?.label ?? 'Workspace';
  const matches = query.trim() ? items.filter(item => (item.id === 'search' ? item.label + ' investigation' : item.label).toLowerCase().includes(query.trim().toLowerCase())) : [];
  const workspace = scopedWorkspace?.name ?? (preview ? 'Meridian Port' : 'Operations workspace');
  const fieldItems = scopedWorkspace ? items.filter(item => ['command', 'cameras', 'records', 'history'].includes(item.id)) : mobileItems;

  function navigate(page: string) {
    setMobileOpen(false);
    setQuery('');
    if (preview && investigationItems.some(item => item.id === page)) {
      onOpenInvestigation?.(page);
    } else {
      onNavigate(page);
    }
  }

  async function exportCase() {
    try {
      const [suspects, auditLogs] = await Promise.all([supabaseDb.getSuspects(), supabaseDb.getAuditLogs()]);
      const data = { exportedAt: new Date().toISOString(), officer: user.username, suspects, auditLogs };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'CASE_FILE_' + Date.now() + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      alert('Case File Exported to Local Drive.');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export case file. Please try again.');
    }
  }

  return (
    <div className="eagle-app lunar-app" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
      <header className="lunar-topbar">
        <button className="lunar-icon lunar-mobile-menu" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}>
          <Menu size={19} />
        </button>
        <div className="lunar-breadcrumb"><span>{workspace}</span><span aria-hidden="true">/</span><strong>{heading}</strong></div>
        <div className="lunar-header-actions">
          <form className="lunar-search" role="search" onSubmit={event => { event.preventDefault(); if (matches[0]) navigate(matches[0].id); }}>
            <Search size={14} />
            <input aria-label="Search workspace pages" placeholder="Search workspace" value={query} onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
            {query.trim() && <div className="lunar-search-results">
              {matches.length ? matches.map(item => <button key={item.id} type="button" onClick={() => navigate(item.id)}>{item.label}</button>) : <span>No matching pages</span>}
            </div>}
          </form>
          {!preview && !scopedWorkspace && <NotificationBell userId={user.id} onNavigateToCase={onNavigateToCase} onNavigateToSurveillance={() => navigate('surveillance')} />}
          <span className="lunar-session"><i />{preview ? 'Design preview' : 'Session active'}</span>
          <time className="lunar-clock">{time.format(new Date())} WAT</time>
        </div>
      </header>

      <aside className="lunar-sidebar" aria-label="Workspace navigation">
        <div className="lunar-brand">
          <picture>
            <img src={collapsed ? '/logo/favicon.png' : '/logo/lunar-vision-white.png'} alt="Lunar Vision" />
          </picture>
          <span>By Lunar Robotics</span>
        </div>
        <div className="lunar-workspace-id">
          <span className="lunar-avatar">{preview ? 'M' : 'LV'}</span>
          <div><strong>{workspace}</strong><small>{preview ? 'DEMO WORKSPACE' : 'LUNAR VISION'}</small></div>
        </div>
        {scopedWorkspace?.controls && <div className="lunar-scoped-controls">{scopedWorkspace.controls}</div>}
        <nav className="lunar-nav">
          {visibleGroups.map(group => <section key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => navigate(id)} title={label} aria-label={label}
                aria-current={active === id ? 'page' : undefined}>
                <Icon size={16} strokeWidth={1.65} /><span>{label}</span>
              </button>
            ))}
          </section>)}
        </nav>
        <div className="lunar-profile">
          <span className="lunar-avatar">{user.username.trim().slice(0, 2).toUpperCase()}</span>
          <div><strong>{user.username}</strong><small>{preview ? 'Shift supervisor' : commander ? 'Commander' : 'Officer'}</small></div>
          <button className="lunar-icon" onClick={onLogout} aria-label={preview ? 'Exit preview' : 'End Session'} title={preview ? 'Exit preview' : 'End Session'}><LogOut size={16} /></button>
        </div>
        <div className="lunar-sidebar-controls">
          {!preview && !scopedWorkspace && <button className="lunar-icon" onClick={exportCase} title="Export Case" aria-label="Export Case"><Save size={15} /></button>}
          <button className="lunar-icon lunar-collapse" title="Toggle Panel" aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>
      {mobileOpen && <button className="lunar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="lunar-main" id="workspace">
        <div className="command-content lunar-content" data-investigation={canOpenInvestigationPage(active, user.role)}>{children}</div>
        {rightPanel && <aside className="lunar-inspector" aria-label="Inspector">{rightPanel}</aside>}
      </main>
      <nav className="lunar-mobile-nav" aria-label="Field navigation">
        {fieldItems.map(({ id, label, icon: Icon }) =>
          <button key={id} aria-current={active === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19} />{label}</button>)}
      </nav>
    </div>
  );
};

