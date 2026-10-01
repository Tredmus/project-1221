import { buildCountyPolygons, type BorderEdge, type BorderPoint, type CountyPolygon } from "@1221/game-core";
import type { Feature, FeatureCollection, Geometry, LineString, MultiPolygon, Point, Position } from "geojson";
import type { World } from "./world";

export type ColorBy = "county" | "duchy" | "kingdom" | "empire";
type LonLat = { lon: number; lat: number };
type Lookup = (id: number) => LonLat | undefined;

export const UNASSIGNED_COLOR = "#c9c2b6";

/** A stable, well-spread color per id (golden-angle hues). */
export function groupColor(id: number | null | undefined): string {
  if (id == null) return UNASSIGNED_COLOR;
  return `hsl(${((id * 137.508) % 360).toFixed(1)}, 48%, 58%)`;
}

export const collection = <G extends Geometry>(features: Feature<G>[]): FeatureCollection<G> => ({ type: "FeatureCollection", features });

const position = (p: LonLat): Position => [p.lon, p.lat];

function ring(ids: number[], lookup: Lookup): Position[] {
  const coords = ids.map(lookup).filter((p): p is LonLat => p !== undefined).map(position);
  if (coords.length) coords.push(coords[0]!);
  return coords;
}

export function multiPolygon(pieces: CountyPolygon[], lookup: Lookup): MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: pieces.map((p) => [ring(p.outer, lookup), ...p.holes.map((h) => ring(h, lookup))]).filter((p) => p[0]!.length >= 4),
  };
}

function countyGroup(world: World, countyId: number, colorBy: ColorBy): number | null {
  const county = world.counties.get(countyId);
  switch (colorBy) {
    case "county":
      return countyId;
    case "duchy":
      return county?.duchy_id ?? null;
    case "kingdom":
      return world.kingdomOfCounty(county);
    case "empire":
      return world.empireOfCounty(county);
  }
}

export function countyFeatures(world: World, colorBy: ColorBy): Feature<MultiPolygon>[] {
  const features: Feature<MultiPolygon>[] = [];
  for (const [id, pieces] of world.polygons) {
    if (!world.counties.has(id)) continue;
    features.push({
      type: "Feature",
      id,
      properties: { color: groupColor(countyGroup(world, id, colorBy)) },
      geometry: multiPolygon(pieces, world.point),
    });
  }
  return features;
}

/** Outlines of a few counties with some points moved (while dragging). */
export function countyGeometries(world: World, countyIds: Iterable<number>, lookup: Lookup): { id: number; geometry: MultiPolygon }[] {
  const out: { id: number; geometry: MultiPolygon }[] = [];
  for (const id of countyIds) {
    const edges: BorderEdge[] = [];
    for (const edgeId of world.edgesByCounty.get(id) ?? []) {
      const edge = world.edges.get(edgeId);
      if (edge) edges.push(edge);
    }
    const pieces = buildCountyPolygons(edges, (pid) => {
      const p = lookup(pid);
      return p && { id: pid, lon: p.lon, lat: p.lat };
    }).get(id);
    out.push({ id, geometry: multiPolygon(pieces ?? [], lookup) });
  }
  return out;
}

export function edgeGeometry(edge: BorderEdge, lookup: Lookup): LineString {
  const a = lookup(edge.point_a);
  const b = lookup(edge.point_b);
  return { type: "LineString", coordinates: a && b ? [position(a), position(b)] : [] };
}

/** Border segments with the tier they separate, for line weight. */
export function edgeFeatures(world: World): Feature<LineString>[] {
  const level = world.borderLevel();
  const features: Feature<LineString>[] = [];
  for (const edge of world.edges.values()) {
    features.push({
      type: "Feature",
      id: edge.id,
      properties: { level: level(edge), l: edge.left_county_id ?? -1, r: edge.right_county_id ?? -1 },
      geometry: edgeGeometry(edge, world.point),
    });
  }
  return features;
}

export function pointFeatures(world: World): Feature<Point>[] {
  const features: Feature<Point>[] = [];
  for (const p of world.points.values()) {
    features.push({
      type: "Feature",
      id: p.id,
      properties: { junction: (world.edgesByPoint.get(p.id)?.size ?? 0) > 2 },
      geometry: { type: "Point", coordinates: position(p) },
    });
  }
  return features;
}

export function nodeFeatures(world: World): Feature<Point>[] {
  const mains = new Set<number>();
  for (const c of world.counties.values()) if (c.main_node_id != null) mains.add(c.main_node_id);
  return [...world.nodes.values()].map((n) => ({
    type: "Feature",
    id: n.id,
    properties: { type: n.type, main: mains.has(n.id), name: n.name ?? "" },
    geometry: { type: "Point", coordinates: position(n) },
  }));
}

export function roadGeometry(a: LonLat | undefined, b: LonLat | undefined): LineString {
  return { type: "LineString", coordinates: a && b ? [position(a), position(b)] : [] };
}

export function roadFeatures(world: World): Feature<LineString>[] {
  return [...world.roads.values()].map((r) => ({
    type: "Feature",
    id: r.id,
    properties: {},
    geometry: roadGeometry(world.nodes.get(r.node_a), world.nodes.get(r.node_b)),
  }));
}

/** County names at the centroid of each county's largest piece. */
export function labelFeatures(world: World): Feature<Point>[] {
  const features: Feature<Point>[] = [];
  for (const [id, pieces] of world.polygons) {
    const county = world.counties.get(id);
    if (!county) continue;
    let best: { area: number; x: number; y: number } | null = null;
    for (const piece of pieces) {
      const c = centroid(piece.outer.map(world.point).filter((p): p is BorderPoint => p !== undefined));
      if (c && (!best || c.area > best.area)) best = c;
    }
    if (best) features.push({ type: "Feature", id, properties: { name: county.name }, geometry: { type: "Point", coordinates: [best.x, best.y] } });
  }
  return features;
}

function centroid(ring: LonLat[]): { area: number; x: number; y: number } | null {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const f = p.lon * q.lat - q.lon * p.lat;
    a += f;
    x += (p.lon + q.lon) * f;
    y += (p.lat + q.lat) * f;
  }
  if (a === 0) return null;
  return { area: Math.abs(a / 2), x: x / (3 * a), y: y / (3 * a) };
}
