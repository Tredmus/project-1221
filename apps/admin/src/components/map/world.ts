import {
  borderLeveler,
  buildCountyPolygons,
  findCounty,
  type BorderEdge,
  type BorderLevel,
  type BorderPoint,
  type CountyPolygon,
} from "@1221/game-core";
import type { Tables } from "@1221/shared";

export type Empire = Tables<"empires">;
export type Kingdom = Tables<"kingdoms">;
export type Duchy = Tables<"duchies">;
export type County = Tables<"counties">;
export type MapNode = Tables<"nodes">;
export type Road = Tables<"roads">;
export type Culture = Tables<"cultures">;
export type Religion = Tables<"religions">;
export type MapReference = Tables<"map_references">;

/** What get_world_map() returns. */
export interface WorldSnapshot {
  empires: Empire[];
  kingdoms: Kingdom[];
  duchies: Duchy[];
  counties: County[];
  nodes: MapNode[];
  roads: Road[];
  points: BorderPoint[];
  edges: BorderEdge[];
  cultures: Culture[];
  religions: Religion[];
}

/** What the map_* database functions return: full rows that changed, and deleted ids. */
export interface MapPatch {
  points?: BorderPoint[];
  edges?: BorderEdge[];
  counties?: County[];
  nodes?: MapNode[];
  roads?: Road[];
  deleted?: { points?: number[]; edges?: number[]; counties?: number[]; nodes?: number[]; roads?: number[] };
}

export type TierKind = "empires" | "kingdoms" | "duchies";

/** Revision counters: the map view rebuilds a layer only when one of its inputs moved on. */
export interface Revisions {
  geometry: number;
  counties: number;
  tiers: number;
  nodes: number;
  roads: number;
  references: number;
}

/**
 * The editor's copy of the world map. Changes come in as patches from the database and
 * bump revision counters; React re-renders through subscribe/version, the map view
 * through the revisions.
 */
export class World {
  empires = new Map<number, Empire>();
  kingdoms = new Map<number, Kingdom>();
  duchies = new Map<number, Duchy>();
  counties = new Map<number, County>();
  nodes = new Map<number, MapNode>();
  roads = new Map<number, Road>();
  points = new Map<number, BorderPoint>();
  edges = new Map<number, BorderEdge>();
  references = new Map<number, MapReference>();
  cultures: Culture[] = [];
  religions: Religion[] = [];

  /** Edge ids at each point, and edge ids naming each county. */
  edgesByPoint = new Map<number, Set<number>>();
  edgesByCounty = new Map<number, Set<number>>();

  rev: Revisions = { geometry: 0, counties: 0, tiers: 0, nodes: 0, roads: 0, references: 0 };
  version = 0;

  private listeners = new Set<() => void>();
  private polygonCache: { rev: number; polygons: Map<number, CountyPolygon[]> } | null = null;

  readonly point = (id: number) => this.points.get(id);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;

  private changed(...parts: (keyof Revisions)[]) {
    for (const part of parts) this.rev[part]++;
    this.version++;
    for (const listener of this.listeners) listener();
  }

  load(snapshot: WorldSnapshot, references: MapReference[]) {
    const fill = <T extends { id: number }>(map: Map<number, T>, rows: T[]) => {
      map.clear();
      for (const row of rows) map.set(row.id, row);
    };
    fill(this.empires, snapshot.empires);
    fill(this.kingdoms, snapshot.kingdoms);
    fill(this.duchies, snapshot.duchies);
    fill(this.counties, snapshot.counties);
    fill(this.nodes, snapshot.nodes);
    fill(this.roads, snapshot.roads);
    fill(this.points, snapshot.points);
    fill(this.references, references);
    this.edges.clear();
    this.edgesByPoint.clear();
    this.edgesByCounty.clear();
    for (const edge of snapshot.edges) this.putEdge(edge);
    this.cultures = snapshot.cultures;
    this.religions = snapshot.religions;
    this.changed("geometry", "counties", "tiers", "nodes", "roads", "references");
  }

  applyPatch(patch: MapPatch) {
    const parts = new Set<keyof Revisions>();
    for (const p of patch.points ?? []) {
      this.points.set(p.id, p);
      parts.add("geometry");
    }
    for (const e of patch.edges ?? []) {
      this.putEdge(e);
      parts.add("geometry");
    }
    for (const c of patch.counties ?? []) {
      this.counties.set(c.id, c);
      parts.add("counties");
    }
    for (const n of patch.nodes ?? []) {
      this.nodes.set(n.id, n);
      parts.add("nodes");
    }
    for (const r of patch.roads ?? []) {
      this.roads.set(r.id, r);
      parts.add("roads");
    }
    const d = patch.deleted ?? {};
    for (const id of d.edges ?? []) {
      this.dropEdge(id);
      parts.add("geometry");
    }
    for (const id of d.points ?? []) {
      this.points.delete(id);
      parts.add("geometry");
    }
    for (const id of d.counties ?? []) {
      this.counties.delete(id);
      for (const duchy of this.duchies.values()) {
        if (duchy.main_county_id === id) this.duchies.set(duchy.id, { ...duchy, main_county_id: null });
      }
      parts.add("counties").add("tiers");
    }
    for (const id of d.nodes ?? []) {
      this.removeNode(id);
      parts.add("nodes").add("roads").add("counties");
    }
    for (const id of d.roads ?? []) {
      this.roads.delete(id);
      parts.add("roads");
    }
    if (parts.size) this.changed(...parts);
  }

  /** A node is gone: its roads went with it, and it is nobody's main node any more. */
  removeNode(id: number) {
    this.nodes.delete(id);
    for (const road of [...this.roads.values()]) {
      if (road.node_a === id || road.node_b === id) this.roads.delete(road.id);
    }
    for (const county of this.counties.values()) {
      if (county.main_node_id === id) this.counties.set(county.id, { ...county, main_node_id: null });
    }
  }

  nodeDeleted(id: number) {
    this.removeNode(id);
    this.changed("nodes", "roads", "counties");
  }

  roadDeleted(id: number) {
    this.roads.delete(id);
    this.changed("roads");
  }

  /** Replaces a whole tier table (after edits whose side effects the database applied). */
  setTier(kind: TierKind, rows: (Empire | Kingdom | Duchy)[]) {
    const map = this[kind] as Map<number, Empire | Kingdom | Duchy>;
    map.clear();
    for (const row of rows) map.set(row.id, row);
    this.changed("tiers", "counties");
  }

  setReferences(rows: MapReference[]) {
    this.references.clear();
    for (const row of rows) this.references.set(row.id, row);
    this.changed("references");
  }

  private putEdge(edge: BorderEdge) {
    if (this.edges.has(edge.id)) this.dropEdge(edge.id);
    this.edges.set(edge.id, edge);
    const index = (map: Map<number, Set<number>>, key: number | null) => {
      if (key == null) return;
      let set = map.get(key);
      if (!set) map.set(key, (set = new Set()));
      set.add(edge.id);
    };
    index(this.edgesByPoint, edge.point_a);
    index(this.edgesByPoint, edge.point_b);
    index(this.edgesByCounty, edge.left_county_id);
    index(this.edgesByCounty, edge.right_county_id);
  }

  private dropEdge(id: number) {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.edges.delete(id);
    for (const key of [edge.point_a, edge.point_b]) this.edgesByPoint.get(key)?.delete(id);
    for (const key of [edge.left_county_id, edge.right_county_id]) if (key != null) this.edgesByCounty.get(key)?.delete(id);
  }

  /** Every county's outline, rebuilt when the geometry changes. */
  get polygons(): Map<number, CountyPolygon[]> {
    if (this.polygonCache?.rev !== this.rev.geometry) {
      this.polygonCache = { rev: this.rev.geometry, polygons: buildCountyPolygons(this.edges.values(), this.point) };
    }
    return this.polygonCache.polygons;
  }

  countyAt(lon: number, lat: number): number | null {
    return findCounty(lon, lat, this.polygons, this.point);
  }

  borderLevel(): (edge: BorderEdge) => BorderLevel {
    return borderLeveler({ counties: this.counties.values(), duchies: this.duchies.values(), kingdoms: this.kingdoms.values() });
  }

  kingdomOfCounty(county: County | undefined): number | null {
    const duchy = county?.duchy_id == null ? undefined : this.duchies.get(county.duchy_id);
    return duchy?.kingdom_id ?? null;
  }

  empireOfCounty(county: County | undefined): number | null {
    const kingdom = this.kingdomOfCounty(county);
    return kingdom == null ? null : (this.kingdoms.get(kingdom)?.empire_id ?? null);
  }

  /** Bounding box [west, south, east, north] of some points. */
  bounds(pointIds: Iterable<number>): [number, number, number, number] | null {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const id of pointIds) {
      const p = this.points.get(id);
      if (!p) continue;
      w = Math.min(w, p.lon);
      s = Math.min(s, p.lat);
      e = Math.max(e, p.lon);
      n = Math.max(n, p.lat);
    }
    return Number.isFinite(w) ? [w, s, e, n] : null;
  }

  countyBounds(id: number) {
    const ids = new Set<number>();
    for (const edgeId of this.edgesByCounty.get(id) ?? []) {
      const edge = this.edges.get(edgeId);
      if (edge) ids.add(edge.point_a).add(edge.point_b);
    }
    return this.bounds(ids);
  }
}
