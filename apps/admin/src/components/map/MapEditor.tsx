"use client";

import { GitBranch, LogOut, MapPin, MousePointer2, Pentagon, RefreshCw, Route, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BIOMES, MAIN_NODE_TYPES, NODE_TYPES, type Biome, type NodeType } from "@1221/game-core";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { createActions } from "./api";
import type { ColorBy } from "./geojson";
import { MapView, type LayerToggles, type MapController, type Selection, type Tool } from "./MapView";
import { DisplayPanel } from "./panels/DisplayPanel";
import { HierarchyPanel } from "./panels/HierarchyPanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import { ReferencesPanel } from "./panels/ReferencesPanel";
import { SelectionPanel, nodeName } from "./panels/SelectionPanel";
import { SelectInput, label } from "./panels/ui";
import { World } from "./world";

const TOOLS: { id: Tool; name: string; key: string; icon: LucideIcon }[] = [
  { id: "select", name: "Select and move", key: "V", icon: MousePointer2 },
  { id: "county", name: "Draw a county", key: "C", icon: Pentagon },
  { id: "node", name: "Add a node", key: "N", icon: MapPin },
  { id: "branch", name: "Branch a node from the selected node", key: "B", icon: GitBranch },
  { id: "road", name: "Join two nodes with a road", key: "R", icon: Route },
];

type Tab = "selection" | "hierarchy" | "references" | "display" | "problems";
const TABS: { id: Tab; name: string }[] = [
  { id: "selection", name: "Selected" },
  { id: "hierarchy", name: "Tiers" },
  { id: "references", name: "References" },
  { id: "display", name: "Display" },
  { id: "problems", name: "Problems" },
];

/** Whether the selected row still exists (it may have been deleted or merged away). */
function exists(world: World, s: Selection | null): s is Selection {
  if (!s) return false;
  const table = { county: world.counties, node: world.nodes, road: world.roads, point: world.points, edge: world.edges }[s.kind];
  return table.has(s.id);
}

export function MapEditor({ email }: { email: string }) {
  const world = useMemo(() => new World(), []);
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const actions = useMemo(() => createActions(supabase, world), [supabase, world]);
  const version = useSyncExternalStore(world.subscribe, world.getVersion, world.getVersion);
  const controller = useRef<MapController | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [rawSelection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>("hierarchy");
  const [colorBy, setColorBy] = useState<ColorBy>("duchy");
  const [layers, setLayers] = useState<LayerToggles>({
    land: true,
    coastline: true,
    rivers: true,
    lakes: true,
    references: true,
    counties: true,
    labels: true,
    nodes: true,
  });
  const [nodeDefaults, setNodeDefaults] = useState<{ type: NodeType; biome: Biome }>({ type: "crossroads", biome: "plains" });
  const [ringTarget, setRingTarget] = useState<number | null>(null);
  const [editingReference, setEditingReference] = useState<number | null>(null);

  const selection = exists(world, rawSelection) ? rawSelection : null;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      await actions.load();
      setLoaded(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [actions]);

  useEffect(() => {
    let cancelled = false;
    actions.load().then(
      () => !cancelled && setLoaded(true),
      (e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [actions]);

  const run = useCallback(async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      await task();
      return true;
    } catch (e) {
      setMessage({ tone: "error", text: `${label}: ${e instanceof Error ? e.message : String(e)}` });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  const select = useCallback((s: Selection | null) => {
    setSelection(s);
    if (s) setTab("selection");
  }, []);

  const hint = useCallback((text: string | null) => setMessage(text ? { tone: "info", text } : null), []);

  const focus = useCallback(
    (s: Selection) => {
      let box: [number, number, number, number] | null = null;
      if (s.kind === "county") box = world.countyBounds(s.id);
      else if (s.kind === "node") {
        const n = world.nodes.get(s.id);
        if (n) box = [n.lon - 0.3, n.lat - 0.2, n.lon + 0.3, n.lat + 0.2];
      } else if (s.kind === "point") {
        const p = world.points.get(s.id);
        if (p) box = [p.lon - 0.3, p.lat - 0.2, p.lon + 0.3, p.lat + 0.2];
      }
      if (box) controller.current?.fitBounds(box);
    },
    [world],
  );

  const changeTool = useCallback((t: Tool) => {
    setTool(t);
    setMessage(null);
    if (t !== "county") setRingTarget(null);
  }, []);

  const deleteSelection = useCallback(async () => {
    const s = exists(world, rawSelection) ? rawSelection : null;
    if (!s) return;
    switch (s.kind) {
      case "point":
        if (await run("Remove point", () => actions.deletePoint(s.id))) setSelection(null);
        return;
      case "road":
        if (await run("Delete road", () => actions.deleteRoad(s.id))) setSelection(null);
        return;
      case "node": {
        const node = world.nodes.get(s.id);
        if (window.confirm(`Delete ${nodeName(node)} and its roads?`) && (await run("Delete node", () => actions.deleteNode(s.id)))) setSelection(null);
        return;
      }
      case "county": {
        const county = world.counties.get(s.id);
        if (
          window.confirm(`Delete ${county?.name}? Borders shared with neighbors stay; its nodes stay without a county.`) &&
          (await run("Delete county", () => actions.deleteCounty(s.id)))
        )
          setSelection(null);
        return;
      }
      case "edge":
        hint("Border segments go with their points or counties: remove a point, or delete a county.");
    }
  }, [world, rawSelection, run, actions, hint]);

  const addRing = useCallback(
    (countyId: number) => {
      setRingTarget(countyId);
      setTool("county");
    },
    [],
  );

  const panelProps = { world, version, actions, run, select, focus };
  const ringCounty = ringTarget == null ? undefined : world.counties.get(ringTarget);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <h1 className="text-sm font-semibold">Project 1221 · Map editor</h1>
        <span className="text-xs text-muted">
          {world.counties.size} counties · {world.duchies.size} duchies · {world.kingdoms.size} kingdoms · {world.empires.size} empires ·{" "}
          {world.nodes.size} nodes · {world.roads.size} roads
        </span>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {busy ? `${busy}…` : loaded ? "All changes saved" : "Loading…"}
        </span>
        <button
          className="rounded-md p-1.5 text-muted hover:bg-ground"
          title="Reload the map from the database"
          aria-label="Reload"
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
        <span className="text-xs text-muted">{email}</span>
        <form action="/auth/signout" method="post">
          <button className="rounded-md p-1.5 text-muted hover:bg-ground" title="Sign out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </form>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={`${t.name} (${t.key})`}
              aria-label={t.name}
              aria-pressed={tool === t.id}
              onClick={() => changeTool(t.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-md ${tool === t.id ? "bg-accent text-white" : "text-ink hover:bg-ground"}`}
            >
              <t.icon size={18} />
            </button>
          ))}
        </nav>

        <main className="relative min-w-0 flex-1">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-danger">Couldn&apos;t load the map: {loadError}</p>
              <button className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : (
            <MapView
              world={world}
              version={version}
              actions={actions}
              tool={tool}
              selection={selection}
              colorBy={colorBy}
              layers={layers}
              nodeDefaults={nodeDefaults}
              ringTarget={ringTarget}
              editingReference={editingReference}
              controller={controller}
              onSelect={select}
              onTool={changeTool}
              onDeleteSelection={() => void deleteSelection()}
              onDrawingDone={() => setRingTarget(null)}
              onHint={hint}
              run={run}
            />
          )}

          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-sm">
              <ToolHint tool={tool} ringCounty={ringCounty?.name} selectedNode={selection?.kind === "node" ? nodeName(world.nodes.get(selection.id)) : null} />
              {tool === "node" || tool === "branch" ? (
                <div className="flex items-center gap-2">
                  <div className="w-36">
                    <SelectInput<NodeType>
                      ariaLabel="New node type"
                      value={nodeDefaults.type}
                      options={NODE_TYPES.map((t) => ({ value: t, label: `${label(t)}${(MAIN_NODE_TYPES as readonly string[]).includes(t) ? " (main)" : ""}` }))}
                      onChange={(type) => setNodeDefaults((d) => ({ ...d, type }))}
                    />
                  </div>
                  <div className="w-32">
                    <SelectInput<Biome>
                      ariaLabel="New node biome"
                      value={nodeDefaults.biome}
                      options={BIOMES.map((b) => ({ value: b, label: label(b) }))}
                      onChange={(biome) => setNodeDefaults((d) => ({ ...d, biome }))}
                    />
                  </div>
                </div>
              ) : null}
              {ringCounty ? (
                <button className="flex items-center gap-1 text-accent" onClick={() => setRingTarget(null)}>
                  <X size={12} /> stop adding to {ringCounty.name}
                </button>
              ) : null}
            </div>
            {message ? (
              <div
                role={message.tone === "error" ? "alert" : "status"}
                className={`pointer-events-auto flex max-w-xl items-start gap-2 rounded-lg px-3 py-2 text-sm shadow-sm ${
                  message.tone === "error" ? "bg-danger-soft text-danger" : "bg-panel text-ink"
                }`}
              >
                <span>{message.text}</span>
                <button aria-label="Dismiss" onClick={() => setMessage(null)}>
                  <X size={14} />
                </button>
              </div>
            ) : null}
          </div>
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
          <div className="flex shrink-0 border-b border-line text-xs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 px-1 py-2.5 font-medium ${tab === t.id ? "border-b-2 border-accent text-ink" : "text-muted hover:text-ink"}`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "selection" ? (
              selection ? (
                <SelectionPanel
                  {...panelProps}
                  selection={selection}
                  onTool={changeTool}
                  onAddRing={addRing}
                  onDelete={() => void deleteSelection()}
                />
              ) : (
                <p className="p-4 text-sm text-muted">Nothing selected. Click a county, border point, node or road.</p>
              )
            ) : null}
            {tab === "hierarchy" ? <HierarchyPanel {...panelProps} /> : null}
            {tab === "references" ? (
              <ReferencesPanel {...panelProps} controller={controller} editing={editingReference} onEdit={setEditingReference} />
            ) : null}
            {tab === "display" ? <DisplayPanel colorBy={colorBy} onColorBy={setColorBy} layers={layers} onLayers={setLayers} /> : null}
            {tab === "problems" ? <ProblemsPanel {...panelProps} /> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ToolHint({ tool, ringCounty, selectedNode }: { tool: Tool; ringCounty?: string; selectedNode: string | null }) {
  switch (tool) {
    case "select":
      return (
        <span>
          Click to select · drag points and nodes · drop a point on another to glue them · double-click a border to add a point ·
          Delete removes
        </span>
      );
    case "county":
      return (
        <span>
          {ringCounty ? <strong>Adding an area to {ringCounty}. </strong> : null}
          Click to place points; they snap to borders and the coast and follow them between clicks · click the first point or
          press Enter to finish · Backspace undoes · Shift: straight line · Alt: no snapping
        </span>
      );
    case "node":
      return <span>Click the map to add a node:</span>;
    case "branch":
      return <span>{selectedNode ? `Click to add a node joined to ${selectedNode}:` : "Select a node first, then click to branch from it:"}</span>;
    case "road":
      return <span>Click a node, then another, to join them with a road.</span>;
  }
}
