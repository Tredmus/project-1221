"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * Uses the anon/publishable key. ALL queries go through RLS — the client is
 * trusted to nothing. Use this only inside Client Components, and only for
 * reads that don't need the cookie-bound session (e.g. Realtime subscriptions
 * for clan chat and notifications).
 *
 * Mutations should NOT happen from the browser — they go through Server
 * Actions. See lib/supabase/server.ts and the README architecture rules.
 */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
