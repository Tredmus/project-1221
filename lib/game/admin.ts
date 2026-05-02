import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Optional env allow-list (comma-separated auth user UUIDs). Use for local
 * bootstrap or automation when the DB row is not yet set to admin.
 */
export function isEnvListedAdminUserId(
  userId: string | undefined | null,
): boolean {
  if (!userId) return false;
  const allowList = (process.env.IMPERIUM_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowList.includes(userId);
}

/**
 * True if the user may access /admin (env allow-list OR public.users.role).
 */
export async function isAdminUser(
  supabase: SupabaseClient,
  userId: string | undefined | null,
): Promise<boolean> {
  if (!userId) return false;
  if (isEnvListedAdminUserId(userId)) return true;

  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;
  return (data as { role: string }).role === "admin";
}
