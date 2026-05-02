import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE Supabase client.
 *
 * ⚠ DANGER. This client bypasses Row Level Security entirely. It speaks for
 * the database itself, not for any user.
 *
 * Allowed callers:
 *   1. Edge Functions running the nightly cron (`supabase/functions/*`).
 *   2. A small, explicit set of admin Server Actions that are gated on the
 *      caller having the `admin` title — and that gate must be re-checked
 *      on every request, not assumed.
 *
 * Forbidden callers:
 *   - ANY Client Component (`"use client"`).
 *   - Any module imported transitively by Client Components.
 *   - Any Server Action that runs on behalf of an unauthenticated visitor
 *     unless the action itself is the auth flow (e.g. creating the public
 *     `users` row from a database trigger is preferred over doing it here).
 *
 * The `import "server-only"` directive at the top of this file is a build-
 * time safety net: if a Client Component ever transitively imports this
 * file, the build will fail.
 */
export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Service-role client requested but SUPABASE_SERVICE_ROLE_KEY or " +
        "NEXT_PUBLIC_SUPABASE_URL is missing. Check .env.local.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
