import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const isSupabaseConfigured = () => Boolean(url && publishableKey && /^https:\/\//.test(url));

let client: SupabaseClient | null = null;

/** The only keys accepted by this browser client are Supabase's URL and publishable/anon key. */
export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) throw new Error('SUPABASE_NOT_CONFIGURED');
  if (!client) client = createClient(url!, publishableKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { 'X-Client-Info': 'pybit-web-pwa' } }
  });
  return client;
}

export type AuthenticatedProfile = { authUserId: string; memberId: string; role: 'czh' | 'waka' | 'member' };
export type AuthCallbackMode = 'invite' | 'recovery' | null;
export type AuthCallbackState = { mode: AuthCallbackMode; error: 'invite_expired' | 'recovery_expired' | 'invalid' | null };

/** Reads both query and hash parameters because Supabase can use either PKCE or implicit callbacks. */
export function getAuthCallbackState(locationValue: string): AuthCallbackState {
  const url = new URL(locationValue); const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const value = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  const type = value('type') ?? url.searchParams.get('auth'); const rawError = value('error') ?? value('error_code') ?? value('error_description');
  const mode: AuthCallbackMode = type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : null;
  if (!rawError) return { mode, error: null };
  if (/expired|otp_expired|access_denied/i.test(rawError)) return { mode, error: mode === 'invite' ? 'invite_expired' : mode === 'recovery' ? 'recovery_expired' : 'invalid' };
  return { mode, error: 'invalid' };
}

/** Auth redirects always return to the exact currently hosted application origin, never an arbitrary URL. */
export function authRedirectUrl(mode: Exclude<AuthCallbackMode, null>): string {
  const target = new URL(window.location.origin); target.searchParams.set('auth', mode);
  if (import.meta.env.PROD && target.protocol !== 'https:') throw new Error('PRODUCTION_HTTPS_REQUIRED');
  return target.toString();
}

export function profileFromState(value: unknown, authUserId: string): AuthenticatedProfile {
  if (!value || typeof value !== 'object') throw new Error('PROFILE_NOT_BOUND');
  const profile = (value as { profile?: unknown }).profile;
  if (!profile || typeof profile !== 'object') throw new Error('PROFILE_NOT_BOUND');
  const memberId = (profile as { memberId?: unknown }).memberId;
  const role = (profile as { role?: unknown }).role;
  if (typeof memberId !== 'string' || !['czh', 'waka', 'member'].includes(String(role))) throw new Error('PROFILE_NOT_BOUND');
  return { authUserId, memberId, role: role as AuthenticatedProfile['role'] };
}
