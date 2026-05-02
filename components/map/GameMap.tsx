"use client";

import { useActionState, useMemo, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dijkstra, pathEdgeSet } from "@/lib/game/pathfinding";
import { travelAction, TRAVEL_INITIAL_STATE } from "@/app/actions/travel";
import type { MapNodeView, MapConnectionView } from "@/lib/types/game.types";

export interface CharacterPresence {
  id: string;
  name: string;
  node_id: number | null;
}

interface Props {
  nodes: MapNodeView[];
  connections: MapConnectionView[];
  /** The node where the player's character currently stands. */
  currentNodeId: number | null;
  /** The player's character id — excluded from the "who else is here" list. */
  characterId: string;
  /** Current action points — used for disabling the Travel button. */
  characterAP: number;
  /** Controls which road tiers are accessible. */
  characterTravelTier: number;
  /** All other characters on the map and their node locations. */
  otherCharacters: CharacterPresence[];
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
  city:       "rgb(var(--color-gold))",
  fortress:   "rgb(var(--color-blood))",
  port:       "rgb(var(--color-verdigris))",
  settlement: "rgb(var(--color-parchment-dark))",
  farm:       "rgb(var(--color-parchment-deep))",
  mine:       "rgb(var(--color-ash))",
  road:       "rgb(var(--color-gold-dim))",
};

const NODE_RADIUS: Record<MapNodeView["type"], number> = {
  city:       11,
  fortress:   9,
  port:       8,
  settlement: 7,
  farm:       5,
  mine:       5,
  road:       3,
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
}: Props) {
  const router = useRouter();
  const [travelState, formAction, isTraveling] = useActionState(
    travelAction,
    TRAVEL_INITIAL_STATE,
  );

  // When travel succeeds, refresh the page so the server component re-fetches
  // the character's new position and the AP bar.
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

  // Group other characters by node for the presence indicators.
  const charsByNode = useMemo(() => {
    const m = new Map<number, CharacterPresence[]>();
    for (const ch of otherCharacters) {
      if (ch.node_id === null || ch.id === characterId) continue;
      if (!m.has(ch.node_id)) m.set(ch.node_id, []);
      m.get(ch.node_id)!.push(ch);
    }
    return m;
  }, [otherCharacters, characterId]);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = selectedId !== null ? nodesById.get(selectedId) ?? null : null;
  const current  = currentNodeId !== null ? nodesById.get(currentNodeId) ?? null : null;

  // Client-side pathfinding. Recomputes whenever the selection changes.
  const pathResult = useMemo(() => {
    if (currentNodeId === null || selectedId === null || selectedId === currentNodeId) {
      return null;
    }
    return dijkstra(connections, currentNodeId, selectedId, characterTravelTier);
  }, [selectedId, currentNodeId, connections, characterTravelTier]);

  const highlightedEdges = useMemo(
    () => (pathResult?.path ? pathEdgeSet(pathResult.path) : new Set<string>()),
    [pathResult],
  );
  const highlightedNodes = useMemo(
    () => new Set(pathResult?.path ?? []),
    [pathResult],
  );

  const canAffordTravel =
    pathResult?.reachable && characterAP >= pathResult.totalCost;

  // Characters at the selected node (for the panel, excluding self).
  const atSelectedNode =
    selectedId !== null ? (charsByNode.get(selectedId) ?? []) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* ── MAP ──────────────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <h2 className="panel-heading">Map of the realm</h2>
        <div className="panel-body p-0">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-full min-h-[420px] w-full bg-imperial-shadow"
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
                  stroke="rgba(201, 164, 76, 0.05)"
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

            <rect width={VIEW_W} height={VIEW_H} fill="url(#parchment-grid)" />

            {/* ── Connections (base layer) ── */}
            <g>
              {connections.map((c) => {
                const a = nodesById.get(c.node_a_id);
                const b = nodesById.get(c.node_b_id);
                if (!a || !b) return null;
                const edgeKey = `${Math.min(c.node_a_id, c.node_b_id)}-${Math.max(c.node_a_id, c.node_b_id)}`;
                const isOnPath = highlightedEdges.has(edgeKey);
                return (
                  <line
                    key={edgeKey}
                    x1={a.map_x}
                    y1={a.map_y}
                    x2={b.map_x}
                    y2={b.map_y}
                    stroke={
                      isOnPath
                        ? ROAD_STROKE_ACTIVE[c.road_type]
                        : ROAD_STROKE[c.road_type]
                    }
                    strokeWidth={isOnPath ? 2.5 : c.road_type === "road" ? 1.5 : 2}
                    strokeDasharray={c.road_type === "sea" ? "4 4" : undefined}
                  />
                );
              })}
            </g>

            {/* ── Glow under current node ── */}
            {current ? (
              <circle
                cx={current.map_x}
                cy={current.map_y}
                r={44}
                fill="url(#glow-current)"
              />
            ) : null}

            {/* ── Glow under path nodes ── */}
            {pathResult?.reachable
              ? pathResult.path.map((nid) => {
                  const n = nodesById.get(nid);
                  if (!n || nid === currentNodeId) return null;
                  return (
                    <circle
                      key={`glow-${nid}`}
                      cx={n.map_x}
                      cy={n.map_y}
                      r={28}
                      fill="url(#glow-path)"
                    />
                  );
                })
              : null}

            {/* ── Nodes ── */}
            <g>
              {nodes.map((n) => {
                const isCurrent  = currentNodeId === n.id;
                const isSelected = selectedId === n.id;
                const isOnPath   = highlightedNodes.has(n.id);
                const r          = NODE_RADIUS[n.type];

                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.map_x}, ${n.map_y})`}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedId(n.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={n.name ?? `Node ${n.id}`}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(n.id)}
                  >
                    {/* Selection ring */}
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

                    {/* Path highlight ring */}
                    {isOnPath && !isCurrent && !isSelected ? (
                      <circle
                        r={r + 4}
                        fill="none"
                        stroke="rgba(233, 200, 122, 0.5)"
                        strokeWidth={1}
                      />
                    ) : null}

                    {/* Node circle */}
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

                    {/* City / fortress label */}
                    {(n.type === "city" || n.type === "fortress") && n.name ? (
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

            {/* ── Character presence dots ── */}
            <g>
              {Array.from(charsByNode.entries()).map(([nodeId, chars]) => {
                const n = nodesById.get(nodeId);
                if (!n) return null;
                const r = NODE_RADIUS[n.type];
                const count = chars.length;

                return (
                  <g
                    key={`chars-${nodeId}`}
                    transform={`translate(${n.map_x + r + 5}, ${n.map_y - r - 2})`}
                    pointerEvents="none"
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
                      style={{ fontSize: 7, fontFamily: "var(--font-display)" }}
                    >
                      {count > 9 ? "9+" : count}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* ── Self marker (current character) ── */}
            {current ? (
              <g
                transform={`translate(${current.map_x}, ${current.map_y})`}
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
          </svg>
        </div>
      </div>

      {/* ── SIDE PANELS ──────────────────────────────────────── */}
      <aside className="space-y-4">

        {/* Selection info */}
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
                        <li key={ch.id} className="font-serif text-sm text-parchment-dark flex items-baseline gap-2">
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

                <div className="text-xs text-parchment-deep/50 font-mono">
                  {Math.round(selected.map_x)}, {Math.round(selected.map_y)}
                </div>
              </div>
            ) : (
              <p className="font-serif italic text-parchment-deep text-sm">
                Click a node on the map to inspect it.
              </p>
            )}
          </div>
        </section>

        {/* Travel panel — only when a remote node is selected */}
        {selected && currentNodeId !== null && selected.id !== currentNodeId ? (
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

                  {/* Route breadcrumb */}
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
                    <input type="hidden" name="target_node_id" value={selected.id} />
                    <button
                      type="submit"
                      disabled={!canAffordTravel || isTraveling}
                      className="btn-imperial w-full"
                    >
                      {isTraveling ? "On the road…" : `Travel (${pathResult.totalCost} AP)`}
                    </button>
                  </form>
                </>
              )}
            </div>
          </section>
        ) : null}

        {/* Legend */}
        <section className="panel">
          <h2 className="panel-heading">Legend</h2>
          <div className="panel-body grid grid-cols-2 gap-2 text-xs font-serif">
            {(
              [
                ["city",       "City"],
                ["fortress",   "Fortress"],
                ["port",       "Port"],
                ["settlement", "Settlement"],
                ["farm",       "Farm"],
                ["mine",       "Mine"],
                ["road",       "Waypoint"],
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

