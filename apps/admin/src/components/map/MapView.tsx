"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource, type ImageSource, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { MAIN_NODE_TYPES, isMainNodeType, type Biome, type NodeType } from "@1221/game-core";
import type { EditorActions, PointSpec } from "./api";
import {
  collection,
  countyFeatures,
  countyGeometries,
  edgeFeatures,
  edgeGeometry,
  labelFeatures,
  nodeFeatures,
  pointFeatures,
  roadFeatures,
  roadGeometry,
  type ColorBy,
} from "./geojson";
import { CoastIndex, borderPath, degreesPerPixel, findSnap, simplifyPath, type Snap } from "./snap";
import type { MapPatch, MapReference, World } from "./world";

export type Tool = "select" | "county" | "node" | "branch" | "road";
export type SelectionKind = "county" | "node" | "road" | "point" | "edge";
export type Selection = { kind: SelectionKind; id: number };
export type Box = [west: number, south: number, east: number, north: number];

export interface LayerToggles {
  land: boolean;
  coastline: boolean;
  rivers: boolean;
  lakes: boolean;
  references: boolean;
  counties: boolean;
  labels: boolean;
  nodes: boolean;
}

export interface MapController {
  fitBounds(box: Box): void;
  /** A box in the middle of the view with an image's proportions, for placing a reference. */
  boxForImage(width: number, height: number): Box;
}

interface Props {
  world: World;
  version: number;
  actions: EditorActions;
  tool: Tool;
  selection: Selection | null;
  colorBy: ColorBy;
  layers: LayerToggles;
  nodeDefaults: { type: NodeType; biome: Biome };
  /** While set, drawing adds a ring (an island, an extension) to this county. */
  ringTarget: number | null;
  editingReference: number | null;
  controller: RefObject<MapController | null>;
  onSelect(selection: Selection | null): void;
  onTool(tool: Tool): void;
  onDeleteSelection(): void;
  onDrawingDone(): void;
  onHint(text: string | null): void;
  /** Runs a save with the editor's busy state and error message; false when it failed. */
  run(label: string, task: () => Promise<unknown>): Promise<boolean>;
}

// Copied into public/ by scripts/maplibre-worker.mjs (bundlers don't emit MapLibre's worker).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const SEA = "#c9d8de";
const LAND = "#efe9dc";
const ACCENT = "#7a3b2e";
const GLYPHS = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const FONT = ["Noto Sans Regular"];
const NONE = ["==", ["id"], -1];

type Px = { x: number; y: number };
type LonLat = { lon: number; lat: number };
type Handle = "nw" | "ne" | "se" | "sw" | "c";
type Filter = NonNullable<Parameters<MapLibreMap["setFilter"]>[1]>;

type Drag =
  | { kind: "point"; id: number; start: Px; moved: boolean; snap: Snap | null; edges: number[]; counties: number[] }
  | { kind: "node"; id: number; start: Px; moved: boolean; at: LonLat; roads: number[] }
  | { kind: "reference"; id: number; handle: Handle; start: Px; moved: boolean; from: Box; box: Box; origin: LonLat };

interface DraftPoint {
  spec: PointSpec;
  lon: number;
  lat: number;
  coast?: { line: number; index: number };
}

const corners = ([w, s, e, n]: Box): [[number, number], [number, number], [number, number], [number, number]] => [
  [w, n],
  [e, n],
  [e, s],
  [w, s],
];

const referenceBox = (r: MapReference): Box => [r.west ?? 0, r.south ?? 0, r.east ?? 0, r.north ?? 0];

const pointFeature = (p: LonLat, properties: Record<string, unknown> = {}): Feature<Point> => ({
  type: "Feature",
  properties,
  geometry: { type: "Point", coordinates: [p.lon, p.lat] },
});

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const [ready, setReady] = useState(false);
  const [resync, setResync] = useState(0);
  const synced = useRef<Record<string, number | string>>({});
  const coastRef = useRef<CoastIndex | null>(null);
  const draft = useRef<DraftPoint[]>([]);
  const referenceIds = useRef(new Set<string>());
  const referenceUrls = useRef(new Map<string, string>());
  const referenceQueue = useRef(Promise.resolve());
  const clearDraft = useRef<(() => void) | null>(null);

  const { world } = props;

  // ---------------------------------------------------------------------------------------
  // The map, its layers and every pointer interaction. Created once; handlers read the
  // current props through `latest`.
  // ---------------------------------------------------------------------------------------
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const map = new MapLibreMap({
      container: el,
      style: {
        version: 8,
        glyphs: GLYPHS,
        sources: {},
        layers: [{ id: "sea", type: "background", paint: { "background-color": SEA } }],
      },
      // The Balkans are drawn and playtested first (GDD 3.2).
      center: [25, 42.5],
      zoom: 4.3,
      doubleClickZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      renderWorldCopies: false,
      attributionControl: { compact: true, customAttribution: "Natural Earth" },
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    latest.current.controller.current = {
      fitBounds: (box) => map.fitBounds(box, { padding: 80, maxZoom: 9, duration: 600 }),
      boxForImage: (width, height) => {
        const canvas = map.getCanvas();
        const scale = Math.min((canvas.clientWidth * 0.8) / width, (canvas.clientHeight * 0.8) / height);
        const x = (canvas.clientWidth - width * scale) / 2;
        const y = (canvas.clientHeight - height * scale) / 2;
        const nw = map.unproject([x, y]);
        const se = map.unproject([x + width * scale, y + height * scale]);
        return [Math.max(-180, nw.lng), Math.max(-85, se.lat), Math.min(180, se.lng), Math.min(85, nw.lat)];
      },
    };

    const source = (id: string) => map.getSource(id) as GeoJSONSource;
    const empty = collection([]);

    // -- Layers --------------------------------------------------------------------------
    map.on("load", async () => {
      map.addSource("land", { type: "geojson", data: "/natural-earth/land.json" });
      map.addSource("lakes", { type: "geojson", data: "/natural-earth/lakes.json" });
      map.addSource("rivers", { type: "geojson", data: "/natural-earth/rivers.json" });
      map.addSource("coastline", { type: "geojson", data: empty });
      for (const id of ["counties", "edges", "points", "labels", "nodes", "roads", "draft", "snap", "reference-handles"]) {
        map.addSource(id, { type: "geojson", data: empty });
      }

      map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": LAND } });
      map.addLayer({ id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": SEA } });
      // Reference images are inserted here, under the counties.
      map.addLayer({
        id: "county-fill",
        type: "fill",
        source: "counties",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.38 },
      });
      map.addLayer({
        id: "county-selected",
        type: "fill",
        source: "counties",
        filter: NONE as Filter,
        paint: { "fill-color": ACCENT, "fill-opacity": 0.16 },
      });
      map.addLayer({
        id: "rivers",
        type: "line",
        source: "rivers",
        paint: {
          "line-color": "#6f9bb8",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.4, 8, 1.4],
          "line-opacity": ["interpolate", ["linear"], ["coalesce", ["get", "scalerank"], 6], 0, 1, 10, 0.55],
        },
      });
      map.addLayer({ id: "coastline", type: "line", source: "coastline", paint: { "line-color": "#57768a", "line-width": 1 } });
      map.addLayer({
        id: "edges",
        type: "line",
        source: "edges",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["match", ["get", "level"], "empire", ACCENT, "kingdom", "#2b241c", "duchy", "#3d342a", "outer", "#3d342a", "#6b5f50"],
          "line-width": ["match", ["get", "level"], "empire", 3.6, "kingdom", 2.7, "duchy", 1.8, "outer", 1.4, 0.8],
          "line-opacity": ["match", ["get", "level"], "county", 0.75, 1],
        },
      });
      map.addLayer({
        id: "edges-selected",
        type: "line",
        source: "edges",
        filter: NONE as Filter,
        paint: { "line-color": ACCENT, "line-width": 3 },
      });
      map.addLayer({ id: "edges-hit", type: "line", source: "edges", paint: { "line-color": "#000", "line-width": 10, "line-opacity": 0 } });
      map.addLayer({ id: "roads", type: "line", source: "roads", paint: { "line-color": "#8a5a30", "line-width": 2, "line-dasharray": [3, 1.5] } });
      map.addLayer({ id: "roads-selected", type: "line", source: "roads", filter: NONE as Filter, paint: { "line-color": ACCENT, "line-width": 4 } });
      map.addLayer({ id: "roads-hit", type: "line", source: "roads", paint: { "line-color": "#000", "line-width": 10, "line-opacity": 0 } });
      const pointPaint = {
        "circle-radius": ["case", ["get", "junction"], 4, 3] as unknown as number,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#3d342a",
        "circle-stroke-width": 1.2,
      };
      map.addLayer({ id: "border-points", type: "circle", source: "points", minzoom: 6.5, paint: pointPaint });
      map.addLayer({ id: "border-points-county", type: "circle", source: "points", filter: NONE as Filter, paint: pointPaint });
      map.addLayer({
        id: "point-selected",
        type: "circle",
        source: "points",
        filter: NONE as Filter,
        paint: { "circle-radius": 6, "circle-color": ACCENT, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "nodes",
        type: "circle",
        source: "nodes",
        paint: {
          "circle-radius": ["case", ["get", "main"], 7, ["in", ["get", "type"], ["literal", [...MAIN_NODE_TYPES]]], 6, 4],
          "circle-color": [
            "match",
            ["get", "type"],
            "town",
            "#7a3b2e",
            "castle",
            "#3f3f46",
            "mine",
            "#8d6e63",
            "farm",
            "#7f8f24",
            "monastery",
            "#4f5fb3",
            "#8a8f94",
          ],
          // A main type that isn't its county's main node breaks the one-main-node rule: red ring.
          "circle-stroke-color": [
            "case",
            ["all", ["!", ["get", "main"]], ["in", ["get", "type"], ["literal", [...MAIN_NODE_TYPES]]]],
            "#b42318",
            "#ffffff",
          ],
          "circle-stroke-width": ["case", ["get", "main"], 2, 1.5],
        },
      });
      map.addLayer({
        id: "nodes-selected",
        type: "circle",
        source: "nodes",
        filter: NONE as Filter,
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ACCENT, "circle-stroke-width": 2.5 },
      });
      map.addLayer({
        id: "county-labels",
        type: "symbol",
        source: "labels",
        minzoom: 4.5,
        layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 12 },
        paint: { "text-color": "#2b241c", "text-halo-color": "#f4f2ee", "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "node-labels",
        type: "symbol",
        source: "nodes",
        minzoom: 6.5,
        layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top" },
        paint: { "text-color": "#1f1b16", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      });
      map.addLayer({
        id: "draft-line",
        type: "line",
        source: "draft",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ACCENT, "line-width": 2, "line-dasharray": [2, 1] },
      });
      map.addLayer({
        id: "draft-points",
        type: "circle",
        source: "draft",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["case", ["get", "first"], 6, 4],
          "circle-color": ["case", ["get", "first"], ACCENT, "#ffffff"],
          "circle-stroke-color": ACCENT,
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "snap",
        type: "circle",
        source: "snap",
        paint: {
          "circle-radius": 7,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["match", ["get", "kind"], "point", ACCENT, "edge", "#e8821e", "coast", "#2f7bd6", "#999"],
        },
      });
      map.addLayer({
        id: "reference-box",
        type: "line",
        source: "reference-handles",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": ACCENT, "line-width": 1.5, "line-dasharray": [3, 2] },
      });
      map.addLayer({
        id: "reference-handles",
        type: "circle",
        source: "reference-handles",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": ACCENT, "circle-stroke-width": 2 },
      });

      // The coastline stays in memory for snapping and tracing.
      try {
        const coast = (await (await fetch("/natural-earth/coastline.json")).json()) as FeatureCollection<LineString>;
        coastRef.current = new CoastIndex(coast);
        source("coastline").setData(coast);
      } catch {
        latest.current.onHint("Couldn't load the coastline: run npm run map:natural-earth");
      }
      setReady(true);
    });

    // -- Hit testing -----------------------------------------------------------------------
    const hitTest = (px: Px, layers: string[]) => {
      const present = layers.filter((l) => map.getLayer(l));
      const features = map.queryRenderedFeatures(
        [
          [px.x - 4, px.y - 4],
          [px.x + 4, px.y + 4],
        ],
        { layers: present },
      );
      for (const layer of present) {
        const f = features.find((x) => x.layer.id === layer && x.id != null);
        if (f) return { layer, id: Number(f.id), properties: f.properties };
      }
      return null;
    };

    const freeSnap = (e: MapMouseEvent): Snap => ({ kind: "free", lon: e.lngLat.lng, lat: e.lngLat.lat });
    const showSnap = (snap: Snap | null) =>
      source("snap")?.setData(collection(snap && snap.kind !== "free" ? [pointFeature(snap, { kind: snap.kind })] : []));

    // rAF-throttled drag and hover work.
    let frame: number | null = null;
    let pending: (() => void) | null = null;
    const schedule = (fn: () => void) => {
      pending = fn;
      if (frame == null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          const job = pending;
          pending = null;
          job?.();
        });
      }
    };

    // -- Drafting a county outline ----------------------------------------------------------
    const renderDraft = (cursor?: Snap) => {
      const pts = draft.current;
      const features: Feature[] = [];
      const coords = pts.map((d) => [d.lon, d.lat]);
      if (cursor && coords.length) coords.push([cursor.lon, cursor.lat]);
      if (coords.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
      pts.forEach((d, i) => features.push(pointFeature(d, { first: i === 0 })));
      source("draft")?.setData(collection(features));
    };

    const toDraft = (snap: Snap): DraftPoint => {
      switch (snap.kind) {
        case "point":
          return { spec: { id: snap.id }, lon: snap.lon, lat: snap.lat };
        case "edge":
          return { spec: { edge: snap.id, lon: snap.lon, lat: snap.lat }, lon: snap.lon, lat: snap.lat };
        case "coast":
          return { spec: { lon: snap.lon, lat: snap.lat }, lon: snap.lon, lat: snap.lat, coast: { line: snap.line, index: snap.index } };
        case "free":
          return { spec: { lon: snap.lon, lat: snap.lat }, lon: snap.lon, lat: snap.lat };
      }
    };

    /** Points between two clicks that follow an existing border or the coastline. */
    const trace = (prev: DraftPoint, next: DraftPoint): DraftPoint[] => {
      const w = latest.current.world;
      if ("id" in prev.spec && "id" in next.spec) {
        const path = borderPath(w, prev.spec.id, next.spec.id);
        if (!path || path.length < 2) return [];
        return path.slice(0, -1).map((id) => {
          const p = w.points.get(id)!;
          return { spec: { id }, lon: p.lon, lat: p.lat };
        });
      }
      const coast = coastRef.current;
      if (coast && prev.coast && next.coast && prev.coast.line === next.coast.line) {
        const inner = coast.between(prev.coast.line, prev.coast.index, next.coast.index);
        const path = simplifyPath([[prev.lon, prev.lat], ...inner, [next.lon, next.lat]], degreesPerPixel(map.getZoom()) * 1.5);
        return path.slice(1, -1).map(([lon, lat]) => ({ spec: { lon, lat }, lon, lat }));
      }
      return [];
    };

    const finishDraft = async () => {
      const pts = draft.current;
      if (pts.length < 3) return;
      const p = latest.current;
      draft.current = [];
      renderDraft();
      showSnap(null);
      let created: number | null = null;
      const ok = await p.run(p.ringTarget ? "Add to county" : "Draw county", async () => {
        const patch: MapPatch = await p.actions.createCounty(
          pts.map((d) => d.spec),
          p.ringTarget ?? undefined,
        );
        created = patch.counties?.[0]?.id ?? null;
        // Nodes placed before the county was drawn now belong to it.
        if (created != null) {
          const w = p.world;
          for (const node of [...w.nodes.values()]) {
            if (node.county_id == null && w.countyAt(node.lon, node.lat) === created) {
              await p.actions.updateNode({ ...node, county_id: created });
            }
          }
        }
      });
      if (ok) {
        if (created != null) p.onSelect({ kind: "county", id: created });
        p.onDrawingDone();
      } else {
        draft.current = pts;
        renderDraft();
      }
    };

    const addDraftPoint = (e: MapMouseEvent) => {
      const p = latest.current;
      const snap = e.originalEvent.altKey ? freeSnap(e) : findSnap(map, p.world, coastRef.current, e.point, {});
      const pts = draft.current;
      const first = pts[0];
      const closes =
        pts.length >= 3 &&
        first !== undefined &&
        ("id" in first.spec
          ? snap.kind === "point" && snap.id === first.spec.id
          : Math.hypot(map.project([first.lon, first.lat]).x - e.point.x, map.project([first.lon, first.lat]).y - e.point.y) <= 10);
      if (!closes && snap.kind === "point" && pts.some((d) => "id" in d.spec && d.spec.id === snap.id)) {
        p.onHint("That point is already in this outline.");
        return;
      }
      const target = closes ? first! : toDraft(snap);
      const prev = pts[pts.length - 1];
      if (prev && !e.originalEvent.shiftKey) pts.push(...trace(prev, target));
      if (closes) {
        void finishDraft();
        return;
      }
      pts.push(target);
      renderDraft(snap);
    };

    // -- Creating nodes and roads -----------------------------------------------------------
    const createNodeAt = async (lon: number, lat: number, fromNodeId?: number) => {
      const p = latest.current;
      const countyId = p.world.countyAt(lon, lat);
      const { type, biome } = p.nodeDefaults;
      if (isMainNodeType(type)) {
        const county = countyId == null ? undefined : p.world.counties.get(countyId);
        if (!county) return p.onHint(`A ${type} is a county's main node, so it must be inside a county.`);
        if (county.main_node_id != null) return p.onHint(`${county.name} already has its main node. Pick a travel node type.`);
      }
      let id: number | undefined;
      await p.run(fromNodeId ? "Branch node" : "Add node", async () => {
        const patch = await p.actions.createNode({ lon, lat, type, biome, countyId, fromNodeId });
        id = patch.nodes?.[0]?.id;
      });
      if (id != null) p.onSelect({ kind: "node", id });
    };

    const roadClick = async (px: Px) => {
      const p = latest.current;
      const hit = hitTest(px, ["nodes"]);
      if (!hit) return p.onHint("Click a node to start a road, then the node it leads to.");
      const from = p.selection?.kind === "node" ? p.selection.id : null;
      if (from != null && from !== hit.id) {
        const exists = [...p.world.roads.values()].some(
          (r) => (r.node_a === from && r.node_b === hit.id) || (r.node_b === from && r.node_a === hit.id),
        );
        if (exists) p.onHint("These nodes are already joined.");
        else await p.run("Add road", () => p.actions.createRoad(from, hit.id));
      }
      p.onSelect({ kind: "node", id: hit.id });
    };

    // -- Pointer events ---------------------------------------------------------------------
    let drag: Drag | null = null;
    let justDragged = false;

    map.on("mousedown", (e) => {
      if (e.originalEvent.button !== 0) return;
      const p = latest.current;
      const w = p.world;
      if (p.editingReference != null) {
        const hit = hitTest(e.point, ["reference-handles"]);
        const ref = w.references.get(p.editingReference);
        if (hit && ref) {
          e.preventDefault();
          const box = referenceBox(ref);
          drag = {
            kind: "reference",
            id: ref.id,
            handle: hit.properties.handle as Handle,
            start: e.point,
            moved: false,
            from: box,
            box,
            origin: { lon: e.lngLat.lng, lat: e.lngLat.lat },
          };
          return;
        }
      }
      if (p.tool !== "select") return;
      const hit = hitTest(e.point, ["nodes", "border-points-county", "border-points"]);
      if (!hit) return;
      e.preventDefault();
      if (hit.layer === "nodes") {
        const node = w.nodes.get(hit.id);
        if (!node) return;
        p.onSelect({ kind: "node", id: hit.id });
        const roads = [...w.roads.values()].filter((r) => r.node_a === hit.id || r.node_b === hit.id).map((r) => r.id);
        drag = { kind: "node", id: hit.id, start: e.point, moved: false, at: { lon: node.lon, lat: node.lat }, roads };
      } else {
        p.onSelect({ kind: "point", id: hit.id });
        const edges = [...(w.edgesByPoint.get(hit.id) ?? [])];
        const counties = new Set<number>();
        for (const id of edges) {
          const edge = w.edges.get(id);
          if (edge?.left_county_id != null) counties.add(edge.left_county_id);
          if (edge?.right_county_id != null) counties.add(edge.right_county_id);
        }
        drag = { kind: "point", id: hit.id, start: e.point, moved: false, snap: null, edges, counties: [...counties] };
      }
    });

    const dragTo = (d: Drag, e: MapMouseEvent) => {
      const w = latest.current.world;
      if (d.kind === "point") {
        // Snap onto another point (they glue on release) or the coastline. Alt: no snapping.
        const snap = e.originalEvent.altKey
          ? freeSnap(e)
          : findSnap(map, w, coastRef.current, e.point, { exclude: d.id, edges: false });
        d.snap = snap;
        const at = { lon: snap.lon, lat: snap.lat };
        const lookup = (id: number) => (id === d.id ? at : w.points.get(id));
        void source("points").updateData({ update: [{ id: d.id, newGeometry: pointFeature(at).geometry }] });
        void source("edges").updateData({
          update: d.edges.flatMap((id) => {
            const edge = w.edges.get(id);
            return edge ? [{ id, newGeometry: edgeGeometry(edge, lookup) }] : [];
          }),
        });
        void source("counties").updateData({
          update: countyGeometries(w, d.counties, lookup).map(({ id, geometry }) => ({ id, newGeometry: geometry })),
        });
        showSnap(snap);
      } else if (d.kind === "node") {
        d.at = { lon: e.lngLat.lng, lat: e.lngLat.lat };
        const at = d.at;
        void source("nodes").updateData({ update: [{ id: d.id, newGeometry: pointFeature(at).geometry }] });
        void source("roads").updateData({
          update: d.roads.flatMap((id) => {
            const road = w.roads.get(id);
            if (!road) return [];
            const end = (n: number) => (n === d.id ? at : w.nodes.get(n));
            return [{ id, newGeometry: roadGeometry(end(road.node_a), end(road.node_b)) }];
          }),
        });
      } else {
        const dLon = e.lngLat.lng - d.origin.lon;
        const dLat = e.lngLat.lat - d.origin.lat;
        let [west, south, east, north] = d.from;
        if (d.handle === "c") {
          west += dLon;
          east += dLon;
          south += dLat;
          north += dLat;
        } else {
          if (d.handle.includes("w")) west = Math.min(west + dLon, east - 0.01);
          if (d.handle.includes("e")) east = Math.max(east + dLon, west + 0.01);
          if (d.handle.includes("n")) north = Math.max(north + dLat, south + 0.01);
          if (d.handle.includes("s")) south = Math.min(south + dLat, north - 0.01);
        }
        d.box = [Math.max(-180, west), Math.max(-85, south), Math.min(180, east), Math.min(85, north)];
        (map.getSource(`ref-${d.id}`) as ImageSource | undefined)?.setCoordinates(corners(d.box));
        source("reference-handles").setData(referenceHandles(d.box));
      }
    };

    map.on("mousemove", (e) => {
      const d = drag;
      if (d) {
        if (!d.moved && Math.hypot(e.point.x - d.start.x, e.point.y - d.start.y) < 3) return;
        d.moved = true;
        map.getCanvas().style.cursor = "grabbing";
        schedule(() => dragTo(d, e));
        return;
      }
      const p = latest.current;
      if (p.tool === "county") {
        schedule(() => {
          const snap = e.originalEvent.altKey ? freeSnap(e) : findSnap(map, p.world, coastRef.current, e.point, {});
          showSnap(snap);
          renderDraft(snap);
        });
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      if (p.tool === "node" || p.tool === "branch") {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const layers =
        p.editingReference != null
          ? ["reference-handles"]
          : p.tool === "road"
            ? ["nodes"]
            : ["nodes", "border-points-county", "border-points", "roads-hit", "edges-hit", "county-fill"];
      const hit = hitTest(e.point, layers);
      map.getCanvas().style.cursor = !hit
        ? ""
        : ["nodes", "border-points", "border-points-county", "reference-handles"].includes(hit.layer)
          ? "move"
          : "pointer";
    });

    const endDrag = async () => {
      const d = drag;
      drag = null;
      if (!d) return;
      map.getCanvas().style.cursor = "";
      showSnap(null);
      if (!d.moved) return;
      justDragged = true;
      setTimeout(() => (justDragged = false), 0);
      const p = latest.current;
      let ok = true;
      if (d.kind === "point") {
        const snap = d.snap;
        if (!snap) return;
        if (snap.kind === "point") {
          ok = await p.run("Glue points", () => p.actions.mergePoints(d.id, snap.id));
          if (ok) p.onSelect({ kind: "point", id: snap.id });
        } else {
          ok = await p.run("Move point", () => p.actions.movePoint(d.id, snap.lon, snap.lat));
        }
      } else if (d.kind === "node") {
        const node = p.world.nodes.get(d.id);
        if (!node) return;
        const countyId = p.world.countyAt(d.at.lon, d.at.lat);
        ok = await p.run("Move node", () => p.actions.updateNode({ ...node, lon: d.at.lon, lat: d.at.lat, county_id: countyId }));
      } else {
        const [west, south, east, north] = d.box;
        ok = await p.run("Move reference", () => p.actions.updateReference(d.id, { west, south, east, north }));
      }
      // A failed save leaves the drawing where the database still is.
      if (!ok) setResync((n) => n + 1);
    };
    const onWindowMouseUp = () => void endDrag();
    window.addEventListener("mouseup", onWindowMouseUp);

    map.on("click", (e) => {
      if (justDragged) return;
      const p = latest.current;
      switch (p.tool) {
        case "select": {
          if (p.editingReference != null) return;
          const hit = hitTest(e.point, ["nodes", "border-points-county", "border-points", "roads-hit", "edges-hit", "county-fill"]);
          const kind: Record<string, SelectionKind> = {
            nodes: "node",
            "border-points": "point",
            "border-points-county": "point",
            "roads-hit": "road",
            "edges-hit": "edge",
            "county-fill": "county",
          };
          p.onSelect(hit ? { kind: kind[hit.layer]!, id: hit.id } : null);
          return;
        }
        case "county":
          return addDraftPoint(e);
        case "node":
          return void createNodeAt(e.lngLat.lng, e.lngLat.lat);
        case "branch":
          if (p.selection?.kind !== "node") return p.onHint("Select the node to branch from first.");
          return void createNodeAt(e.lngLat.lng, e.lngLat.lat, p.selection.id);
        case "road":
          return void roadClick(e.point);
      }
    });

    // Double-click a border to add a point on it.
    map.on("dblclick", async (e) => {
      const p = latest.current;
      if (p.tool !== "select" || p.editingReference != null) return;
      const hit = hitTest(e.point, ["edges-hit"]);
      const edge = hit && p.world.edges.get(hit.id);
      if (!edge) return;
      e.preventDefault();
      const snap = findSnap(map, p.world, null, e.point, { points: false, coast: false });
      const at = snap.kind === "edge" && snap.id === edge.id ? snap : { lon: e.lngLat.lng, lat: e.lngLat.lat };
      let id: number | undefined;
      await p.run("Add point", async () => {
        const patch = await p.actions.splitEdge(edge.id, at.lon, at.lat);
        id = patch.points?.[0]?.id;
      });
      if (id != null) p.onSelect({ kind: "point", id });
    });

    // -- Keyboard -----------------------------------------------------------------------------
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const p = latest.current;
      const drafting = draft.current.length > 0;
      if (e.key === "Escape") {
        if (drafting) {
          draft.current = [];
          renderDraft();
          showSnap(null);
        } else p.onSelect(null);
        return;
      }
      if (e.key === "Enter" && drafting) {
        e.preventDefault();
        void finishDraft();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (drafting) {
          draft.current.pop();
          renderDraft();
        } else p.onDeleteSelection();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tools: Record<string, Tool> = { v: "select", c: "county", n: "node", b: "branch", r: "road" };
      const tool = tools[e.key.toLowerCase()];
      if (tool) p.onTool(tool);
    };
    window.addEventListener("keydown", onKey);

    // Leaving the drawing tool drops an unfinished outline.
    clearDraft.current = () => {
      draft.current = [];
      renderDraft();
      showSnap(null);
    };

    return () => {
      window.removeEventListener("mouseup", onWindowMouseUp);
      window.removeEventListener("keydown", onKey);
      if (frame != null) cancelAnimationFrame(frame);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------------------
  // Keep the map's sources in step with the world.
  // ---------------------------------------------------------------------------------------
  const { version, colorBy, selection, layers, tool, editingReference, actions } = props;

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const set = (id: string, features: Feature[]) => void (map.getSource(id) as GeoJSONSource).setData(collection(features));
    const last = synced.current;
    const r = world.rev;
    const force = last.resync !== resync;
    const geometry = force || last.geometry !== r.geometry;
    const counties = force || last.counties !== r.counties;
    const tiers = force || last.tiers !== r.tiers;
    const nodes = force || last.nodes !== r.nodes;
    const roads = force || last.roads !== r.roads;
    if (geometry || counties || tiers || last.colorBy !== colorBy) set("counties", countyFeatures(world, colorBy));
    if (geometry || counties || tiers) set("edges", edgeFeatures(world));
    if (geometry) set("points", pointFeatures(world));
    if (geometry || counties) set("labels", labelFeatures(world));
    if (nodes || counties) set("nodes", nodeFeatures(world));
    if (roads || nodes) set("roads", roadFeatures(world));
    synced.current = { ...r, colorBy, resync };
  }, [ready, world, version, colorBy, resync]);

  // Reference images and tile layers, under the counties, in their saved order.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    referenceQueue.current = referenceQueue.current.then(async () => {
      const refs = [...world.references.values()].sort((a, b) => a.sort - b.sort || a.id - b.id);
      const wanted = new Set(refs.map((r) => `ref-${r.id}`));
      for (const id of referenceIds.current) {
        if (wanted.has(id)) continue;
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      for (const ref of refs) {
        const id = `ref-${ref.id}`;
        if (!map.getSource(id)) {
          if (ref.kind === "tiles" && ref.tile_url) {
            map.addSource(id, { type: "raster", tiles: [ref.tile_url], tileSize: 256 });
          } else if (ref.storage_path) {
            let url = referenceUrls.current.get(ref.storage_path);
            if (!url) {
              try {
                url = await actions.referenceUrl(ref.storage_path);
              } catch {
                continue;
              }
              referenceUrls.current.set(ref.storage_path, url);
            }
            if (map.getSource(id)) continue;
            map.addSource(id, { type: "image", url, coordinates: corners(referenceBox(ref)) });
          } else continue;
          map.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } }, "county-fill");
        } else if (ref.kind === "image") {
          (map.getSource(id) as ImageSource).setCoordinates(corners(referenceBox(ref)));
        }
        map.setPaintProperty(id, "raster-opacity", ref.opacity);
        map.setLayoutProperty(id, "visibility", ref.visible && layers.references ? "visible" : "none");
      }
      for (const ref of refs) if (map.getLayer(`ref-${ref.id}`)) map.moveLayer(`ref-${ref.id}`, "county-fill");
      referenceIds.current = wanted;
    });
  }, [ready, world, version, layers.references, actions]);

  // Handles for moving and resizing the reference image being edited.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ref = editingReference == null ? undefined : world.references.get(editingReference);
    const data = ref?.kind === "image" ? referenceHandles(referenceBox(ref)) : collection([]);
    (map.getSource("reference-handles") as GeoJSONSource).setData(data);
  }, [ready, world, version, editingReference]);

  // What's selected stands out; the selected county shows its points at any zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const is = (kind: SelectionKind) => (selection?.kind === kind ? (["==", ["id"], selection.id] as Filter) : (NONE as Filter));
    map.setFilter("county-selected", is("county"));
    map.setFilter("nodes-selected", is("node"));
    map.setFilter("roads-selected", is("road"));
    map.setFilter("point-selected", is("point"));
    map.setFilter(
      "edges-selected",
      selection?.kind === "county"
        ? (["any", ["==", ["get", "l"], selection.id], ["==", ["get", "r"], selection.id]] as Filter)
        : is("edge"),
    );
    const ids = new Set<number>();
    if (selection?.kind === "county") {
      for (const edgeId of world.edgesByCounty.get(selection.id) ?? []) {
        const edge = world.edges.get(edgeId);
        if (edge) ids.add(edge.point_a).add(edge.point_b);
      }
    }
    map.setFilter("border-points-county", ["in", ["id"], ["literal", [...ids]]] as Filter);
  }, [ready, world, version, selection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const show = (ids: string[], on: boolean) => {
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    show(["land"], layers.land);
    show(["coastline"], layers.coastline);
    show(["rivers"], layers.rivers);
    show(["lakes"], layers.lakes);
    show(["county-fill", "county-selected"], layers.counties);
    show(["county-labels", "node-labels"], layers.labels);
    show(["nodes", "nodes-selected", "roads", "roads-selected", "roads-hit"], layers.nodes);
  }, [ready, layers]);

  useEffect(() => {
    if (tool !== "county") clearDraft.current?.();
  }, [tool]);

  // MapLibre's CSS makes its container position: relative, so it sits inside the absolute box.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}

function referenceHandles(box: Box): FeatureCollection {
  const [w, s, e, n] = box;
  const at = (lon: number, lat: number, handle: Handle, id: number): Feature<Point> => ({
    type: "Feature",
    id,
    properties: { handle },
    geometry: { type: "Point", coordinates: [lon, lat] },
  });
  return collection<Point | LineString>([
    {
      type: "Feature",
      id: 0,
      properties: {},
      geometry: { type: "LineString", coordinates: [...corners(box), corners(box)[0]] },
    },
    at(w, n, "nw", 1),
    at(e, n, "ne", 2),
    at(e, s, "se", 3),
    at(w, s, "sw", 4),
    at((w + e) / 2, (s + n) / 2, "c", 5),
  ]);
}
