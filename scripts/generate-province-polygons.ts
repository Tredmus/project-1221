/**
 * Generates SQL UPDATEs for provinces.map_polygon from WGS84 rings.
 * Same calibration as lib/map/legacyGeography.ts (lonLatToLegacy).
 *
 * Usage:
 *   npx --yes tsx scripts/generate-province-polygons.ts
 *   npx --yes tsx scripts/generate-province-polygons.ts --write
 *
 * `--write` emits `supabase/migrations/014_province_polygons_detailed.sql` (UTF-8).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { lonLatToLegacy } from "../lib/map/legacyGeography";

type LonLat = [number, number];

function segmentLen(a: LonLat, b: LonLat): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Insert vertices along each edge so no segment exceeds ~maxSegDeg (typ. 0.06° ≈ 6 km). */
function densifyRing(ring: LonLat[], maxSegDeg: number): LonLat[] {
  if (ring.length < 3) return ring;
  const out: LonLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const n = Math.max(1, Math.ceil(segmentLen(a, b) / maxSegDeg));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
      ]);
    }
  }
  return out;
}

function ringToSqlJson(ringLonLat: LonLat[]): string {
  const legacy = ringLonLat.map(
    ([lon, lat]) => lonLatToLegacy(lon, lat) as [number, number],
  );
  const rounded = legacy.map(
    ([mx, my]) =>
      [Math.round(mx * 10) / 10, Math.round(my * 10) / 10] as [number, number],
  );
  return JSON.stringify(rounded);
}

/**
 * Coarse rings are traced along approximate regional geography (Greek peripheries,
 * Turkish East Thrace, Danube–Balkan outline for Moesia). Densification smooths edges.
 */
const COARSE: Record<string, LonLat[]> = {
  // Greek Western Macedonia / Epirus fringe (trimmed south so the map fit stays near the node cluster)
  "Western Macedonia": [
    [22.62, 41.12],
    [22.5, 40.92],
    [22.38, 40.72],
    [22.22, 40.48],
    [22.02, 40.28],
    [21.78, 40.08],
    [21.55, 39.88],
    [21.28, 39.68],
    [21.05, 39.52],
    [20.88, 39.38],
    [20.82, 39.28],
    [20.9, 39.18],
    [21.08, 39.12],
    [21.28, 39.18],
    [21.48, 39.32],
    [21.68, 39.52],
    [21.88, 39.72],
    [22.05, 39.95],
    [22.22, 40.18],
    [22.38, 40.42],
    [22.52, 40.65],
    [22.6, 40.88],
    [22.64, 41.05],
    [22.62, 41.12],
  ],

  // Greek Central Macedonia: Thermaic gulf, Strymon, Chalkidiki as one smoothed lobe; west abuts Western
  "Central Macedonia": [
    [22.62, 41.12],
    [23.02, 41.2],
    [23.45, 41.18],
    [23.88, 41.1],
    [24.25, 40.95],
    [24.52, 40.75],
    [24.65, 40.52],
    [24.68, 40.32],
    [24.55, 40.12],
    [24.32, 39.95],
    [24.05, 39.85],
    [23.75, 39.82],
    [23.45, 39.88],
    [23.2, 40.0],
    [22.95, 40.15],
    [22.75, 40.32],
    [22.58, 40.48],
    [22.48, 40.65],
    [22.45, 40.85],
    [22.48, 41.0],
    [22.55, 41.1],
    [22.62, 41.12],
  ],

  // European Turkey + Greek Thrace + Marmara littoral (game scale): traced CCW from NW
  "Eastern Thrace": [
    [26.35, 41.72],
    [26.55, 41.85],
    [26.82, 41.95],
    [27.15, 42.02],
    [27.52, 41.98],
    [27.92, 41.85],
    [28.35, 41.65],
    [28.75, 41.38],
    [29.05, 41.08],
    [29.22, 40.78],
    [29.28, 40.48],
    [29.18, 40.22],
    [28.95, 40.02],
    [28.62, 39.88],
    [28.25, 39.82],
    [27.85, 39.88],
    [27.45, 40.05],
    [27.05, 40.28],
    [26.68, 40.48],
    [26.35, 40.68],
    [26.05, 40.88],
    [25.82, 41.08],
    [25.68, 41.28],
    [25.72, 41.48],
    [25.92, 41.62],
    [26.12, 41.68],
    [26.35, 41.72],
  ],

  // Danube littoral + Dobruja / northern Bulgaria (tightened to keep map scale near seeded nodes)
  "Moesia": [
    [22.65, 43.95],
    [23.35, 44.08],
    [24.2, 44.12],
    [25.15, 44.05],
    [26.15, 43.92],
    [27.15, 43.72],
    [28.05, 43.48],
    [28.75, 43.22],
    [29.18, 42.88],
    [29.35, 42.48],
    [29.05, 42.12],
    [28.35, 41.82],
    [27.45, 41.62],
    [26.55, 41.48],
    [25.65, 41.38],
    [24.75, 41.32],
    [23.85, 41.28],
    [23.15, 41.32],
    [22.65, 41.48],
    [22.35, 41.78],
    [22.28, 42.25],
    [22.35, 42.75],
    [22.48, 43.28],
    [22.65, 43.95],
  ],
};

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function emitSql(): string {
  const lines: string[] = [
    "-- Imperium - Migration 014: detailed province polygons",
    "-- Outlines traced in WGS84 (approximate regional geography), projected into",
    "-- parchment space with lonLatToLegacy (see lib/map/legacyGeography.ts).",
    "-- Regenerate: npx --yes tsx scripts/generate-province-polygons.ts --write",
    "",
  ];

  const maxSeg = 0.055;

  for (const [name, coarse] of Object.entries(COARSE)) {
    const dense = densifyRing(coarse, maxSeg);
    const json = ringToSqlJson(dense);
    lines.push(
      `UPDATE public.provinces`,
      `SET map_polygon = '${escapeSqlString(json)}'::jsonb`,
      `WHERE name = '${escapeSqlString(name)}';`,
      "",
    );
  }

  return lines.join("\n");
}

function main(): void {
  const sql = emitSql();
  const write = process.argv.includes("--write");
  if (write) {
    const out = join(
      process.cwd(),
      "supabase/migrations/014_province_polygons_detailed.sql",
    );
    writeFileSync(out, sql, "utf8");
    console.log(`Wrote ${out}`);
    return;
  }
  console.log(sql);
}

main();
