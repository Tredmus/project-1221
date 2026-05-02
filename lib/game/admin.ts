import "server-only";

/**
 * Returns true if the given Supabase auth user id is in the admin allow-list.
 *
 * The allow-list comes from the IMPERIUM_ADMIN_USER_IDS env var
 * (comma-separated user UUIDs). This is a deliberately boring mechanism for
 * the MVP — once we have a settled in-game role system, replace this helper
 * with a query against `characters.titles` containing 'admin'. Don't replace
 * it with a client-readable check, ever.
 */
export function isAdminUserId(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const allowList = (process.env.IMPERIUM_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowList.includes(userId);
}
