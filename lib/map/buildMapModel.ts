import { type GeoProjection, geoMercator } from "d3-geo";
import { polygonHull } from "d3-polygon";
import {
  legacyToLonLat,
  lonLatToLegacy,
  mergedFitObject,
} from "./legacyGeography";
import type { MapNodeView } from "@/lib/types/game.types";

const PADDING = 16;

export interface CountyHullPath {
  countyId: number;
  d: string;
}

/**
 * Per-county map data: label anchor + optional closed polygon in legacy space.
 */
export interface CountyMapInput {
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
 * County shapes: use `map_polygon` when present; otherwise convex hull of
 * anchor + nodes in that county.
 */
export function buildMapModel(
  viewW: number,
  viewH: number,
  nodes: MapNodeView[],
  counties: CountyMapInput[],
): {
  projection: GeoProjection;
  countyHulls: CountyHullPath[];
} {
  const nodeLonLat: [number, number][] = nodes.map((n) =>
    legacyToLonLat(n.map_x, n.map_y),
  );

  const extraLonLat: [number, number][] = [];
  for (const p of counties) {
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

  const countyHulls: CountyHullPath[] = [];
  const donePolygon = new Set<number>();

  for (const p of counties) {
    const d =
      p.map_polygon && p.map_polygon.length >= 3
        ? legacyPolygonRingToPathD(projection, p.map_polygon)
        : null;
    if (d) {
      countyHulls.push({ countyId: p.id, d });
      donePolygon.add(p.id);
    }
  }

  const byCounty = new Map<number, [number, number][]>();
  for (const p of counties) {
    if (donePolygon.has(p.id)) continue;
    const xy = projectLegacyXY(projection, p.map_x, p.map_y);
    if (!byCounty.has(p.id)) byCounty.set(p.id, []);
    byCounty.get(p.id)!.push(xy);
  }
  for (const n of nodes) {
    if (n.county_id === null || donePolygon.has(n.county_id)) continue;
    const xy = projectNode(projection, n);
    if (!byCounty.has(n.county_id)) byCounty.set(n.county_id, []);
    byCounty.get(n.county_id)!.push(xy);
  }

  for (const [countyId, pts] of byCounty) {
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      const [cx, cy] = pts[0]!;
      countyHulls.push({
        countyId,
        d: circlePath(cx, cy, 52),
      });
      continue;
    }
    if (pts.length === 2) {
      const [cx, cy] = [
        (pts[0]![0] + pts[1]![0]) / 2,
        (pts[0]![1] + pts[1]![1]) / 2,
      ];
      countyHulls.push({
        countyId,
        d: circlePath(cx, cy, 58),
      });
      continue;
    }
    const hull = polygonHull(pts);
    if (!hull || hull.length < 3) {
      const [cx, cy] = pts[0]!;
      countyHulls.push({ countyId, d: circlePath(cx, cy, 52) });
      continue;
    }
    countyHulls.push({
      countyId,
      d: hullToPath(hull as [number, number][]),
    });
  }

  countyHulls.sort((a, b) => b.d.length - a.d.length);

  return { projection, countyHulls };
}
