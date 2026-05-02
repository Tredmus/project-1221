import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Server-side Supabase client bound to the user's session cookie.
 *
 * Use this inside:
 *   - Server Components
 *   - Server Actions
 *   - Route Handlers
 *
 * Queries are RLS-enforced as the logged-in user (or anon if no session).
 * The client refreshes the auth cookie automatically when needed; the
 * `setAll` callback may throw inside a Server Component, which is fine —
 * the root middleware in `middleware.ts` is responsible for refreshing
 * cookies on each request.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — safe to ignore. The
            // middleware will refresh the session on the next request.
          }
        },
      },
    },
  );
}
