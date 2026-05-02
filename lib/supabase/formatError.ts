/** Serialize PostgrestError / unknown for logs (avoid `{}` in console). */
export function formatSupabaseError(err: unknown): string {
  if (err == null) return "null";
  if (typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  return JSON.stringify({
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
  });
}
