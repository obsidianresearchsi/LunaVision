import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { toDbModuleScopes } from '../services/workspaceModules';

const VALID_MODULE_IDS = new Set([
  'monitor',
  'analytics',
  'records',
  'evidence',
  'vehicles',
  'access',
  'command',
  'intelligence',
  'cameras',
  'camera_config',
  'playback',
  'alerts',
  'vehicle_registry',
  'fleet',
  'rules',
  'overview',
  'gallery',
  'intel',
  'enrollment',
  'search_history',
  'watchlist',
  'history',
  'faces',
]);

function json(status: number, data: object) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

export async function POST(request: Request) {
  return issueAgencyAccount(request, process.env);
}

export async function issueAgencyAccount(request: Request, env: Record<string, string | undefined>, local = false) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json(401, { error: 'Sign in to issue an agency account.' });

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.STAFF_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const origin = env.AGENCY_SETUP_ORIGIN;
  if (!url || !key || !serviceKey || !origin) return json(503, { error: 'Account issuance is not configured.' });

  try {
    const callback = new URL('/agency', origin);
    const localCallback = local && callback.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(callback.hostname);
    if ((!localCallback && callback.protocol !== 'https:') || callback.username || callback.password) {
      return json(503, { error: 'Account setup requires a trusted HTTPS origin.' });
    }
    const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const caller = createClient(url, key, { global: { headers: { Authorization: 'Bearer ' + token } }, auth });
    const { data: { user }, error: authError } = await caller.auth.getUser(token);
    if (authError || !user) return json(401, { error: 'Sign in again to continue.' });
    const platform = await caller.from('lv_platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (platform.error) return json(503, { error: 'Platform access could not be verified.' });

    const input = await request.json().catch(() => null);
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const target = typeof input?.workspaceId === 'string' ? input.workspaceId : '';
    const role = input?.role;
    const clearance = input?.clearance ?? 0;
    const modules = input?.modules ?? ['monitor'];
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        !['member','viewer','investigator','supervisor','admin'].includes(role) || input?.verified !== true ||
        !Number.isInteger(clearance) || clearance < 0 || clearance > 3 || !Array.isArray(modules) || modules.length > 25 ||
        modules.some((value: unknown) => typeof value !== 'string' || !VALID_MODULE_IDS.has(value))) {
      return json(400, { error: 'Choose valid staff access and confirm that the recipient and email were verified.' });
    }
    const agency = await caller.from('lv_workspaces').select('id,kind').eq('id', target).eq('active', true).maybeSingle();
    if (agency.error) return json(503, { error: 'Agency status could not be verified.' });
    if (!agency.data) return json(403, { error: 'Select an active workspace.' });
    const member = await caller.from('lv_memberships').select('role,clearance').eq('workspace_id',target).eq('user_id',user.id).maybeSingle();
    const isPlatform = agency.data.kind === 'agency' && Boolean(platform.data);
    if (member.error || (!isPlatform && !['owner','admin'].includes(member.data?.role))) return json(403,{error:'Workspace administrator access is required.'});
    if ((!isPlatform && clearance > member.data.clearance) || (role === 'admin' && !isPlatform && member.data.role !== 'owner'))
      return json(403,{error:'You cannot grant a role or clearance above your authority.'});
    callback.pathname = agency.data.kind === 'business' ? '/business' : '/agency';
    const isBiz = agency.data.kind === 'business';
    const grantWithFallback = async () => {
      let res = await caller.rpc('lv_set_staff_access', {target,email_address:email,access_role:role,access_clearance:clearance,modules});
      if (res.error && res.error.message.includes('Invalid role, clearance or module access')) {
        res = await caller.rpc('lv_set_staff_access', {
          target,
          email_address: email,
          access_role: role,
          access_clearance: clearance,
          modules: toDbModuleScopes(modules, isBiz),
        });
      }
      return res;
    };

    const admin = createClient(url, serviceKey, { auth });
    const created = await admin.auth.admin.createUser({
      email, password: randomBytes(32).toString('base64url'), email_confirm: true,
    });
    if (created.error?.code === 'email_exists' || created.error?.code === 'user_already_exists') {
      const grant = await grantWithFallback();
      return grant.error
        ? json(409, { error: 'This account already exists. Check that its email is confirmed and that its membership can be changed.' })
        : json(200, { existing: true });
    }
    if (created.error || !created.data.user) {
      return json(502, { error: 'The account could not be created.' });
    }
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: callback.href } });
    if (link.error || !link.data.properties?.action_link) {
      return json(502, { error: 'The account was created without agency access. Generate a setup link in Supabase Auth before assigning a role.' });
    }
    const grant = await grantWithFallback();
    if (grant.error) return json(409, { error: 'The account was created but agency access was not granted. Review agency status and use Personnel access.' });
    return json(201, { setupLink: link.data.properties.action_link });
  } catch {
    return json(502, { error: 'Account issuance could not be completed. Check the personnel list before retrying.' });
  }
}
