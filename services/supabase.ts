/// <reference types="vite/client" />

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const hostedPreview = import.meta.env.MODE === 'vercel';
const workspaceUrl = hostedPreview ? '' : import.meta.env.VITE_SUPABASE_URL?.trim();
const workspaceKey = hostedPreview ? '' : import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const workspaceEnabled = Boolean(workspaceUrl && workspaceKey);
export const SUPABASE_URL = workspaceEnabled ? workspaceUrl.replace(/\/+$/, '') : 'https://unconfigured.invalid';
export const SUPABASE_ANON_KEY = workspaceEnabled ? workspaceKey : 'unconfigured';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
