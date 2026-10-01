import type { BorderEdge, BorderPoint, CountyPolygon, TierLinks } from './types';

type PointLookup = (id: number) => BorderPoint | undefined;

/** Twice the signed area of a ring in lon/lat; positive = counter-clockwise. */
export function signedArea(ring: readonly { lon: number; lat: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.lon * b.lat - b.lon * a.lat;
  }
  return sum;
}

/** Even-odd test: is (lon, lat) inside the ring? */
export function pointInRing(lon: number, lat: number, ring: readonly { lon: number; lat: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > lat !== b.lat > lat && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) {
      inside = !inside;
    }
  }
  return inside;
}

interface HalfEdge {
  from: number;
  to: number;
}

/**
 * Assembles every county's outline from the shared edges. Each edge gives its left county
 * the direction a→b and its right county b→a, so every county is walked with its inside
 * on the left: outer rings come out counter-clockwise and holes clockwise.
 */
export function buildCountyPolygons(edges: Iterable<BorderEdge>, point: PointLookup): Map<number, CountyPolygon[]> {
  const byCounty = new Map<number, HalfEdge[]>();
  const add = (county: number | null, from: number, to: number) => {
    if (county == null) return;
    let list = byCounty.get(county);
    if (!list) byCounty.set(county, (list = []));
    list.push({ from, to });
  };
  for (const e of edges) {
    add(e.left_county_id, e.point_a, e.point_b);
    add(e.right_county_id, e.point_b, e.point_a);
  }

  const result = new Map<number, CountyPolygon[]>();
  for (const [county, halfEdges] of byCounty) {
    result.set(county, polygonsFromRings(walkRings(halfEdges, point), point));
  }
  return result;
}

/** Follows half-edges into closed rings of point ids. Open chains (broken data) are dropped. */
function walkRings(halfEdges: HalfEdge[], point: PointLookup): number[][] {
  const outgoing = new Map<number, HalfEdge[]>();
  for (const h of halfEdges) {
    let list = outgoing.get(h.from);
    if (!list) outgoing.set(h.from, (list = []));
    list.push(h);
  }
  const used = new Set<HalfEdge>();
  const rings: number[][] = [];

  for (const start of halfEdges) {
    if (used.has(start)) continue;
    const ring: number[] = [];
    let current: HalfEdge | undefined = start;
    let closed = false;
    while (current && !used.has(current)) {
      used.add(current);
      ring.push(current.from);
      if (current.to === start.from) {
        closed = true;
        break;
      }
      current = nextHalfEdge(current, outgoing.get(current.to) ?? [], used, point);
    }
    if (closed && ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * Where a county touches itself at one point, several edges leave that point: take the
 * first one clockwise from the way we came in, which keeps the inside on the left and the
 * rings simple.
 */
function nextHalfEdge(incoming: HalfEdge, candidates: HalfEdge[], used: Set<HalfEdge>, point: PointLookup): HalfEdge | undefined {
  const free = candidates.filter((h) => !used.has(h));
  if (free.length <= 1) return free[0];
  const v = point(incoming.to);
  const u = point(incoming.from);
  if (!v || !u) return free[0];
  const back = Math.atan2(u.lat - v.lat, u.lon - v.lon);
  let best: HalfEdge | undefined;
  let bestTurn = Infinity;
  for (const h of free) {
    const w = point(h.to);
    if (!w) continue;
    let turn = back - Math.atan2(w.lat - v.lat, w.lon - v.lon);
    while (turn <= 0) turn += 2 * Math.PI;
    while (turn > 2 * Math.PI) turn -= 2 * Math.PI;
    if (turn < bestTurn) {
      bestTurn = turn;
      best = h;
    }
  }
  return best ?? free[0];
}

function polygonsFromRings(rings: number[][], point: PointLookup): CountyPolygon[] {
  const coords = (ring: number[]) => ring.map(point).filter((p): p is BorderPoint => p !== undefined);
  const outers: { ring: number[]; coords: BorderPoint[]; holes: number[][] }[] = [];
  const holes: number[][] = [];
  for (const ring of rings) {
    const c = coords(ring);
    if (signedArea(c) > 0) outers.push({ ring, coords: c, holes: [] });
    else holes.push(ring);
  }
  for (const hole of holes) {
    const first = point(hole[0]!);
    const owner = first && outers.find((o) => pointInRing(first.lon, first.lat, o.coords));
    if (owner) owner.holes.push(hole);
  }
  return outers.map((o) => ({ outer: o.ring, holes: o.holes }));
}

/** Is (lon, lat) inside any piece of the county? */
export function pointInCounty(lon: number, lat: number, polygons: readonly CountyPolygon[], point: PointLookup): boolean {
  const coords = (ring: number[]) => ring.map(point).filter((p): p is BorderPoint => p !== undefined);
  return polygons.some(
    (p) => pointInRing(lon, lat, coords(p.outer)) && !p.holes.some((h) => pointInRing(lon, lat, coords(h))),
  );
}

/** The county that contains (lon, lat), or null. */
export function findCounty(
  lon: number,
  lat: number,
  polygons: ReadonlyMap<number, readonly CountyPolygon[]>,
  point: PointLookup,
): number | null {
  for (const [county, pieces] of polygons) {
    if (pointInCounty(lon, lat, pieces, point)) return county;
  }
  return null;
}

/**
 * How important the border along an edge is: the highest tier whose units differ on its
 * two sides. Unassigned links never merge counties, but only count as a border at a tier
 * where at least one side has a unit (so a map without duchies shows county lines only).
 * 'outer' is the edge of the drawn world: the sea, or counties not drawn yet.
 */
export type BorderLevel = 'outer' | 'empire' | 'kingdom' | 'duchy' | 'county';

export function borderLeveler(links: TierLinks): (edge: BorderEdge) => BorderLevel {
  const duchyOf = new Map<number, number | null>();
  const kingdomOf = new Map<number, number | null>();
  const empireOf = new Map<number, number | null>();
  for (const c of links.counties) duchyOf.set(c.id, c.duchy_id);
  for (const d of links.duchies) kingdomOf.set(d.id, d.kingdom_id);
  for (const k of links.kingdoms) empireOf.set(k.id, k.empire_id);

  const chain = (county: number) => {
    const duchy = duchyOf.get(county) ?? null;
    const kingdom = duchy == null ? null : (kingdomOf.get(duchy) ?? null);
    const empire = kingdom == null ? null : (empireOf.get(kingdom) ?? null);
    return { duchy, kingdom, empire };
  };
  const differs = (a: number | null, b: number | null) => a !== b && (a != null || b != null);

  return (edge) => {
    if (edge.left_county_id == null || edge.right_county_id == null) return 'outer';
    const l = chain(edge.left_county_id);
    const r = chain(edge.right_county_id);
    if (differs(l.empire, r.empire)) return 'empire';
    if (differs(l.kingdom, r.kingdom)) return 'kingdom';
    if (differs(l.duchy, r.duchy)) return 'duchy';
    return 'county';
  };
}
