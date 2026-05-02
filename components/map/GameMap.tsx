"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { select } from "d3-selection";
import { dijkstra, pathEdgeSet } from "@/lib/game/pathfinding";
import { travelAction, TRAVEL_INITIAL_STATE } from "@/app/actions/travel";
import {
  buildMapModel,
  type CountyMapInput,
  projectLegacyXY,
  projectNode,
} from "@/lib/map/buildMapModel";
import type { MapNodeView, MapConnectionView } from "@/lib/types/game.types";

export interface CharacterPresence {
  id: string;
  name: string;
  node_id: number | null;
}

export interface CountyOption {
  id: number;
  name: string;
  /** Parchment coordinates; same space as `nodes.map_x` / `map_y`. */
  map_x: number | null;
  map_y: number | null;
  /** Optional closed polygon for the county border (legacy x,y vertices). */
  map_polygon: [number, number][] | null;
}

export interface CityNodeLink {
  cityId: number;
  nodeId: number;
}

interface Props {
  nodes: MapNodeView[];
  connections: MapConnectionView[];
  currentNodeId: number | null;
  characterId: string;
  characterAP: number;
  characterTravelTier: number;
  otherCharacters: CharacterPresence[];
  /** Game counties (for labels and the hull click layer). */
  counties: CountyOption[];
  /** city id keyed by node id for /game/city/[id] links. */
  cityLinks: CityNodeLink[];
}

const VIEW_W = 1000;
const VIEW_H = 620;

const ROAD_STROKE: Record<MapConnectionView["road_type"], string> = {
  road: "rgba(201, 164, 76, 0.4)",
  river: "rgba(74, 107, 90, 0.55)",
  sea: "rgba(74, 107, 90, 0.32)",
};
const ROAD_STROKE_ACTIVE: Record<MapConnectionView["road_type"], string> = {
  road: "rgba(233, 200, 122, 0.9)",
  river: "rgba(100, 180, 140, 0.9)",
  sea: "rgba(100, 180, 140, 0.9)",
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
  city: 11,
  fortress: 9,
  port: 8,
  settlement: 7,
  farm: 5,
  mine: 5,
  road: 3,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function GameMap({
  nodes,
  connections,
  currentNodeId,
  characterId,
  characterAP,
  characterTravelTier,
  otherCharacters,
  counties,
  cityLinks,
}: Props) {
  const router = useRouter();
  const [travelState, formAction, isTraveling] = useActionState(
    travelAction,
    TRAVEL_INITIAL_STATE,
  );

  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomLayerRef = useRef<SVGGElement | null>(null);

  const prevApRemaining = useRef<number | null>(null);
  useEffect(() => {
    if (
      travelState.apRemaining !== null &&
      travelState.apRemaining !== prevApRemaining.current
    ) {
      prevApRemaining.current = travelState.apRemaining;
      router.refresh();
    }
  }, [travelState.apRemaining, router]);

  const nodesById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n] as const)),
    [nodes],
  );

  const countiesById = useMemo(
    () => new Map(counties.map((p) => [p.id, p.name] as const)),
    [counties],
  );

  const cityIdByNodeId = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cityLinks) m.set(c.nodeId, c.cityId);
    return m;
  }, [cityLinks]);

  const charsByNode = useMemo(() => {
    const m = new Map<number, CharacterPresence[]>();
    for (const ch of otherCharacters) {
      if (ch.node_id === null || ch.id === characterId) continue;
      if (!m.has(ch.node_id)) m.set(ch.node_id, []);
      m.get(ch.node_id)!.push(ch);
    }
    return m;
  }, [otherCharacters, characterId]);

  const countyMapInputs = useMemo((): CountyMapInput[] => {
    return counties
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
      }));
  }, [counties]);

  const mapModel = useMemo(
    () => buildMapModel(VIEW_W, VIEW_H, nodes, countyMapInputs),
    [nodes, countyMapInputs],
  );

  const zoomBehav = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  useEffect(() => {
    const svgEl = svgRef.current;
    const layerEl = zoomLayerRef.current;
    if (!svgEl || !layerEl) return;

    const svg = select(svgEl);
    const layer = select(layerEl);

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.55, 14])
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
  }, [nodes, countyMapInputs]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedCountyId, setSelectedCountyId] = useState<number | null>(null);

  const selected =
    selectedId !== null ? nodesById.get(selectedId) ?? null : null;
  const current =
    currentNodeId !== null ? nodesById.get(currentNodeId) ?? null : null;

  const pathResult = useMemo(() => {
    if (
      currentNodeId === null ||
      selectedId === null ||
      selectedId === currentNodeId
    ) {
      return null;
    }
    return dijkstra(
      connections,
      currentNodeId,
      selectedId,
      characterTravelTier,
    );
  }, [selectedId, currentNodeId, connections, characterTravelTier]);

  const highlightedEdges = useMemo(
    () =>
      pathResult?.path ? pathEdgeSet(pathResult.path) : new Set<string>(),
    [pathResult],
  );
  const highlightedNodes = useMemo(
    () => new Set(pathResult?.path ?? []),
    [pathResult],
  );

  const canAffordTravel =
    pathResult?.reachable && characterAP >= pathResult.totalCost;

  const atSelectedNode =
    selectedId !== null ? (charsByNode.get(selectedId) ?? []) : [];

  function resetZoom() {
    const svgEl = svgRef.current;
    if (!svgEl || !zoomBehav.current) return;
    select(svgEl).transition().duration(200).call(zoomBehav.current.transform, zoomIdentity);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="panel overflow-hidden">
        <div className="panel-heading flex flex-wrap items-center justify-between gap-2">
          <span>Map of the realm</span>
          <button
            type="button"
            onClick={resetZoom}
            className="btn-ghost text-[0.65rem] py-1 px-2"
          >
            Reset view
          </button>
        </div>
        <div className="panel-body p-0">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-full min-h-[420px] w-full touch-none bg-map-canvas"
            role="img"
            aria-label="Map of the empire"
          >
            <defs>
              <pattern
                id="parchment-grid"
                width="40"
                height="40"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 40 0 L 0 0 0 40"
                  fill="none"
                  stroke="rgba(201, 164, 76, 0.12)"
                  strokeWidth="1"
                />
              </pattern>

              <radialGradient id="glow-current" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(233, 200, 122, 0.30)" />
                <stop offset="100%" stopColor="rgba(233, 200, 122, 0)" />
              </radialGradient>

              <radialGradient id="glow-path" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(233, 200, 122, 0.18)" />
                <stop offset="100%" stopColor="rgba(233, 200, 122, 0)" />
              </radialGradient>

              <filter id="glow-filter" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect
              width={VIEW_W}
              height={VIEW_H}
              fill="url(#parchment-grid)"
              className="pointer-events-none"
            />

            <g ref={zoomLayerRef}>
              <g
                className="county-hit pointer-events-auto"
                style={{ isolation: "isolate" }}
              >
                {mapModel.countyHulls.map((ph) => (
                  <path
                    key={ph.countyId}
                    d={ph.d}
                    fill="rgba(201, 164, 76, 0.14)"
                    stroke="rgba(233, 200, 122, 0.55)"
                    strokeWidth={1.35}
                    strokeDasharray="5 4"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCountyId(ph.countyId);
                    }}
                  />
                ))}
              </g>

              <g className="county-labels pointer-events-none" aria-hidden>
                {counties
                  .filter(
                    (p) =>
                      p.map_x != null &&
                      p.map_y != null &&
                      Number.isFinite(p.map_x) &&
                      Number.isFinite(p.map_y),
                  )
                  .map((p) => {
                    const [lx, ly] = projectLegacyXY(
                      mapModel.projection,
                      p.map_x!,
                      p.map_y!,
                    );
                    return (
                      <text
                        key={`pl-${p.id}`}
                        x={lx}
                        y={ly - 18}
                        textAnchor="middle"
                        fill="rgb(var(--color-gold))"
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 10,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          paintOrder: "stroke",
                          stroke: "rgba(18, 14, 12, 0.92)",
                          strokeWidth: 3,
                        }}
                      >
                        {p.name}
                      </text>
                    );
                  })}
              </g>

              <g className="connections">
                {connections.map((c) => {
                  const a = nodesById.get(c.node_a_id);
                  const b = nodesById.get(c.node_b_id);
                  if (!a || !b) return null;
                  const [x1, y1] = projectNode(mapModel.projection, a);
                  const [x2, y2] = projectNode(mapModel.projection, b);
                  const edgeKey = `${Math.min(c.node_a_id, c.node_b_id)}-${Math.max(c.node_a_id, c.node_b_id)}`;
                  const isOnPath = highlightedEdges.has(edgeKey);
                  return (
                    <line
                      key={edgeKey}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={
                        isOnPath
                          ? ROAD_STROKE_ACTIVE[c.road_type]
                          : ROAD_STROKE[c.road_type]
                      }
                      strokeWidth={
                        isOnPath ? 2.5 : c.road_type === "road" ? 1.5 : 2
                      }
                      strokeDasharray={
                        c.road_type === "sea" ? "4 4" : undefined
                      }
                      className="pointer-events-none"
                    />
                  );
                })}
              </g>

              {current ? (
                <circle
                  cx={projectNode(mapModel.projection, current)[0]}
                  cy={projectNode(mapModel.projection, current)[1]}
                  r={44}
                  fill="url(#glow-current)"
                  className="pointer-events-none"
                />
              ) : null}

              {pathResult?.reachable
                ? pathResult.path.map((nid) => {
                    const n = nodesById.get(nid);
                    if (!n || nid === currentNodeId) return null;
                    const [px, py] = projectNode(mapModel.projection, n);
                    return (
                      <circle
                        key={`glow-${nid}`}
                        cx={px}
                        cy={py}
                        r={28}
                        fill="url(#glow-path)"
                        className="pointer-events-none"
                      />
                    );
                  })
                : null}

              <g className="nodes">
                {nodes.map((n) => {
                  const [mx, my] = projectNode(mapModel.projection, n);
                  const isCurrent = currentNodeId === n.id;
                  const isSelected = selectedId === n.id;
                  const isOnPath = highlightedNodes.has(n.id);
                  const r = NODE_RADIUS[n.type];

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${mx}, ${my})`}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(n.id);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={n.name ?? `Node ${n.id}`}
                      onKeyDown={(e) =>
                        e.key === "Enter" && setSelectedId(n.id)
                      }
                    >
                      {isSelected ? (
                        <circle
                          r={r + 7}
                          fill="none"
                          stroke="rgb(var(--color-gold-bright))"
                          strokeWidth={1.5}
                          strokeDasharray="3 3"
                          filter="url(#glow-filter)"
                        />
                      ) : null}

                      {isOnPath && !isCurrent && !isSelected ? (
                        <circle
                          r={r + 4}
                          fill="none"
                          stroke="rgba(233, 200, 122, 0.5)"
                          strokeWidth={1}
                        />
                      ) : null}

                      <circle
                        r={r}
                        fill={NODE_FILL[n.type]}
                        stroke={
                          isCurrent
                            ? "rgb(var(--color-gold-bright))"
                            : isOnPath
                              ? "rgba(233, 200, 122, 0.7)"
                              : "rgba(22, 17, 11, 0.6)"
                        }
                        strokeWidth={isCurrent ? 2.5 : isOnPath ? 1.5 : 1}
                      />

                      {(n.type === "city" || n.type === "fortress") &&
                      n.name ? (
                        <text
                          x={0}
                          y={r + 14}
                          textAnchor="middle"
                          fill="rgb(var(--color-parchment))"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontSize: 11,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            paintOrder: "stroke",
                            stroke: "rgba(7, 5, 10, 0.9)",
                            strokeWidth: 3,
                            pointerEvents: "none",
                          }}
                        >
                          {n.name}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>

              <g className="presence pointer-events-none">
                {Array.from(charsByNode.entries()).map(([nodeId, chars]) => {
                  const n = nodesById.get(nodeId);
                  if (!n) return null;
                  const [px, py] = projectNode(mapModel.projection, n);
                  const r = NODE_RADIUS[n.type];
                  const count = chars.length;

                  return (
                    <g
                      key={`chars-${nodeId}`}
                      transform={`translate(${px + r + 5}, ${py - r - 2})`}
                    >
                      <circle
                        r={7}
                        fill="rgb(var(--color-imperial))"
                        stroke="rgb(var(--color-gold-dim))"
                        strokeWidth={0.8}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="rgb(var(--color-gold-bright))"
                        style={{
                          fontSize: 7,
                          fontFamily: "var(--font-display)",
                        }}
                      >
                        {count > 9 ? "9+" : count}
                      </text>
                    </g>
                  );
                })}
              </g>

              {current ? (
                <g
                  transform={`translate(${projectNode(mapModel.projection, current)[0]}, ${projectNode(mapModel.projection, current)[1]})`}
                  pointerEvents="none"
                >
                  <circle
                    r={4}
                    cy={-(NODE_RADIUS[current.type] + 6)}
                    fill="rgb(var(--color-gold-bright))"
                    stroke="rgb(var(--color-imperial-deep))"
                    strokeWidth={1}
                  />
                </g>
              ) : null}
            </g>
          </svg>
          <p className="border-t border-gold/10 px-4 py-2 font-serif text-[0.65rem] text-parchment-deep/80">
            Drag to pan, scroll to zoom. County outlines follow nodes on your
            road network.
          </p>
        </div>
      </div>

      <aside className="space-y-4">
        {selectedCountyId !== null ? (
          <section className="panel">
            <h2 className="panel-heading">County</h2>
            <div className="panel-body space-y-3">
              <div className="font-display text-lg text-gold-bright leading-tight">
                {countiesById.get(selectedCountyId) ?? "County"}
              </div>
              <div>
                <div className="label-imperial mb-1">Roads & settlements</div>
                <ul className="space-y-1">
                  {nodes
                    .filter((n) => n.county_id === selectedCountyId)
                    .map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className="font-serif text-sm text-gold/90 hover:text-gold-bright underline-offset-2 hover:underline"
                          onClick={() => setSelectedId(n.id)}
                        >
                          {n.name ?? `Node ${n.id}`}
                        </button>
                        {n.type === "city" && cityIdByNodeId.has(n.id) ? (
                          <Link
                            href={`/game/city/${cityIdByNodeId.get(n.id)}`}
                            className="ml-2 font-display text-[0.6rem] text-gold-dim hover:text-gold"
                          >
                            Open city
                          </Link>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h2 className="panel-heading">Selection</h2>
          <div className="panel-body">
            {selected ? (
              <div className="space-y-3">
                <div>
                  <div className="font-display text-lg text-gold-bright leading-tight">
                    {selected.name ?? "Unnamed waypoint"}
                  </div>
                  <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
                    {selected.type}
                    {selected.is_capital ? " · Capital" : ""}
                  </div>
                </div>

                {atSelectedNode.length > 0 ? (
                  <div>
                    <div className="label-imperial mb-1">Present</div>
                    <ul className="space-y-1">
                      {atSelectedNode.map((ch) => (
                        <li
                          key={ch.id}
                          className="font-serif text-sm text-parchment-dark flex items-baseline gap-2"
                        >
                          <span className="inline-block w-5 h-5 rounded-full bg-imperial border border-gold/30 text-center leading-5 font-display text-[0.6rem] text-gold shrink-0">
                            {initials(ch.name)}
                          </span>
                          {ch.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : selected.id !== currentNodeId ? (
                  <p className="font-serif italic text-xs text-parchment-deep">
                    No one here.
                  </p>
                ) : null}

                {currentNodeId === selected.id ? (
                  <p className="font-serif italic text-parchment-dark text-sm">
                    You are standing here.
                  </p>
                ) : null}

                <div className="text-xs text-parchment-deep/50 font-mono tabular-nums">
                  {selected.county_id !== null
                    ? countiesById.get(selected.county_id) ?? "—"
                    : "—"}
                </div>
              </div>
            ) : (
              <p className="font-serif italic text-parchment-deep text-sm">
                Click a county band or a node. Scroll to zoom the parchment.
              </p>
            )}
          </div>
        </section>

        {selected &&
        currentNodeId !== null &&
        selected.id !== currentNodeId ? (
          <section className="panel">
            <h2 className="panel-heading">Travel</h2>
            <div className="panel-body space-y-3">
              {pathResult === null ? (
                <p className="font-serif italic text-parchment-deep text-sm">
                  Computing route…
                </p>
              ) : !pathResult.reachable ? (
                <p className="font-serif italic text-blood text-sm">
                  No passable road from your current location to here.
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="label-imperial mb-0">AP cost</dt>
                      <dd
                        className={`font-display text-xl tabular-nums ${
                          canAffordTravel ? "text-gold-bright" : "text-blood"
                        }`}
                      >
                        {pathResult.totalCost}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-imperial mb-0">Hops</dt>
                      <dd className="font-display text-xl text-gold-bright tabular-nums">
                        {pathResult.path.length - 1}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="label-imperial mb-0">You have</dt>
                      <dd className="font-display text-xl tabular-nums text-gold-bright">
                        {characterAP}{" "}
                        <span className="text-gold-dim text-xs">AP</span>
                      </dd>
                    </div>
                  </dl>

                  {!canAffordTravel ? (
                    <p className="font-serif italic text-blood text-xs">
                      Not enough action points. Refills at midnight.
                    </p>
                  ) : null}

                  <div>
                    <div className="label-imperial mb-1">Route</div>
                    <ol className="text-xs text-parchment-dark font-serif space-y-0.5">
                      {pathResult.path.map((nid, i) => {
                        const nd = nodesById.get(nid);
                        return (
                          <li key={nid} className="flex items-center gap-1.5">
                            {i > 0 ? (
                              <span className="text-gold-dim">›</span>
                            ) : null}
                            <span
                              className={
                                nid === currentNodeId
                                  ? "text-gold-bright"
                                  : nid === selectedId
                                    ? "text-gold-bright"
                                    : ""
                              }
                            >
                              {nd?.name ?? `Node ${nid}`}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                  {travelState.error ? (
                    <p className="font-serif italic text-blood text-sm">
                      {travelState.error}
                    </p>
                  ) : null}

                  <form action={formAction}>
                    <input
                      type="hidden"
                      name="target_node_id"
                      value={selected.id}
                    />
                    <button
                      type="submit"
                      disabled={!canAffordTravel || isTraveling}
                      className="btn-imperial w-full"
                    >
                      {isTraveling
                        ? "On the road…"
                        : `Travel (${pathResult.totalCost} AP)`}
                    </button>
                  </form>
                </>
              )}
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h2 className="panel-heading">Legend</h2>
          <div className="panel-body grid grid-cols-2 gap-2 text-xs font-serif">
            {(
              [
                ["city", "City"],
                ["fortress", "Fortress"],
                ["port", "Port"],
                ["settlement", "Settlement"],
                ["farm", "Farm"],
                ["mine", "Mine"],
                ["road", "Waypoint"],
              ] as const
            ).map(([type, label]) => (
              <div key={type} className="flex items-center gap-2">
                <span
                  className="inline-block rounded-full shrink-0"
                  style={{
                    width: 10,
                    height: 10,
                    background: NODE_FILL[type],
                    border: "1px solid rgba(22, 17, 11, 0.6)",
                  }}
                />
                <span className="text-parchment-dark">{label}</span>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-2 pt-1 border-t border-gold/10">
              <span className="inline-block w-4 h-4 rounded-full bg-imperial border border-gold-dim/60 shrink-0 text-center leading-4 text-[0.55rem] text-gold-dim font-display">
                1
              </span>
              <span className="text-parchment-deep">Other characters</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
