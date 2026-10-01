import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { World } from "./world";

export type Snap =
  | { kind: "point"; id: number; lon: number; lat: number }
  | { kind: "edge"; id: number; lon: number; lat: number }
  | { kind: "coast"; line: number; index: number; lon: number; lat: number }
  | { kind: "free"; lon: number; lat: number };

export interface SnapOptions {
  points?: boolean;
  edges?: boolean;
  coast?: boolean;
  /** The point being dragged never snaps to itself or its own segments. */
  exclude?: number;
}

const POINT_RADIUS = 11;
const LINE_RADIUS = 8;

type Px = { x: number; y: number };
type Box = { w: number; s: number; e: number; n: number };

/** The lon/lat box around a screen position, for cheap pre-filtering. */
function searchBox(map: MapLibreMap, px: Px, r: number): Box {
  const a = map.unproject([px.x - r, px.y - r]);
  const b = map.unproject([px.x + r, px.y + r]);
  return { w: Math.min(a.lng, b.lng), e: Math.max(a.lng, b.lng), s: Math.min(a.lat, b.lat), n: Math.max(a.lat, b.lat) };
}

const inBox = (lon: number, lat: number, b: Box) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n;

function closestOnSegment(p: Px, a: Px, b: Px): { x: number; y: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { x, y, d: Math.hypot(p.x - x, p.y - y) };
}

/**
 * What the cursor should stick to: an existing border point first, then the nearer of a
 * border edge or a coastline vertex, else the free position.
 */
export function findSnap(map: MapLibreMap, world: World, coast: CoastIndex | null, px: Px, options: SnapOptions): Snap {
  const free = map.unproject([px.x, px.y]);

  if (options.points !== false) {
    const box = searchBox(map, px, POINT_RADIUS);
    let best: Snap | null = null;
    let bestD = POINT_RADIUS;
    for (const p of world.points.values()) {
      if (p.id === options.exclude || !inBox(p.lon, p.lat, box)) continue;
      const s = map.project([p.lon, p.lat]);
      const d = Math.hypot(s.x - px.x, s.y - px.y);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "point", id: p.id, lon: p.lon, lat: p.lat };
      }
    }
    if (best) return best;
  }

  let best: Snap | null = null;
  let bestD = LINE_RADIUS;

  if (options.edges !== false) {
    const box = searchBox(map, px, LINE_RADIUS);
    for (const edge of world.edges.values()) {
      if (edge.point_a === options.exclude || edge.point_b === options.exclude) continue;
      const a = world.points.get(edge.point_a);
      const b = world.points.get(edge.point_b);
      if (!a || !b) continue;
      if (Math.max(a.lon, b.lon) < box.w || Math.min(a.lon, b.lon) > box.e || Math.max(a.lat, b.lat) < box.s || Math.min(a.lat, b.lat) > box.n) continue;
      const c = closestOnSegment(px, map.project([a.lon, a.lat]), map.project([b.lon, b.lat]));
      if (c.d <= bestD) {
        bestD = c.d;
        const at = map.unproject([c.x, c.y]);
        best = { kind: "edge", id: edge.id, lon: at.lng, lat: at.lat };
      }
    }
  }

  if (options.coast !== false && coast) {
    const hit = coast.nearest(map, px, bestD);
    if (hit) best = { kind: "coast", ...hit };
  }

  return best ?? { kind: "free", lon: free.lng, lat: free.lat };
}

/** The Natural Earth coastline, indexed for snapping and tracing. */
export class CoastIndex {
  private lines: [number, number][][];
  private boxes: Box[];

  constructor(data: FeatureCollection<LineString>) {
    this.lines = data.features.map((f) => f.geometry.coordinates as [number, number][]);
    this.boxes = this.lines.map((line) => {
      const b = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
      for (const [x, y] of line) {
        b.w = Math.min(b.w, x);
        b.e = Math.max(b.e, x);
        b.s = Math.min(b.s, y);
        b.n = Math.max(b.n, y);
      }
      return b;
    });
  }

  nearest(map: MapLibreMap, px: Px, radius: number): { line: number; index: number; lon: number; lat: number } | null {
    const box = searchBox(map, px, radius);
    let best: { line: number; index: number; lon: number; lat: number } | null = null;
    let bestD = radius;
    this.lines.forEach((line, li) => {
      const b = this.boxes[li]!;
      if (b.e < box.w || b.w > box.e || b.n < box.s || b.s > box.n) return;
      line.forEach(([lon, lat], i) => {
        if (!inBox(lon, lat, box)) return;
        const s = map.project([lon, lat]);
        const d = Math.hypot(s.x - px.x, s.y - px.y);
        if (d <= bestD) {
          bestD = d;
          best = { line: li, index: i, lon, lat };
        }
      });
    });
    return best;
  }

  /** The coastline vertices strictly between two vertices of one line, the short way round. */
  between(line: number, from: number, to: number): [number, number][] {
    const coords = this.lines[line];
    if (!coords) return [];
    const last = coords.length - 1;
    const closed = coords[0]![0] === coords[last]![0] && coords[0]![1] === coords[last]![1];
    // On a closed ring the last vertex is the first one again.
    if (closed && from === last) from = 0;
    if (closed && to === last) to = 0;
    if (from === to) return [];
    const forward = from < to ? coords.slice(from + 1, to) : coords.slice(to + 1, from).reverse();
    if (!closed) return forward;
    // On a closed ring the other way round may be shorter.
    const n = last;
    const otherCount = n - Math.abs(to - from) - 1;
    if (otherCount >= forward.length) return forward;
    const out: [number, number][] = [];
    const step = from < to ? -1 : 1;
    for (let i = (from + step + n) % n; i !== to; i = (i + step + n) % n) out.push(coords[i]!);
    return out;
  }
}

/**
 * The shortest way from one border point to another along existing segments that still
 * have a free side: tracing a neighbor's border while drawing next to it.
 */
export function borderPath(world: World, from: number, to: number): number[] | null {
  if (from === to) return null;
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  heap.push(from, 0);
  const target = world.points.get(to);
  if (!target) return null;
  let visited = 0;
  while (heap.size) {
    const { id, d } = heap.pop()!;
    if (id === to) break;
    if (d > (dist.get(id) ?? Infinity) || ++visited > 50000) continue;
    const p = world.points.get(id)!;
    for (const edgeId of world.edgesByPoint.get(id) ?? []) {
      const edge = world.edges.get(edgeId);
      if (!edge || (edge.left_county_id != null && edge.right_county_id != null)) continue;
      const next = edge.point_a === id ? edge.point_b : edge.point_a;
      const q = world.points.get(next);
      if (!q) continue;
      const nd = d + Math.hypot(q.lon - p.lon, q.lat - p.lat);
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, id);
        heap.push(next, nd);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let at: number | undefined = to; at !== undefined && at !== from; at = prev.get(at)) path.unshift(at);
  return path;
}

class MinHeap {
  private items: { id: number; d: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, d: number) {
    const items = this.items;
    items.push({ id, d });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.d <= items[i]!.d) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.d < items[m]!.d) m = l;
        if (r < items.length && items[r]!.d < items[m]!.d) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Douglas–Peucker on lon/lat with a tolerance in degrees. */
export function simplifyPath(coords: [number, number][], tolerance: number): [number, number][] {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let max = 0;
    let index = 0;
    const a = { x: coords[first]![0], y: coords[first]![1] };
    const b = { x: coords[last]![0], y: coords[last]![1] };
    for (let i = first + 1; i < last; i++) {
      const d = closestOnSegment({ x: coords[i]![0], y: coords[i]![1] }, a, b).d;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Degrees of longitude per screen pixel at this zoom (512 px tiles). */
export const degreesPerPixel = (zoom: number) => 360 / (512 * 2 ** zoom);
