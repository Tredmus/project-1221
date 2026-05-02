"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { pointer, select } from "d3-selection";
import type { GeoProjection } from "d3-geo";
import {
  buildMapModel,
  legacyPolygonRingToPathD,
  projectLegacyXY,
  projectNode,
  projectedXYToLegacy,
  type CountyMapInput,
} from "@/lib/map/buildMapModel";
import {
  beginMapEditorReferenceUploadAction,
  completeMapEditorReferenceUploadAction,
  createConnectedNodeAction,
  createCountyAction,
  deleteCountyAction,
  deleteMapNodeAction,
  removeMapEditorReferenceAction,
  updateMapEditorReferenceTransformAction,
  updateCountyPolygonAction,
  updateMapNodeAction,
  updateMapNodePositionAction,
} from "@/app/admin/map-editor/actions";
import type {
  MapEditorCountyRow,
  MapEditorRegionRow,
} from "@/app/admin/map-editor/page";
import type { MapEditorReferenceServerProps } from "@/app/admin/map-editor/types";
import {
  NODE_TYPES,
  type MapConnectionView,
  type MapNodeView,
  type NodeType,
} from "@/lib/types/game.types";

const VIEW_W = 1000;
const VIEW_H = 620;

/** d3-zoom: min / max scale (wheel + pinch). High max for large reference rasters. */
const D3_ZOOM_SCALE_EXTENT: [number, number] = [0.04, 512];

const REF_SCALE_MIN = 0.08;
const REF_SCALE_MAX = 128;

/**
 * Signed upload URLs are minted with the service role; uploading via the
 * Supabase browser client would also send the logged-in user's JWT, which can
 * make Storage reject the request. Use fetch + anon key only.
 */
async function uploadReferenceFileViaSignedUrl(
  signedUrl: string,
  file: File,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    return { ok: false, message: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY." };
  }
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);

  const res = await fetch(signedUrl, {
    method: "PUT",
    body: form,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "x-upsert": "true",
    },
  });

  if (!res.ok) {
    let message = `Upload failed (${res.status}).`;
    try {
      const j = (await res.json()) as {
        message?: string;
        error?: string;
      };
      if (typeof j.message === "string") message = j.message;
      else if (typeof j.error === "string") message = j.error;
    } catch {
      /* ignore */
    }
    return { ok: false, message };
  }
  return { ok: true };
}

const ROAD_STROKE: Record<MapConnectionView["road_type"], string> = {
  road: "rgba(201, 164, 76, 0.35)",
  river: "rgba(74, 107, 90, 0.45)",
  sea: "rgba(74, 107, 90, 0.28)",
};

const NODE_FILL: Record<MapNodeView["type"], string> = {
  city: "rgb(var(--color-gold))",
  fortress: "rgb(var(--color-blood))",
  port: "rgb(var(--color-verdigris))",
  settlement: "rgb(var(--color-parchment-dark))",
  farm: "rgb(var(--color-parchment-deep))",
  mine: "rgb(var(--color-ash))",
  road: "rgb(var(--color-gold-dim))",
};

const NODE_RADIUS: Record<MapNodeView["type"], number> = {
  city: 10,
  fortress: 8,
  port: 7,
  settlement: 6,
  farm: 4,
  mine: 4,
  road: 3,
};

const PROVINCE_STROKES = [
  "rgba(201, 164, 76, 0.42)",
  "rgba(100, 180, 140, 0.45)",
  "rgba(233, 200, 122, 0.4)",
  "rgba(140, 160, 200, 0.42)",
];

const CLOSE_EPS = 0.25;

/** Node types that have a `locations` row (owner applies). */
const LOCATION_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  "settlement",
  "farm",
  "mine",
  "port",
  "fortress",
]);

type EditorMode = "counties" | "nodes";

/** Strip a duplicated closing vertex so editing uses one index per corner. */
function normalizeOpenRing(ring: [number, number][]): [number, number][] {
  if (ring.length <= 2) {
    return ring.map((p) => [p[0], p[1]] as [number, number]);
  }
  const f = ring[0]!;
  const l = ring[ring.length - 1]!;
  if (
    Math.abs(f[0] - l[0]) < CLOSE_EPS &&
    Math.abs(f[1] - l[1]) < CLOSE_EPS
  ) {
    return ring
      .slice(0, -1)
      .map((p) => [p[0], p[1]] as [number, number]);
  }
  return ring.map((p) => [p[0], p[1]] as [number, number]);
}

function ensureClosedRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (
    Math.abs(first[0] - last[0]) < CLOSE_EPS &&
    Math.abs(first[1] - last[1]) < CLOSE_EPS
  ) {
    return ring.map((p) => [p[0], p[1]] as [number, number]);
  }
  return [...ring.map((p) => [p[0], p[1]] as [number, number]), [first[0], first[1]]];
}

/** Edges of a closed ring (open vertex list, no duplicate closing point). */
function listClosedRingEdges(
  open: [number, number][],
): Array<{ a: number; b: number }> {
  const n = open.length;
  if (n < 2) return [];
  const edges: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push({ a: i, b: i + 1 });
  }
  if (n >= 3) {
    edges.push({ a: n - 1, b: 0 });
  }
  return edges;
}

/** Open polyline edges only (no closing edge). */
function listOpenChainEdges(
  open: [number, number][],
): Array<{ a: number; b: number }> {
  const n = open.length;
  if (n < 2) return [];
  const edges: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push({ a: i, b: i + 1 });
  }
  return edges;
}

function splitEdgeAtMidpoint(
  open: [number, number][],
  startIdx: number,
  endIdx: number,
): [number, number][] {
  const n = open.length;
  const a = open[startIdx]!;
  const b = open[endIdx]!;
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (startIdx === n - 1 && endIdx === 0) {
    return [...open, mid];
  }
  if (endIdx !== startIdx + 1) {
    return open;
  }
  const insertAt = startIdx + 1;
  return [...open.slice(0, insertAt), mid, ...open.slice(insertAt)];
}

function openPathFromLegacy(
  projection: GeoProjection,
  ring: [number, number][],
): string {
  if (ring.length === 0) return "";
  const pts = ring.map(([x, y]) => projectLegacyXY(projection, x, y));
  return "M" + pts.map((p) => `${p[0]},${p[1]}`).join("L");
}

const BORROW_VERTEX_HIT_PX = 22;

/** Nearest existing county vertex to a screen-space click (for compose mode). */
function nearestCountyVertexFromScreen(
  px: number,
  py: number,
  projection: GeoProjection,
  countyRows: MapEditorCountyRow[],
  maxDistPx: number,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestSq = maxDistPx * maxDistPx;
  for (const p of countyRows) {
    if (!p.map_polygon || p.map_polygon.length < 3) continue;
    const open = normalizeOpenRing(
      p.map_polygon.map(([a, b]) => [a, b] as [number, number]),
    );
    for (const pt of open) {
      const [vx, vy] = projectLegacyXY(projection, pt[0], pt[1]);
      const dx = vx - px;
      const dy = vy - py;
      const sq = dx * dx + dy * dy;
      if (sq < bestSq) {
        bestSq = sq;
        best = [pt[0], pt[1]];
      }
    }
  }
  return best;
}

interface Props {
  nodes: MapNodeView[];
  connections: MapConnectionView[];
  counties: MapEditorCountyRow[];
  regions: MapEditorRegionRow[];
  reference: MapEditorReferenceServerProps;
}

export default function CountyMapEditor({
  nodes,
  connections,
  counties,
  regions,
  reference,
}: Props) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomLayerRef = useRef<SVGGElement | null>(null);
  const zoomBehav = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const suppressClickUntilRef = useRef(0);
  const projRef = useRef(buildMapModel(VIEW_W, VIEW_H, [], []).projection);

  const [selectedId, setSelectedId] = useState<number | null>(
    () => counties[0]?.id ?? null,
  );
  const [workingRing, setWorkingRing] = useState<[number, number][]>([]);
  /** Pick vertices from existing counties, then create a new county with that ring. */
  const [composeBorderMode, setComposeBorderMode] = useState(false);
  const [composedPickRing, setComposedPickRing] = useState<[number, number][]>(
    [],
  );
  const [composeRestoreSelectedId, setComposeRestoreSelectedId] = useState<
    number | null
  >(null);
  const [refImage, setRefImage] = useState<string | null>(reference.signedUrl);
  const [refOpacity, setRefOpacity] = useState(() =>
    Math.min(0.95, Math.max(0.05, reference.opacity)),
  );
  const [refPan, setRefPan] = useState({
    x: reference.panX,
    y: reference.panY,
  });
  const [refScale, setRefScale] = useState(() =>
    Math.min(REF_SCALE_MAX, Math.max(REF_SCALE_MIN, reference.scale)),
  );
  const [refAdjustMode, setRefAdjustMode] = useState(false);
  const [refDragging, setRefDragging] = useState(false);
  const refDragRef = useRef<{
    mx: number;
    my: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [newCountyName, setNewCountyName] = useState("");
  const [newRegionId, setNewRegionId] = useState<number | null>(
    () => regions[0]?.id ?? null,
  );
  const [dragVertexIndex, setDragVertexIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refPersistNotice, setRefPersistNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRefPending, startRefTransition] = useTransition();

  const [editorMode, setEditorMode] = useState<EditorMode>("counties");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [nodeName, setNodeName] = useState("");
  const [nodeType, setNodeType] = useState<NodeType>("road");
  const [nodeCountyId, setNodeCountyId] = useState<number | null>(null);
  const [nodeMapX, setNodeMapX] = useState(0);
  const [nodeMapY, setNodeMapY] = useState(0);
  const [nodeOwnerId, setNodeOwnerId] = useState("");
  const [nodeOwnerType, setNodeOwnerType] = useState<
    "character" | "clan" | ""
  >("");
  const [nodePanelError, setNodePanelError] = useState<string | null>(null);
  const [nodePanelStatus, setNodePanelStatus] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [deleteNodeConfirm, setDeleteNodeConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [deleteCountyConfirm, setDeleteCountyConfirm] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [nodeDragAdjustMode, setNodeDragAdjustMode] = useState(false);
  const [nodeDragActiveId, setNodeDragActiveId] = useState<number | null>(null);
  const nodeDragLastLegRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    setRefImage(reference.signedUrl);
    setRefPan({ x: reference.panX, y: reference.panY });
    setRefScale(
      Math.min(REF_SCALE_MAX, Math.max(REF_SCALE_MIN, reference.scale)),
    );
    setRefOpacity(
      Math.min(0.95, Math.max(0.05, reference.opacity)),
    );
  }, [
    reference.signedUrl,
    reference.panX,
    reference.panY,
    reference.scale,
    reference.opacity,
  ]);

  useEffect(() => {
    if (!refPersistNotice) return;
    const t = window.setTimeout(() => setRefPersistNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [refPersistNotice]);

  const countyInputs: CountyMapInput[] = useMemo(
    () =>
      counties
        .filter(
          (p) =>
            p.map_x != null &&
            p.map_y != null &&
            Number.isFinite(p.map_x) &&
            Number.isFinite(p.map_y),
        )
        .map((p) => ({
          id: p.id,
          map_x: p.map_x!,
          map_y: p.map_y!,
          map_polygon: p.map_polygon,
        })),
    [counties],
  );

  const displayNodes = useMemo(() => {
    if (selectedNodeId === null) return nodes;
    return nodes.map((n) =>
      n.id === selectedNodeId
        ? { ...n, map_x: nodeMapX, map_y: nodeMapY }
        : n,
    );
  }, [nodes, selectedNodeId, nodeMapX, nodeMapY]);

  const mapModel = useMemo(
    () => buildMapModel(VIEW_W, VIEW_H, displayNodes, countyInputs),
    [displayNodes, countyInputs],
  );

  projRef.current = mapModel.projection;

  const nodesById = useMemo(
    () => new Map(displayNodes.map((n) => [n.id, n] as const)),
    [displayNodes],
  );

  const countyColor = useCallback(
    (id: number) => {
      const idx = counties.findIndex((p) => p.id === id);
      return PROVINCE_STROKES[Math.max(0, idx) % PROVINCE_STROKES.length]!;
    },
    [counties],
  );

  const referenceTransform = useMemo(
    () =>
      `translate(${refPan.x} ${refPan.y}) translate(${VIEW_W / 2} ${VIEW_H / 2}) scale(${refScale}) translate(${-VIEW_W / 2} ${-VIEW_H / 2})`,
    [refPan.x, refPan.y, refScale],
  );

  const openWorkingRing = useMemo(
    () => normalizeOpenRing(workingRing),
    [workingRing],
  );

  const edgeSplitTargets = useMemo(() => {
    const open = openWorkingRing;
    if (open.length < 2) return [];
    if (open.length >= 3) {
      return listClosedRingEdges(open);
    }
    return listOpenChainEdges(open);
  }, [openWorkingRing]);

  useEffect(() => {
    if (selectedId === null) {
      setWorkingRing([]);
      return;
    }
    const p = counties.find((x) => x.id === selectedId);
    const poly = p?.map_polygon;
    setWorkingRing(
      poly
        ? normalizeOpenRing(
            poly.map(([a, b]) => [a, b] as [number, number]),
          )
        : [],
    );
  }, [selectedId, counties]);

  useEffect(() => {
    if (selectedNodeId === null) {
      setNodeName("");
      setNodeType("road");
      setNodeCountyId(null);
      setNodeMapX(0);
      setNodeMapY(0);
      setNodeOwnerId("");
      setNodeOwnerType("");
      return;
    }
    const n = nodes.find((x) => x.id === selectedNodeId);
    if (!n) {
      setSelectedNodeId(null);
      return;
    }
    setNodeName(n.name ?? "");
    setNodeType(n.type);
    setNodeCountyId(n.county_id);
    setNodeMapX(n.map_x);
    setNodeMapY(n.map_y);
    setNodeOwnerId(n.owner_id ? String(n.owner_id) : "");
    setNodeOwnerType(
      n.owner_type === "character" || n.owner_type === "clan"
        ? n.owner_type
        : "",
    );
    setNodePanelError(null);
    setNodePanelStatus(null);
  }, [selectedNodeId, nodes]);

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-map-editor-ctx]")) return;
      setContextMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [contextMenu]);

  useEffect(() => {
    const svgEl = svgRef.current;
    const layerEl = zoomLayerRef.current;
    if (!svgEl || !layerEl) return;

    const svg = select(svgEl);
    const layer = select(layerEl);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent(D3_ZOOM_SCALE_EXTENT)
      .on("zoom", (event) => {
        layer.attr("transform", event.transform.toString());
      });
    zoomBehav.current = z;
    svg.call(z);
    svg.on("dblclick.zoom", null);

    return () => {
      svg.on(".zoom", null);
      zoomBehav.current = null;
    };
  }, [displayNodes, countyInputs]);

  useEffect(() => {
    if (nodeDragActiveId === null) return;

    const onMove = (ev: PointerEvent) => {
      const layer = zoomLayerRef.current;
      if (!layer) return;
      const [px, py] = pointer(ev, layer);
      const leg = projectedXYToLegacy(projRef.current, px, py);
      if (!leg) return;
      nodeDragLastLegRef.current = [leg[0], leg[1]];
      setNodeMapX(leg[0]);
      setNodeMapY(leg[1]);
    };

    const onUp = () => {
      const id = nodeDragActiveId;
      const last = nodeDragLastLegRef.current;
      nodeDragLastLegRef.current = null;
      setNodeDragActiveId(null);
      suppressClickUntilRef.current = Date.now() + 450;

      if (id == null || last == null) return;
      startTransition(async () => {
        const res = await updateMapNodePositionAction(id, last[0], last[1]);
        if (!res.ok) {
          setNodePanelError(res.error ?? "Could not save position.");
          return;
        }
        setNodePanelStatus("Position written to the ledger.");
        router.refresh();
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [nodeDragActiveId, router]);

  const clientToLegacy = useCallback(
    (ev: React.MouseEvent | React.PointerEvent): [number, number] | null => {
      const layer = zoomLayerRef.current;
      if (!layer) return null;
      const [px, py] = pointer(ev.nativeEvent, layer);
      return projectedXYToLegacy(mapModel.projection, px, py);
    },
    [mapModel.projection],
  );

  const saveRing = useCallback(
    (ring: [number, number][]) => {
      if (selectedId === null) return;
      setError(null);
      setStatus(null);
      const closed = ensureClosedRing(ring);
      if (closed.length < 3) {
        setError("A county outline needs at least three vertices.");
        return;
      }
      startTransition(async () => {
        const res = await updateCountyPolygonAction(selectedId, closed);
        if (!res.ok) {
          setError(res.error ?? "Save failed.");
          return;
        }
        setStatus("Written to the ledger.");
        router.refresh();
      });
    },
    [selectedId, router],
  );

  const finalizeDoubleClick = useCallback(() => {
    if (selectedId === null) return;
    if (openWorkingRing.length < 3) {
      setError("Place at least three vertices before closing the ring.");
      return;
    }
    saveRing(openWorkingRing);
  }, [selectedId, openWorkingRing, saveRing]);

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (refAdjustMode) return;
    if (e.button !== 0) return;
    if ((e.target as Element).closest(".vertex-handle")) return;
    if ((e.target as Element).closest(".edge-split-handle")) return;
    if ((e.target as Element).closest(".borrow-vtx")) return;

    if (editorMode === "nodes") {
      if ((e.target as Element).closest(".map-node-root")) return;
      setSelectedNodeId(null);
      return;
    }

    if (composeBorderMode) {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (Date.now() < suppressClickUntilRef.current) return;
        const layer = zoomLayerRef.current;
        if (!layer) return;
        const [px, py] = pointer(e.nativeEvent, layer);
        const hit = nearestCountyVertexFromScreen(
          px,
          py,
          mapModel.projection,
          counties,
          BORROW_VERTEX_HIT_PX,
        );
        if (hit) {
          setComposedPickRing((r) => [...r, hit]);
          setError(null);
        } else {
          setError(
            "Click a mint-green corner, or near one, to add it to the new outline.",
          );
        }
      }, 300);
      return;
    }

    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      if (Date.now() < suppressClickUntilRef.current) return;
      if (selectedId === null) return;
      const leg = clientToLegacy(e);
      if (!leg) return;
      setWorkingRing((r) => [...normalizeOpenRing(r), leg]);
      setError(null);
    }, 300);
  };

  const onSvgDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (refAdjustMode) return;
    if (editorMode === "nodes") {
      e.preventDefault();
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      return;
    }
    if (composeBorderMode) return;
    e.preventDefault();
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    finalizeDoubleClick();
  };

  useEffect(() => {
    if (dragVertexIndex === null) return;

    const onMove = (ev: PointerEvent) => {
      const layer = zoomLayerRef.current;
      if (!layer) return;
      const [px, py] = pointer(ev, layer);
      const leg = projectedXYToLegacy(projRef.current, px, py);
      if (!leg) return;
      setWorkingRing((prev) => {
        const next = [...prev];
        const i = dragVertexIndex;
        if (i === null || i < 0 || i >= next.length) return prev;
        next[i] = leg;
        return next;
      });
    };

    const onUp = () => {
      suppressClickUntilRef.current = Date.now() + 450;
      setDragVertexIndex(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragVertexIndex]);

  useEffect(() => {
    if (!refDragging) return;

    const onMove = (ev: PointerEvent) => {
      const layer = zoomLayerRef.current;
      const start = refDragRef.current;
      if (!layer || !start) return;
      const [x, y] = pointer(ev, layer);
      setRefPan({
        x: start.panX + x - start.mx,
        y: start.panY + y - start.my,
      });
    };

    const onUp = () => {
      refDragRef.current = null;
      setRefDragging(false);
      suppressClickUntilRef.current = Date.now() + 400;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [refDragging]);

  const onRefPointerDown = (e: React.PointerEvent) => {
    if (!refAdjustMode || !refImage) return;
    e.stopPropagation();
    e.preventDefault();
    const layer = zoomLayerRef.current;
    if (!layer) return;
    const [mx, my] = pointer(e.nativeEvent, layer);
    refDragRef.current = { mx, my, panX: refPan.x, panY: refPan.y };
    setRefDragging(true);
  };

  const resetView = () => {
    const svgEl = svgRef.current;
    if (!svgEl || !zoomBehav.current) return;
    select(svgEl).transition().duration(220).call(zoomBehav.current.transform, zoomIdentity);
  };

  const undoVertex = () => {
    setWorkingRing((r) => normalizeOpenRing(r).slice(0, -1));
    setError(null);
  };

  const clearRing = () => {
    setWorkingRing([]);
    setError(null);
    setStatus(null);
  };

  const resetReferenceAlignment = () => {
    setRefPan({ x: 0, y: 0 });
    setRefScale(1);
  };

  const saveReferenceAlignmentToServer = () => {
    if (!refImage) {
      setRefPersistNotice("Upload a reference chart before saving alignment.");
      return;
    }
    startRefTransition(async () => {
      const res = await updateMapEditorReferenceTransformAction(
        refPan.x,
        refPan.y,
        refScale,
        refOpacity,
      );
      if (!res.ok) {
        setRefPersistNotice(res.error ?? "Could not save alignment.");
        return;
      }
      setRefPersistNotice("Alignment written to the archive.");
      router.refresh();
    });
  };

  const removeReferenceFromServer = () => {
    startRefTransition(async () => {
      const res = await removeMapEditorReferenceAction();
      if (!res.ok) {
        setRefPersistNotice(res.error ?? "Could not remove chart.");
        return;
      }
      setRefAdjustMode(false);
      setRefPersistNotice("Reference removed from the archive.");
      router.refresh();
    });
  };

  const createCounty = () => {
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const res = await createCountyAction(newCountyName, newRegionId);
      if (!res.ok) {
        setError(res.error ?? "Could not create county.");
        return;
      }
      setNewCountyName("");
      setStatus("County created. Draw its border when ready.");
      if (res.id !== null) {
        setSelectedId(res.id);
      }
      router.refresh();
    });
  };

  const hasBorrowSources = useMemo(
    () => counties.some((p) => p.map_polygon && p.map_polygon.length >= 3),
    [counties],
  );

  const enterComposeBorderMode = () => {
    if (refAdjustMode) {
      setError("Turn off “Adjust reference” before borrowing corners.");
      return;
    }
    if (!hasBorrowSources) {
      setError(
        "At least one other county needs a drawn border to borrow corners from.",
      );
      return;
    }
    setError(null);
    setStatus(null);
    setComposeRestoreSelectedId(selectedId);
    setSelectedId(null);
    setComposeBorderMode(true);
    setComposedPickRing([]);
  };

  const cancelComposeBorderMode = () => {
    setComposeBorderMode(false);
    setComposedPickRing([]);
    setSelectedId(composeRestoreSelectedId);
    setComposeRestoreSelectedId(null);
    setError(null);
  };

  const undoComposedPick = () => {
    setComposedPickRing((r) => r.slice(0, -1));
    setError(null);
  };

  const finishComposeAndCreateCounty = () => {
    const name = newCountyName.trim();
    if (!name) {
      setError("Name the county before finishing.");
      return;
    }
    if (composedPickRing.length < 3) {
      setError("Choose at least three corners along existing borders.");
      return;
    }
    setError(null);
    setStatus(null);
    startTransition(async () => {
      const createRes = await createCountyAction(name, newRegionId);
      if (!createRes.ok || createRes.id === null) {
        setError(createRes.error ?? "Could not create county.");
        return;
      }
      const closed = ensureClosedRing(composedPickRing);
      const polyRes = await updateCountyPolygonAction(createRes.id, closed);
      if (!polyRes.ok) {
        setError(polyRes.error ?? "Polygon could not be saved.");
        setComposeBorderMode(false);
        setComposedPickRing([]);
        setSelectedId(createRes.id);
        setComposeRestoreSelectedId(null);
        setNewCountyName("");
        router.refresh();
        return;
      }
      setNewCountyName("");
      setComposeBorderMode(false);
      setComposedPickRing([]);
      setComposeRestoreSelectedId(null);
      setSelectedId(createRes.id);
      setStatus(
        "County forged from neighbours; refine vertices or save again.",
      );
      router.refresh();
    });
  };

  const changeEditorMode = (mode: EditorMode) => {
    setContextMenu(null);
    setNodeDragAdjustMode(false);
    setNodeDragActiveId(null);
    if (mode === "nodes" && composeBorderMode) {
      setComposeBorderMode(false);
      setComposedPickRing([]);
      setSelectedId(composeRestoreSelectedId);
      setComposeRestoreSelectedId(null);
    }
    setSelectedNodeId(null);
    setEditorMode(mode);
  };

  const saveNode = () => {
    if (selectedNodeId === null) return;
    setNodePanelError(null);
    setNodePanelStatus(null);
    startTransition(async () => {
      const res = await updateMapNodeAction(selectedNodeId, {
        name: nodeName,
        type: nodeType,
        countyId: nodeCountyId,
        mapX: nodeMapX,
        mapY: nodeMapY,
        locationOwnerId: nodeOwnerId.trim() || null,
        locationOwnerType: nodeOwnerType === "" ? null : nodeOwnerType,
      });
      if (!res.ok) {
        setNodePanelError(res.error ?? "Save failed.");
        return;
      }
      setNodePanelStatus("Written to the ledger.");
      router.refresh();
    });
  };

  const addConnectedFromContext = (fromId: number) => {
    setContextMenu(null);
    setNodePanelError(null);
    setNodePanelStatus(null);
    startTransition(async () => {
      const res = await createConnectedNodeAction(fromId);
      if (!res.ok || res.id == null) {
        setNodePanelError(res.error ?? "Could not add node.");
        return;
      }
      setSelectedNodeId(res.id);
      setNodePanelStatus("New node placed. Name it and set its type.");
      router.refresh();
    });
  };

  const runDeleteNode = () => {
    if (!deleteNodeConfirm) return;
    const { id } = deleteNodeConfirm;
    setNodePanelError(null);
    startTransition(async () => {
      const res = await deleteMapNodeAction(id);
      if (!res.ok) {
        setNodePanelError(res.error ?? "Delete failed.");
        setDeleteNodeConfirm(null);
        return;
      }
      setDeleteNodeConfirm(null);
      setSelectedNodeId((cur) => (cur === id ? null : cur));
      router.refresh();
    });
  };

  const runDeleteCounty = () => {
    if (!deleteCountyConfirm) return;
    const { id } = deleteCountyConfirm;
    setError(null);
    startTransition(async () => {
      const res = await deleteCountyAction(id);
      if (!res.ok) {
        setError(res.error ?? "Delete failed.");
        setDeleteCountyConfirm(null);
        return;
      }
      setDeleteCountyConfirm(null);
      setSelectedId((cur) => (cur === id ? null : cur));
      router.refresh();
    });
  };

  const onSvgContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editorMode !== "nodes") return;
    if ((e.target as Element).closest(".map-node-root")) return;
    setContextMenu(null);
  };

  const selectedNode =
    selectedNodeId !== null ? nodesById.get(selectedNodeId) : undefined;
  const ownerFieldsEnabled = LOCATION_NODE_TYPES.has(nodeType);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="panel overflow-hidden p-0">
        <div className="panel-heading flex items-center justify-between gap-2">
          <span>Canvas</span>
          <button type="button" className="btn-ghost text-xs py-1 px-2" onClick={resetView}>
            Reset view
          </button>
        </div>
        <div className="panel-body p-0">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-full min-h-[420px] w-full touch-none bg-map-canvas"
            onClick={onSvgClick}
            onDoubleClick={onSvgDoubleClick}
            onContextMenu={onSvgContextMenu}
          >
            <defs>
              <pattern
                id="editor-grid"
                width={40}
                height={40}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="rgba(201, 164, 76, 0.1)"
                  strokeWidth={1}
                />
              </pattern>
            </defs>
            <rect width={VIEW_W} height={VIEW_H} fill="url(#editor-grid)" />

            <g ref={zoomLayerRef}>
              {refImage && !refAdjustMode ? (
                <g
                  className="reference-chart-layer"
                  style={{
                    pointerEvents: "none",
                    touchAction: "none",
                  }}
                  transform={referenceTransform}
                >
                  <image
                    href={refImage}
                    x={0}
                    y={0}
                    width={VIEW_W}
                    height={VIEW_H}
                    preserveAspectRatio="xMidYMid meet"
                    opacity={refOpacity}
                  />
                </g>
              ) : null}

              <g className="connections pointer-events-none">
                {connections.map((c) => {
                  const a = nodesById.get(c.node_a_id);
                  const b = nodesById.get(c.node_b_id);
                  if (!a || !b) return null;
                  const [x1, y1] = projectNode(mapModel.projection, a);
                  const [x2, y2] = projectNode(mapModel.projection, b);
                  const edgeKey = `${Math.min(c.node_a_id, c.node_b_id)}-${Math.max(c.node_a_id, c.node_b_id)}`;
                  return (
                    <line
                      key={edgeKey}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={ROAD_STROKE[c.road_type]}
                      strokeWidth={1.2}
                    />
                  );
                })}
              </g>

              <g className="county-overlays">
                {counties.map((p) => {
                  if (p.id === selectedId) return null;
                  if (!p.map_polygon || p.map_polygon.length < 3) return null;
                  const d = legacyPolygonRingToPathD(
                    mapModel.projection,
                    p.map_polygon,
                  );
                  if (!d) return null;
                  return (
                    <path
                      key={`pv-${p.id}`}
                      d={d}
                      fill="rgba(201, 164, 76, 0.06)"
                      stroke={countyColor(p.id)}
                      strokeWidth={1.1}
                      strokeDasharray="4 3"
                      className="pointer-events-none"
                    />
                  );
                })}

                {selectedId !== null && openWorkingRing.length >= 3 ? (
                  <path
                    d={
                      legacyPolygonRingToPathD(
                        mapModel.projection,
                        openWorkingRing,
                      ) ?? ""
                    }
                    fill="rgba(233, 200, 122, 0.12)"
                    stroke="rgba(233, 200, 122, 0.85)"
                    strokeWidth={1.6}
                    strokeDasharray="6 4"
                    className="pointer-events-none"
                  />
                ) : null}

                {selectedId !== null &&
                openWorkingRing.length >= 2 &&
                openWorkingRing.length < 3 ? (
                  <path
                    d={openPathFromLegacy(mapModel.projection, openWorkingRing)}
                    fill="none"
                    stroke="rgba(233, 200, 122, 0.75)"
                    strokeWidth={1.4}
                    strokeDasharray="5 4"
                    className="pointer-events-none"
                  />
                ) : null}

                {selectedId !== null && openWorkingRing.length === 1 ? (
                  (() => {
                    const [x, y] = projectLegacyXY(
                      mapModel.projection,
                      openWorkingRing[0]![0],
                      openWorkingRing[0]![1],
                    );
                    return (
                      <circle
                        cx={x}
                        cy={y}
                        r={5}
                        fill="rgba(233, 200, 122, 0.5)"
                        className="pointer-events-none"
                      />
                    );
                  })()
                ) : null}

                {composeBorderMode && composedPickRing.length >= 3 ? (
                  <path
                    d={
                      legacyPolygonRingToPathD(
                        mapModel.projection,
                        composedPickRing,
                      ) ?? ""
                    }
                    fill="rgba(100, 180, 140, 0.1)"
                    stroke="rgba(120, 200, 160, 0.95)"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    className="pointer-events-none"
                  />
                ) : null}

                {composeBorderMode &&
                composedPickRing.length >= 2 &&
                composedPickRing.length < 3 ? (
                  <path
                    d={openPathFromLegacy(
                      mapModel.projection,
                      composedPickRing,
                    )}
                    fill="none"
                    stroke="rgba(120, 200, 160, 0.85)"
                    strokeWidth={1.35}
                    strokeDasharray="4 3"
                    className="pointer-events-none"
                  />
                ) : null}

                {composeBorderMode && composedPickRing.length === 1 ? (
                  (() => {
                    const [x, y] = projectLegacyXY(
                      mapModel.projection,
                      composedPickRing[0]![0],
                      composedPickRing[0]![1],
                    );
                    return (
                      <circle
                        cx={x}
                        cy={y}
                        r={5}
                        fill="rgba(120, 200, 160, 0.55)"
                        className="pointer-events-none"
                      />
                    );
                  })()
                ) : null}
              </g>

              {composeBorderMode ? (
                <g className="borrow-source-vertices pointer-events-auto">
                  {counties.flatMap((p) => {
                    if (!p.map_polygon || p.map_polygon.length < 3) return [];
                    const open = normalizeOpenRing(
                      p.map_polygon.map(
                        ([a, b]) => [a, b] as [number, number],
                      ),
                    );
                    return open.map((pt, vi) => {
                      const [x, y] = projectLegacyXY(
                        mapModel.projection,
                        pt[0],
                        pt[1],
                      );
                      return (
                        <circle
                          key={`borrow-${p.id}-${vi}`}
                          className="borrow-vtx cursor-pointer"
                          cx={x}
                          cy={y}
                          r={8}
                          fill="rgba(74, 107, 90, 0.55)"
                          stroke="rgba(120, 200, 160, 0.95)"
                          strokeWidth={1.5}
                          style={{ touchAction: "none" }}
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            suppressClickUntilRef.current = Date.now() + 450;
                            setComposedPickRing((r) => [
                              ...r,
                              [pt[0], pt[1]],
                            ]);
                            setError(null);
                          }}
                        />
                      );
                    });
                  })}
                </g>
              ) : null}

              <g
                className={
                  editorMode === "counties" ? "pointer-events-none" : undefined
                }
              >
                {displayNodes.map((n) => {
                  const [x, y] = projectNode(mapModel.projection, n);
                  const r = NODE_RADIUS[n.type];
                  const hitR = Math.max(r + 12, 20);
                  const isSel =
                    editorMode === "nodes" && selectedNodeId === n.id;
                  return (
                    <g
                      key={n.id}
                      className="map-node-root"
                      style={{
                        cursor:
                          editorMode === "nodes"
                            ? nodeDragAdjustMode && isSel
                              ? nodeDragActiveId === n.id
                                ? "grabbing"
                                : "grab"
                              : "pointer"
                            : undefined,
                      }}
                      onClick={(e) => {
                        if (editorMode !== "nodes") return;
                        e.stopPropagation();
                        setSelectedNodeId(n.id);
                        setContextMenu(null);
                      }}
                      onContextMenu={(e) => {
                        if (editorMode !== "nodes") return;
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          nodeId: n.id,
                          clientX: e.clientX,
                          clientY: e.clientY,
                        });
                      }}
                    >
                      {isSel ? (
                        <circle
                          cx={x}
                          cy={y}
                          r={r + 8}
                          fill="none"
                          stroke="rgba(233, 200, 122, 0.92)"
                          strokeWidth={2}
                          pointerEvents="none"
                        />
                      ) : null}
                      <circle
                        cx={x}
                        cy={y}
                        r={r + 2}
                        fill="rgba(18, 14, 12, 0.55)"
                        pointerEvents="none"
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={r}
                        fill={NODE_FILL[n.type]}
                        pointerEvents="none"
                      />
                      <text
                        x={x}
                        y={y - r - 6}
                        textAnchor="middle"
                        fill="rgb(var(--color-parchment))"
                        pointerEvents="none"
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 9,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                        }}
                      >
                        {n.name ?? `Node ${n.id}`}
                      </text>
                      {editorMode === "nodes" ? (
                        <circle
                          cx={x}
                          cy={y}
                          r={hitR}
                          fill="transparent"
                          style={{ touchAction: "none" }}
                          onPointerDown={(e) => {
                            if (
                              !nodeDragAdjustMode ||
                              selectedNodeId !== n.id
                            ) {
                              return;
                            }
                            e.stopPropagation();
                            e.preventDefault();
                            nodeDragLastLegRef.current = null;
                            setNodeDragActiveId(n.id);
                          }}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>

              {editorMode === "counties" &&
              selectedId !== null &&
              openWorkingRing.length >= 2 ? (
                <g
                  className={`edge-split-handles ${refAdjustMode ? "pointer-events-none" : "pointer-events-auto"}`}
                  aria-hidden={refAdjustMode}
                >
                  {edgeSplitTargets.map(({ a, b }) => {
                    const pa = openWorkingRing[a]!;
                    const pb = openWorkingRing[b]!;
                    const mid: [number, number] = [
                      (pa[0] + pb[0]) / 2,
                      (pa[1] + pb[1]) / 2,
                    ];
                    const [mx, my] = projectLegacyXY(
                      mapModel.projection,
                      mid[0],
                      mid[1],
                    );
                    return (
                      <circle
                        key={`e-${a}-${b}`}
                        className="edge-split-handle cursor-copy"
                        cx={mx}
                        cy={my}
                        r={6}
                        fill="rgba(100, 180, 140, 0.45)"
                        stroke="rgba(120, 200, 160, 0.95)"
                        strokeWidth={1.25}
                        style={{ touchAction: "none" }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          suppressClickUntilRef.current = Date.now() + 450;
                          setWorkingRing(
                            splitEdgeAtMidpoint(openWorkingRing, a, b),
                          );
                          setError(null);
                        }}
                      />
                    );
                  })}
                </g>
              ) : null}

              {editorMode === "counties" &&
              selectedId !== null &&
              openWorkingRing.length > 0 ? (
                <g
                  className={`vertex-handles ${refAdjustMode ? "pointer-events-none" : ""}`}
                  aria-hidden={refAdjustMode}
                >
                  {openWorkingRing.map((pt, i) => {
                    const [x, y] = projectLegacyXY(
                      mapModel.projection,
                      pt[0],
                      pt[1],
                    );
                    return (
                      <circle
                        key={`h-${i}`}
                        className="vertex-handle cursor-grab active:cursor-grabbing"
                        cx={x}
                        cy={y}
                        r={9}
                        fill="rgba(233, 200, 122, 0.35)"
                        stroke="rgba(233, 200, 122, 0.95)"
                        strokeWidth={1.5}
                        style={{ touchAction: "none" }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setDragVertexIndex(i);
                        }}
                      />
                    );
                  })}
                </g>
              ) : null}

              {refImage && refAdjustMode ? (
                <g
                  className="reference-chart-layer reference-chart-layer--on-top"
                  style={{
                    pointerEvents: "auto",
                    cursor: "move",
                    touchAction: "none",
                  }}
                  transform={referenceTransform}
                  onPointerDown={onRefPointerDown}
                >
                  <image
                    href={refImage}
                    x={0}
                    y={0}
                    width={VIEW_W}
                    height={VIEW_H}
                    preserveAspectRatio="xMidYMid meet"
                    opacity={refOpacity}
                  />
                </g>
              ) : null}
            </g>
          </svg>
          <p className="px-4 py-2 font-serif text-xs text-parchment-deep border-t border-gold/15">
            {editorMode === "nodes" ? (
              <>
                Nodes mode: click a marker to edit its charter in the sidebar.
                Enable &ldquo;Reposition by dragging&rdquo; to move the selected
                marker on the parchment (saved on release). Right-click a node
                for &ldquo;Add connected node here&rdquo;. Drag the canvas to
                pan; scroll or pinch to zoom.
              </>
            ) : composeBorderMode ? (
              <>
                Composing a new border: click mint-green corners on existing
                counties (order follows your clicks), or click the parchment near
                a corner to snap to it. Undo picks in the sidebar; when you have
                three or more points, name the county and choose finish.
              </>
            ) : (
              <>
                Drag to pan the canvas, scroll or pinch to zoom deeply on large
                charts. With &ldquo;Adjust reference&rdquo; on, the chart sits on
                top for dragging. Turn it off to trace: single-click adds a vertex,
                double-click closes and saves. Use &ldquo;Compose border from
                neighbours&rdquo; to seed a ring from existing corners.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel overflow-hidden">
          <div className="panel-heading flex p-0">
            <button
              type="button"
              className={`flex-1 px-3 py-2.5 font-display uppercase tracking-imperial text-xs transition-colors border-b-2 ${
                editorMode === "counties"
                  ? "border-gold text-gold bg-imperial/35"
                  : "border-transparent text-parchment-deep hover:text-parchment"
              }`}
              onClick={() => changeEditorMode("counties")}
            >
              Counties
            </button>
            <button
              type="button"
              className={`flex-1 px-3 py-2.5 font-display uppercase tracking-imperial text-xs transition-colors border-b-2 ${
                editorMode === "nodes"
                  ? "border-gold text-gold bg-imperial/35"
                  : "border-transparent text-parchment-deep hover:text-parchment"
              }`}
              onClick={() => changeEditorMode("nodes")}
            >
              Nodes
            </button>
          </div>
        </div>

        {editorMode === "counties" ? (
        <>
        <div className="panel">
          <h3 className="panel-heading">New county</h3>
          <div className="panel-body space-y-3">
            <label className="block">
              <span className="label-imperial">Name</span>
              <input
                type="text"
                className="input-imperial mt-1 w-full"
                value={newCountyName}
                onChange={(e) => setNewCountyName(e.target.value)}
                placeholder="e.g. Thessaly"
                maxLength={120}
              />
            </label>
            <label className="block">
              <span className="label-imperial">Region</span>
              <select
                className="input-imperial mt-1 w-full"
                disabled={composeBorderMode}
                value={newRegionId === null ? "" : String(newRegionId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setNewRegionId(v === "" ? null : Number(v));
                }}
              >
                <option value="">None</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {!composeBorderMode ? (
              <>
                <button
                  type="button"
                  className="btn-imperial text-xs w-full"
                  disabled={!newCountyName.trim() || isPending}
                  onClick={createCounty}
                >
                  {isPending ? "Working…" : "Create county"}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs w-full mt-2"
                  disabled={
                    !hasBorrowSources || isPending || refAdjustMode
                  }
                  onClick={enterComposeBorderMode}
                >
                  Compose border from neighbours
                </button>
                {!hasBorrowSources ? (
                  <p className="font-serif text-xs text-parchment-deep mt-2">
                    Draw at least one county fully so its corners can be reused
                    here.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="font-serif text-xs text-parchment-deep leading-relaxed">
                  Click the mint-green dots along existing counties (order
                  matters). Three or more corners, then name the county and
                  finish.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    className="btn-ghost text-xs flex-1 min-w-[6rem]"
                    onClick={undoComposedPick}
                    disabled={composedPickRing.length === 0 || isPending}
                  >
                    Undo pick
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs flex-1 min-w-[6rem]"
                    onClick={cancelComposeBorderMode}
                    disabled={isPending}
                  >
                    Cancel
                  </button>
                </div>
                <button
                  type="button"
                  className="btn-imperial text-xs w-full mt-3"
                  disabled={
                    !newCountyName.trim() ||
                    composedPickRing.length < 3 ||
                    isPending
                  }
                  onClick={finishComposeAndCreateCounty}
                >
                  {isPending ? "Working…" : "Finish & create county"}
                </button>
              </>
            )}
            {!composeBorderMode && regions.length === 0 ? (
              <p className="font-serif text-xs text-parchment-deep mt-2">
                No regions yet; the county will have no region until you add
                one and edit this row.
              </p>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-heading">County</h3>
          <div className="panel-body space-y-3">
            <label className="block">
              <span className="label-imperial">Active border</span>
              <select
                className="input-imperial mt-1 w-full"
                disabled={composeBorderMode}
                value={selectedId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setSelectedId(v === "" ? null : Number(v));
                  setError(null);
                  setStatus(null);
                }}
              >
                {counties.length === 0 ? (
                  <option value="">No counties</option>
                ) : null}
                {counties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={undoVertex}
                disabled={openWorkingRing.length === 0 || isPending}
              >
                Undo vertex
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={clearRing}
                disabled={openWorkingRing.length === 0 || isPending}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn-imperial text-xs"
                onClick={() => saveRing(openWorkingRing)}
                disabled={
                  selectedId === null || openWorkingRing.length < 3 || isPending
                }
              >
                {isPending ? "Saving…" : "Save polygon"}
              </button>
            </div>

            <button
              type="button"
              className="btn-ghost text-xs w-full border border-blood/25 text-blood hover:bg-blood/10"
              disabled={selectedId === null || isPending}
              onClick={() => {
                const p = counties.find((x) => x.id === selectedId);
                if (!p) return;
                setDeleteCountyConfirm({ id: p.id, name: p.name });
              }}
            >
              Delete county
            </button>

            {error ? (
              <p className="font-serif text-sm text-blood">{error}</p>
            ) : null}
            {status ? (
              <p className="font-serif text-sm text-verdigris">{status}</p>
            ) : null}
          </div>
        </div>
        </>
        ) : (
        <div className="panel">
          <h3 className="panel-heading">Node</h3>
          <div className="panel-body space-y-3">
            {selectedNode ? (
              <>
                <label className="block">
                  <span className="label-imperial">Name</span>
                  <input
                    type="text"
                    className="input-imperial mt-1 w-full"
                    value={nodeName}
                    onChange={(e) => setNodeName(e.target.value)}
                    maxLength={120}
                  />
                </label>
                <label className="block">
                  <span className="label-imperial">Type</span>
                  <select
                    className="input-imperial mt-1 w-full"
                    value={nodeType}
                    onChange={(e) =>
                      setNodeType(e.target.value as NodeType)
                    }
                  >
                    {NODE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label-imperial">County</span>
                  <select
                    className="input-imperial mt-1 w-full"
                    value={
                      nodeCountyId === null ? "" : String(nodeCountyId)
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setNodeCountyId(v === "" ? null : Number(v));
                    }}
                  >
                    <option value="">None</option>
                    {counties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label-imperial">Map X</span>
                    <input
                      type="number"
                      step="any"
                      className="input-imperial mt-1 w-full tabular-nums"
                      value={Number.isFinite(nodeMapX) ? nodeMapX : ""}
                      onChange={(e) =>
                        setNodeMapX(Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="label-imperial">Map Y</span>
                    <input
                      type="number"
                      step="any"
                      className="input-imperial mt-1 w-full tabular-nums"
                      value={Number.isFinite(nodeMapY) ? nodeMapY : ""}
                      onChange={(e) =>
                        setNodeMapY(Number(e.target.value))
                      }
                    />
                  </label>
                </div>
                <label className="flex cursor-pointer items-start gap-2 font-serif text-sm text-parchment-dark">
                  <input
                    type="checkbox"
                    className="mt-1 accent-gold"
                    checked={nodeDragAdjustMode}
                    onChange={(e) => {
                      setNodeDragAdjustMode(e.target.checked);
                      setNodeDragActiveId(null);
                    }}
                  />
                  <span>
                    <span className="font-display uppercase tracking-imperial text-xs text-gold">
                      Reposition by dragging
                    </span>
                    <span className="block text-xs text-parchment-deep mt-0.5">
                      When checked, drag this marker on the canvas; the
                      coordinates are written when you release. Leave off to
                      avoid shifting it by mistake.
                    </span>
                  </span>
                </label>
                <div className={ownerFieldsEnabled ? "" : "opacity-60"}>
                  <label className="block">
                    <span className="label-imperial">Owner id</span>
                    <input
                      type="text"
                      className="input-imperial mt-1 w-full tabular-nums text-xs"
                      value={nodeOwnerId}
                      onChange={(e) => setNodeOwnerId(e.target.value)}
                      placeholder="UUID"
                      disabled={!ownerFieldsEnabled}
                    />
                  </label>
                  <label className="block mt-2">
                    <span className="label-imperial">Owner type</span>
                    <select
                      className="input-imperial mt-1 w-full"
                      value={nodeOwnerType}
                      onChange={(e) =>
                        setNodeOwnerType(
                          e.target.value === "character" ||
                            e.target.value === "clan"
                            ? e.target.value
                            : "",
                        )
                      }
                      disabled={!ownerFieldsEnabled}
                    >
                      <option value="">None</option>
                      <option value="character">character</option>
                      <option value="clan">clan</option>
                    </select>
                  </label>
                </div>
                {!ownerFieldsEnabled ? (
                  <p className="font-serif text-xs text-parchment-deep">
                    Ownership applies to settlement, farm, mine, port, and
                    fortress sites. Road and city nodes use other records.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="btn-imperial text-xs w-full"
                  disabled={isPending || !nodeName.trim()}
                  onClick={saveNode}
                >
                  {isPending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs w-full border border-blood/25 text-blood hover:bg-blood/10"
                  disabled={isPending}
                  onClick={() =>
                    setDeleteNodeConfirm({
                      id: selectedNode.id,
                      name: selectedNode.name ?? `Node ${selectedNode.id}`,
                    })
                  }
                >
                  Delete node
                </button>
                {nodePanelError ? (
                  <p className="font-serif text-sm text-blood">
                    {nodePanelError}
                  </p>
                ) : null}
                {nodePanelStatus ? (
                  <p className="font-serif text-sm text-verdigris">
                    {nodePanelStatus}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="font-serif text-sm text-parchment-deep">
                Click a node on the canvas to inspect and amend its charter.
              </p>
            )}
          </div>
        </div>
        )}

        <div className="panel">
          <h3 className="panel-heading">Reference chart</h3>
          <div className="panel-body space-y-3">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={isRefPending}
              className="block w-full text-xs text-parchment-dark file:mr-2 file:rounded-sm file:border file:border-gold/25 file:bg-imperial-shadow/50 file:px-2 file:py-1 file:font-display file:text-gold disabled:opacity-50"
              onChange={(e) => {
                const input = e.target;
                const f = input.files?.[0];
                if (!f) return;
                startRefTransition(async () => {
                  const prep = await beginMapEditorReferenceUploadAction(
                    f.type,
                    f.size,
                  );
                  if (!prep.ok) {
                    input.value = "";
                    setRefPersistNotice(prep.error);
                    return;
                  }

                  const put = await uploadReferenceFileViaSignedUrl(
                    prep.signedUrl,
                    f,
                  );
                  input.value = "";
                  if (!put.ok) {
                    setRefPersistNotice(put.message);
                    return;
                  }

                  const done = await completeMapEditorReferenceUploadAction(
                    prep.objectPath,
                  );
                  if (!done.ok) {
                    setRefPersistNotice(
                      done.error ?? "Could not finalize upload.",
                    );
                    return;
                  }

                  setRefPersistNotice(
                    "Chart archived. Adjust and save alignment when ready.",
                  );
                  router.refresh();
                });
              }}
            />
            {refImage ? (
              <>
                <label className="flex cursor-pointer items-start gap-2 font-serif text-sm text-parchment-dark">
                  <input
                    type="checkbox"
                    className="mt-1 accent-gold"
                    checked={refAdjustMode}
                    onChange={(e) => setRefAdjustMode(e.target.checked)}
                  />
                  <span>
                    <span className="font-display uppercase tracking-imperial text-xs text-gold">
                      Adjust reference
                    </span>
                    <span className="block text-xs text-parchment-deep mt-0.5">
                      The chart is lifted above counties and roads so drags move
                      the image, not the map. Turn off before tracing vertices.
                    </span>
                  </span>
                </label>
                <label className="block">
                  <span className="label-imperial">Scale</span>
                  <input
                    type="range"
                    min={REF_SCALE_MIN}
                    max={REF_SCALE_MAX}
                    step={0.05}
                    value={refScale}
                    onChange={(e) =>
                      setRefScale(
                        Math.min(
                          REF_SCALE_MAX,
                          Math.max(REF_SCALE_MIN, Number(e.target.value)),
                        ),
                      )
                    }
                    className="mt-2 w-full accent-gold"
                  />
                  <span className="font-display tabular-nums text-xs text-gold-dim mt-1 block">
                    {refScale.toFixed(2)}×
                  </span>
                </label>
                <label className="block">
                  <span className="label-imperial">Opacity</span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.85}
                    step={0.05}
                    value={refOpacity}
                    onChange={(e) => setRefOpacity(Number(e.target.value))}
                    className="mt-2 w-full accent-gold"
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost text-xs w-full"
                  onClick={resetReferenceAlignment}
                >
                  Reset position &amp; scale
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs w-full"
                  disabled={isRefPending}
                  onClick={removeReferenceFromServer}
                >
                  Remove from archive
                </button>
              </>
            ) : (
              <p className="font-serif text-xs text-parchment-deep">
                Upload a chart (JPEG, PNG, WebP, or GIF; up to 100 MB). The
                raster lives in private Storage; each visit receives a fresh
                signed link. Alignment is saved in the database when you
                choose &ldquo;Save alignment&rdquo;.
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-gold/15 pt-3">
              <span className="label-imperial">Persist alignment</span>
              <p className="font-serif text-xs text-parchment-deep">
                Writes pan, chart scale, and opacity for this session of the
                editor. Refresh the page to load the last saved values from the
                ledger.
              </p>
              <button
                type="button"
                className="btn-imperial text-xs w-full"
                disabled={!refImage || isRefPending}
                onClick={saveReferenceAlignmentToServer}
              >
                {isRefPending ? "Working…" : "Save alignment"}
              </button>
            </div>

            {refPersistNotice ? (
              <p className="font-serif text-xs text-verdigris">{refPersistNotice}</p>
            ) : null}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          data-map-editor-ctx
          className="fixed z-[100] min-w-[14rem] rounded border border-gold/25 bg-imperial shadow-lg py-1"
          style={{
            left: contextMenu.clientX,
            top: contextMenu.clientY,
          }}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left font-serif text-sm text-parchment hover:bg-imperial-shadow/80"
            onClick={() => addConnectedFromContext(contextMenu.nodeId)}
          >
            Add connected node here
          </button>
        </div>
      ) : null}

      {deleteNodeConfirm ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/75 p-4"
          role="presentation"
          onClick={() => setDeleteNodeConfirm(null)}
        >
          <div
            className="panel max-w-md w-full"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="panel-heading">Confirm removal</h3>
            <div className="panel-body space-y-4">
              <p className="font-serif text-sm text-parchment">
                Delete {deleteNodeConfirm.name}? This will also remove all
                connections to this node.
              </p>
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setDeleteNodeConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-imperial text-xs border border-blood/40 text-blood"
                  onClick={runDeleteNode}
                >
                  {isPending ? "Working…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCountyConfirm ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/75 p-4"
          role="presentation"
          onClick={() => setDeleteCountyConfirm(null)}
        >
          <div
            className="panel max-w-md w-full"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="panel-heading">Confirm removal</h3>
            <div className="panel-body space-y-4">
              <p className="font-serif text-sm text-parchment">
                Delete {deleteCountyConfirm.name}? This cannot be undone.
              </p>
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setDeleteCountyConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-imperial text-xs border border-blood/40 text-blood"
                  onClick={runDeleteCounty}
                >
                  {isPending ? "Working…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
