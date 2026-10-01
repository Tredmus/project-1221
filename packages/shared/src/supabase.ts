import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import type { Database } from './database.types';

/** Anything with the async-storage shape: AsyncStorage on mobile, localStorage on web. */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface ClientOptions {
  /** Where the login session is kept. Omit on the server or to use the browser default. */
  storage?: AuthStorage;
  /** Keep the user logged in between launches. Off for server-side clients. */
  persistSession?: boolean;
  /** Read auth callbacks from the URL (web only). */
  detectSessionInUrl?: boolean;
}

export function createSupabaseClient(options: ClientOptions = {}) {
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: options.storage,
      persistSession: options.persistSession ?? true,
      autoRefreshToken: options.persistSession ?? true,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
    },
  });
}

export type AppSupabaseClient = ReturnType<typeof createSupabaseClient>;
