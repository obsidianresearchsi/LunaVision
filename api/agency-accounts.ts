import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

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
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
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
    if (!platform.data) return json(403, { error: 'Platform administrator access is required.' });

    const input = await request.json().catch(() => null);
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    const target = typeof input?.workspaceId === 'string' ? input.workspaceId : '';
    const role = input?.role;
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        (role !== 'member' && role !== 'admin') || input?.verified !== true) {
      return json(400, { error: 'Choose an agency role and confirm that the recipient and email were verified.' });
    }
    const agency = await caller.from('lv_workspaces').select('id').eq('id', target).eq('kind', 'agency').eq('active', true).maybeSingle();
    if (agency.error) return json(503, { error: 'Agency status could not be verified.' });
    if (!agency.data) return json(403, { error: 'Select an active agency.' });

    const admin = createClient(url, serviceKey, { auth });
    const created = await admin.auth.admin.createUser({
      email, password: randomBytes(32).toString('base64url'), email_confirm: true,
    });
    if (created.error?.code === 'email_exists' || created.error?.code === 'user_already_exists') {
      const grant = await caller.rpc('lv_manage_workspace_access', { target, email_address: email, access_role: role });
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
    const grant = await caller.rpc('lv_manage_workspace_access', { target, email_address: email, access_role: role });
    if (grant.error) return json(409, { error: 'The account was created but agency access was not granted. Review agency status and use Personnel access.' });
    return json(201, { setupLink: link.data.properties.action_link });
  } catch {
    return json(502, { error: 'Account issuance could not be completed. Check the personnel list before retrying.' });
  }
}
