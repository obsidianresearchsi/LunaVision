export type DbModuleScope = 'monitor' | 'analytics' | 'records' | 'evidence' | 'vehicles';

export interface SidebarModuleOption {
  id: string;
  label: string;
  dbScope: DbModuleScope;
}

// Excludes administrative pages (access, officers, configuration, integrations)
export const AGENCY_SIDEBAR_MODULES: SidebarModuleOption[] = [
  { id: 'command', label: 'Command centre', dbScope: 'monitor' },
  { id: 'intelligence', label: 'Security intelligence', dbScope: 'analytics' },
  { id: 'cameras', label: 'Live cameras', dbScope: 'monitor' },
  { id: 'camera_config', label: 'Camera intelligence', dbScope: 'monitor' },
  { id: 'playback', label: 'Playback', dbScope: 'analytics' },
  { id: 'alerts', label: 'Alerts', dbScope: 'monitor' },
  { id: 'records', label: 'Incidents', dbScope: 'records' },
  { id: 'evidence', label: 'Evidence', dbScope: 'evidence' },
  { id: 'vehicles', label: 'Vehicle watchlist', dbScope: 'vehicles' },
  { id: 'vehicle_registry', label: 'Vehicle registry', dbScope: 'vehicles' },
  { id: 'fleet', label: 'Device fleet', dbScope: 'monitor' },
  { id: 'rules', label: 'AI rules', dbScope: 'analytics' },
  { id: 'overview', label: 'Analytics', dbScope: 'analytics' },
  { id: 'gallery', label: 'Face search', dbScope: 'records' },
  { id: 'intel', label: 'Intel map', dbScope: 'monitor' },
  { id: 'enrollment', label: 'Enroll subject', dbScope: 'records' },
  { id: 'search_history', label: 'Search history', dbScope: 'records' },
  { id: 'watchlist', label: 'Watchlist', dbScope: 'vehicles' },
  { id: 'history', label: 'Detection history', dbScope: 'analytics' },
  { id: 'faces', label: 'Face comparison', dbScope: 'records' },
];

export const BUSINESS_SIDEBAR_MODULES: SidebarModuleOption[] = [
  { id: 'overview', label: 'Overview', dbScope: 'monitor' },
  { id: 'intelligence', label: 'Business intelligence', dbScope: 'analytics' },
  { id: 'cameras', label: 'Cameras', dbScope: 'monitor' },
  { id: 'camera_config', label: 'Camera intelligence', dbScope: 'monitor' },
  { id: 'playback', label: 'Playback', dbScope: 'analytics' },
  { id: 'alerts', label: 'Alerts', dbScope: 'monitor' },
  { id: 'records', label: 'Sites & incidents', dbScope: 'records' },
  { id: 'history', label: 'Detection history', dbScope: 'analytics' },
];

const PANEL_TO_DB_SCOPE: Record<string, DbModuleScope | 'access'> = {
  command: 'monitor',
  cameras: 'monitor',
  fleet: 'monitor',
  intel: 'monitor',
  alerts: 'monitor',
  camera_config: 'monitor',
  playback: 'analytics',
  history: 'analytics',
  intelligence: 'analytics',
  rules: 'analytics',
  overview: 'analytics',
  records: 'records',
  evidence: 'evidence',
  vehicles: 'vehicles',
  watchlist: 'vehicles',
  vehicle_registry: 'vehicles',
  faces: 'records',
  gallery: 'records',
  enrollment: 'records',
  search_history: 'records',
  access: 'access',
  officers: 'access',
};

export function toDbModuleScopes(selectedIds: string[], isBusiness: boolean): DbModuleScope[] {
  const primary = isBusiness ? BUSINESS_SIDEBAR_MODULES : AGENCY_SIDEBAR_MODULES;
  const fallback = isBusiness ? AGENCY_SIDEBAR_MODULES : BUSINESS_SIDEBAR_MODULES;
  const byId = new Map([...fallback, ...primary].map((m) => [m.id, m.dbScope]));
  const scopes = new Set<DbModuleScope>();
  for (const id of selectedIds) {
    const scope = byId.get(id) ?? (['monitor', 'analytics', 'records', 'evidence', 'vehicles'].includes(id) ? (id as DbModuleScope) : undefined);
    if (scope) scopes.add(scope);
  }
  return scopes.size > 0 ? Array.from(scopes) : ['monitor'];
}

export function isPanelPermitted(panelId: string, allowedModules: string[] | null | undefined, canManage: boolean): boolean {
  if (canManage) return true;
  if (!allowedModules) return true;
  const coarseScope = PANEL_TO_DB_SCOPE[panelId];
  if (!coarseScope) return true;
  if (coarseScope === 'access') return false;
  return allowedModules.includes(panelId) || allowedModules.includes(coarseScope);
}

