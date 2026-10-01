import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, type Database } from "@1221/shared";

/** Client components: reads the session cookies set at sign-in. */
export function createBrowserSupabase() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

export type BrowserSupabase = ReturnType<typeof createBrowserSupabase>;
