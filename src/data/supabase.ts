import type { AppRepository } from './appRepository';
import { SupabaseLedgerRepository } from './supabaseRepository';

/** A browser build receives only Supabase's public URL and publishable/anon key through deployment env vars. */
export const createSupabaseRepository = (): AppRepository => new SupabaseLedgerRepository();
