/**
 * Normalise Supabase jsonb into a closed ring [[x,y], ...] or null.
 * PostgREST / drivers sometimes return jsonb as a JSON string; unwrap that
 * (and occasional double-encoding) before validating pairs.
 */
export function parseCountyPolygon(raw: unknown): [number, number][] | null {
  if (raw == null) return null;

  let data: unknown = raw;
  for (let depth = 0; depth < 3 && typeof data === "string"; depth++) {
    const s = data.trim();
    if (!s) return null;
    try {
      data = JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }

  if (!Array.isArray(data)) return null;

  const out: [number, number][] = [];
  for (const pair of data) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([x, y]);
  }
  return out.length >= 3 ? out : null;
}
