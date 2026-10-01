import type { AppSupabaseClient } from './supabase';

export type DatabaseStatus =
  | { state: 'checking' }
  | { state: 'connected' }
  | { state: 'error'; message: string };

/**
 * A one-row read of a table anyone may read. (A head-only request can't report a missing
 * table: its 404 has no body, so supabase-js returns no error.)
 */
export async function checkDatabase(client: AppSupabaseClient): Promise<DatabaseStatus> {
  try {
    const { error } = await client.from('cultures').select('id').limit(1);
    return error ? { state: 'error', message: error.message } : { state: 'connected' };
  } catch (error) {
    return { state: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
