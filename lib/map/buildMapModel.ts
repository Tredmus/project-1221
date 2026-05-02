import { type GeoProjection, geoMercator } from "d3-geo";
import { polygonHull } from "d3-polygon";
import {
  legacyToLonLat,
  lonLatToLegacy,
  mergedFitObject,
} from "./legacyGeography";
import type { MapNodeView } from "@/lib/types/game.types";

const PADDING = 16;

export interface ProvinceHullPath {
  provinceId: number;
  d: string;
}

/**
 * Per-province map data: label anchor + optional closed polygon in legacy space.
 */
export interface ProvinceMapInput {
  id: number;
  map_x: number;
  map_y: number;
  /** Vertices in parchment coordinates; same units as nodes. Closed ring. */
  map_polygon: [number, number][] | null;
}

function hullToPath(hull: [number, number][]): string {
  if (hull.length < 3) return "";
  const closed = [...hull, hull[0]!];
  return `M${closed.map((p) => `${p[0]},${p[1]}`).join("L")}Z`;
}

function circlePath(cx: number, cy: number, r: number): string {
  const d = r * 2;
  return `M${cx - r},${cy}a${r},${r} 0 1,1 ${d},0a${r},${r} 0 1,1 -${d},0`;
}

export function projectLegacyXY(
  projection: GeoProjection,
  map_x: number,
  map_y: number,
): [number, number] {
  const [lon, lat] = legacyToLonLat(map_x, map_y);
  const p = projection([lon, lat]);
  if (!p) return [0, 0];
  return [p[0], p[1]];
}

export function projectNode(
  projection: GeoProjection,
  n: MapNodeView,
): [number, number] {
  return projectLegacyXY(projection, n.map_x, n.map_y);
}

/** Inverse of {@link projectLegacyXY}: SVG map pixel coords → legacy parchment. */
export function projectedXYToLegacy(
  projection: GeoProjection,
  px: number,
  py: number,
): [number, number] | null {
  const inv = projection.invert?.([px, py]);
  if (!inv) return null;
  const [lon, lat] = inv;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return lonLatToLegacy(lon, lat);
}

/** Project a closed legacy-space ring to an SVG path `d` string. */
export function legacyPolygonRingToPathD(
  projection: GeoProjection,
  ring: [number, number][],
): string | null {
  if (ring.length < 3) return null;
  const projected: [number, number][] = [];
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    projected.push(projectLegacyXY(projection, x, y));
  }
  const first = projected[0]!;
  const last = projected[projected.length - 1]!;
  const eps = 1e-3;
  if (
    projected.length > 1 &&
    Math.abs(first[0] - last[0]) < eps &&
    Math.abs(first[1] - last[1]) < eps
  ) {
    projected.pop();
  }
  if (projected.length < 3) return null;
  return (
    "M" + projected.map((p) => `${p[0]},${p[1]}`).join("L") + "Z"
  );
}

/**
 * Province shapes: use `map_polygon` when present; otherwise convex hull of
 * anchor + nodes in that province.
 */
export function buildMapModel(
  viewW: number,
  viewH: number,
  nodes: MapNodeView[],
  provinces: ProvinceMapInput[],
): {
  projection: GeoProjection;
  provinceHulls: ProvinceHullPath[];
} {
  const nodeLonLat: [number, number][] = nodes.map((n) =>
    legacyToLonLat(n.map_x, n.map_y),
  );

  const extraLonLat: [number, number][] = [];
  for (const p of provinces) {
    extraLonLat.push(legacyToLonLat(p.map_x, p.map_y));
    if (p.map_polygon) {
      for (const [x, y] of p.map_polygon) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          extraLonLat.push(legacyToLonLat(x, y));
        }
      }
    }
  }

  let allLonLat: [number, number][] = [...nodeLonLat, ...extraLonLat];
  if (allLonLat.length === 0) {
    allLonLat = [[28.9784, 41.0082]];
  }

  const fitObj = mergedFitObject(allLonLat);
  const projection = geoMercator()
    .fitExtent(
      [
        [PADDING, PADDING],
        [viewW - PADDING, viewH - PADDING],
      ],
      fitObj,
    );

  const provinceHulls: ProvinceHullPath[] = [];
  const donePolygon = new Set<number>();

  for (const p of provinces) {
    const d =
      p.map_polygon && p.map_polygon.length >= 3
        ? legacyPolygonRingToPathD(projection, p.map_polygon)
        : null;
    if (d) {
      provinceHulls.push({ provinceId: p.id, d });
      donePolygon.add(p.id);
    }
  }

  const byProvince = new Map<number, [number, number][]>();
  for (const p of provinces) {
    if (donePolygon.has(p.id)) continue;
    const xy = projectLegacyXY(projection, p.map_x, p.map_y);
    if (!byProvince.has(p.id)) byProvince.set(p.id, []);
    byProvince.get(p.id)!.push(xy);
  }
  for (const n of nodes) {
    if (n.province_id === null || donePolygon.has(n.province_id)) continue;
    const xy = projectNode(projection, n);
    if (!byProvince.has(n.province_id)) byProvince.set(n.province_id, []);
    byProvince.get(n.province_id)!.push(xy);
  }

  for (const [provinceId, pts] of byProvince) {
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      const [cx, cy] = pts[0]!;
      provinceHulls.push({
        provinceId,
        d: circlePath(cx, cy, 52),
      });
      continue;
    }
    if (pts.length === 2) {
      const [cx, cy] = [
        (pts[0]![0] + pts[1]![0]) / 2,
        (pts[0]![1] + pts[1]![1]) / 2,
      ];
      provinceHulls.push({
        provinceId,
        d: circlePath(cx, cy, 58),
      });
      continue;
    }
    const hull = polygonHull(pts);
    if (!hull || hull.length < 3) {
      const [cx, cy] = pts[0]!;
      provinceHulls.push({ provinceId, d: circlePath(cx, cy, 52) });
      continue;
    }
    provinceHulls.push({
      provinceId,
      d: hullToPath(hull as [number, number][]),
    });
  }

  provinceHulls.sort((a, b) => b.d.length - a.d.length);

  return { projection, provinceHulls };
}
