"use client";

import { Crosshair, GitBranch, Plus, Trash2 } from "lucide-react";
import { BIOMES, MAIN_NODE_TYPES, NODE_TYPES, TRAVEL_NODE_TYPES, isMainNodeType, type Biome, type NodeType } from "@1221/game-core";
import type { EditorActions } from "../api";
import type { Selection, Tool } from "../MapView";
import type { County, MapNode, World } from "../world";
import { Button, Field, Muted, NONE, Section, SelectInput, TextInput, idValue, label, valueId } from "./ui";

export interface PanelProps {
  world: World;
  version: number;
  actions: EditorActions;
  run(label: string, task: () => Promise<unknown>): Promise<boolean>;
  select(selection: Selection | null): void;
  focus(selection: Selection): void;
}

interface SelectionPanelProps extends PanelProps {
  selection: Selection;
  onTool(tool: Tool): void;
  onAddRing(countyId: number): void;
  onDelete(): void;
}

export function SelectionPanel(props: SelectionPanelProps) {
  const { selection, world } = props;
  switch (selection.kind) {
    case "county": {
      const county = world.counties.get(selection.id);
      return county ? <CountyPanel {...props} county={county} /> : null;
    }
    case "node": {
      const node = world.nodes.get(selection.id);
      return node ? <NodePanel {...props} node={node} /> : null;
    }
    case "road":
      return <RoadPanel {...props} />;
    case "point":
      return <PointPanel {...props} />;
    case "edge":
      return <EdgePanel {...props} />;
  }
}

export const nodeName = (node: MapNode | undefined) => (node ? node.name || `Unnamed ${node.type}` : "—");

function CountyPanel({ world, county, actions, run, focus, select, onAddRing, onDelete }: SelectionPanelProps & { county: County }) {
  const save = (fields: Parameters<EditorActions["updateCounty"]>[1]) => run("Save county", () => actions.updateCounty(county.id, fields));
  const nodes = [...world.nodes.values()].filter((n) => n.county_id === county.id);
  const main = county.main_node_id == null ? undefined : world.nodes.get(county.main_node_id);
  const duchies = [...world.duchies.values()].sort((a, b) => a.name.localeCompare(b.name));
  const pieces = world.polygons.get(county.id)?.length ?? 0;

  return (
    <>
      <Section
        title="County"
        actions={
          <Button aria-label="Zoom to county" title="Zoom to county" onClick={() => focus({ kind: "county", id: county.id })}>
            <Crosshair size={14} />
          </Button>
        }
      >
        <Field label="Name">
          <TextInput value={county.name} onCommit={(name) => name && void save({ name })} />
        </Field>
        <Field label="Duchy">
          <SelectInput
            value={idValue(county.duchy_id)}
            options={[{ value: NONE, label: "No duchy" }, ...duchies.map((d) => ({ value: String(d.id), label: d.name }))]}
            onChange={(v) => void save({ duchy_id: valueId(v) })}
          />
        </Field>
        <Field label="Culture of the people">
          <SelectInput
            value={county.culture_id ?? NONE}
            options={[{ value: NONE, label: "Not set" }, ...world.cultures.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => void save({ culture_id: v === NONE ? null : v })}
          />
        </Field>
        <Field label="Religion of the people">
          <SelectInput
            value={county.religion_id ?? NONE}
            options={[{ value: NONE, label: "Not set" }, ...world.religions.map((r) => ({ value: r.id, label: r.name }))]}
            onChange={(v) => void save({ religion_id: v === NONE ? null : v })}
          />
        </Field>
        <Field label="Main node (controls the county)">
          {main ? (
            <button className="text-left text-sm text-ink underline-offset-2 hover:underline" onClick={() => select({ kind: "node", id: main.id })}>
              {nodeName(main)} · {main.type}
            </button>
          ) : (
            <Muted>None yet. Add a town, castle, mine, farm or monastery inside the county and it becomes the main node.</Muted>
          )}
        </Field>
        <Muted>
          {nodes.length} node{nodes.length === 1 ? "" : "s"} · {pieces} piece{pieces === 1 ? "" : "s"}
        </Muted>
      </Section>
      <Section title="Shape">
        <Button onClick={() => onAddRing(county.id)}>
          <Plus size={14} /> Add an area (island or extension)
        </Button>
        <Muted>Drag its points to reshape it; drop a point on a neighbor&apos;s point to glue them. Double-click a border to add a point.</Muted>
      </Section>
      <Section title="Danger">
        <Button tone="danger" onClick={onDelete}>
          <Trash2 size={14} /> Delete county
        </Button>
      </Section>
    </>
  );
}

function NodePanel({ world, node, actions, run, select, onTool, onDelete }: SelectionPanelProps & { node: MapNode }) {
  const save = (changes: Partial<MapNode>) => run("Save node", () => actions.updateNode({ ...node, ...changes }));
  const county = node.county_id == null ? undefined : world.counties.get(node.county_id);
  const isMain = county?.main_node_id === node.id;
  // Only the county's main node has a main type (GDD 3.1).
  const mainAllowed = county != null && (isMain || county.main_node_id == null);
  const roads = [...world.roads.values()].filter((r) => r.node_a === node.id || r.node_b === node.id);

  return (
    <>
      <Section title={isMain ? "Main node" : "Node"}>
        <Field label="Name">
          <TextInput value={node.name ?? ""} placeholder={`Unnamed ${node.type}`} onCommit={(name) => void save({ name: name || null })} />
        </Field>
        <Field label="Type">
          <SelectInput<NodeType>
            value={node.type}
            options={NODE_TYPES.map((t) => ({
              value: t,
              label: `${label(t)}${isMainNodeType(t) ? " (main)" : ""}`,
              disabled: isMainNodeType(t) && !mainAllowed,
            }))}
            onChange={(type) => void save({ type })}
          />
        </Field>
        {!mainAllowed ? (
          <Muted>
            {county
              ? `${county.name} already has its main node, so this one is a travel node (${TRAVEL_NODE_TYPES.join(", ")}).`
              : `Outside every county: only travel types. Main types (${MAIN_NODE_TYPES.join(", ")}) need a county.`}
          </Muted>
        ) : null}
        <Field label="Biome">
          <SelectInput<Biome> value={node.biome} options={BIOMES.map((b) => ({ value: b, label: label(b) }))} onChange={(biome) => void save({ biome })} />
        </Field>
        <Field label="County">
          {county ? (
            <button className="text-left text-sm text-ink underline-offset-2 hover:underline" onClick={() => select({ kind: "county", id: county.id })}>
              {county.name}
            </button>
          ) : (
            <Muted>Outside every county.</Muted>
          )}
        </Field>
      </Section>
      <Section title={`Roads (${roads.length})`}>
        {roads.map((r) => {
          const other = world.nodes.get(r.node_a === node.id ? r.node_b : r.node_a);
          return (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <button className="truncate text-left hover:underline" onClick={() => other && select({ kind: "node", id: other.id })}>
                to {nodeName(other)}
              </button>
              <Button tone="danger" aria-label="Remove road" onClick={() => void run("Remove road", () => actions.deleteRoad(r.id))}>
                <Trash2 size={13} />
              </Button>
            </div>
          );
        })}
        <Button onClick={() => onTool("branch")}>
          <GitBranch size={14} /> Branch a new node from here
        </Button>
        <Muted>Or use the road tool (R): click this node, then another.</Muted>
      </Section>
      <Section title="Danger">
        <Button tone="danger" onClick={onDelete}>
          <Trash2 size={14} /> Delete node
        </Button>
      </Section>
    </>
  );
}

function RoadPanel({ world, selection, select, onDelete }: SelectionPanelProps) {
  const road = world.roads.get(selection.id);
  if (!road) return null;
  const a = world.nodes.get(road.node_a);
  const b = world.nodes.get(road.node_b);
  return (
    <Section title="Road">
      <div className="flex flex-col gap-1 text-sm">
        <button className="text-left hover:underline" onClick={() => a && select({ kind: "node", id: a.id })}>
          {nodeName(a)}
        </button>
        <button className="text-left hover:underline" onClick={() => b && select({ kind: "node", id: b.id })}>
          {nodeName(b)}
        </button>
      </div>
      <Button tone="danger" onClick={onDelete}>
        <Trash2 size={14} /> Delete road
      </Button>
    </Section>
  );
}

function PointPanel({ world, selection, onDelete }: SelectionPanelProps) {
  const point = world.points.get(selection.id);
  if (!point) return null;
  const counties = new Set<string>();
  for (const id of world.edgesByPoint.get(point.id) ?? []) {
    const edge = world.edges.get(id);
    for (const c of [edge?.left_county_id, edge?.right_county_id]) {
      if (c != null) counties.add(world.counties.get(c)?.name ?? `#${c}`);
    }
  }
  return (
    <Section title="Border point">
      <Muted>
        {point.lat.toFixed(4)}° N, {point.lon.toFixed(4)}° E · shared by {[...counties].join(", ") || "no county"}
      </Muted>
      <Muted>Drag to move it for every county that uses it. Drop it on another point to glue them.</Muted>
      <Button tone="danger" onClick={onDelete}>
        <Trash2 size={14} /> Remove point
      </Button>
    </Section>
  );
}

function EdgePanel({ world, selection, select }: SelectionPanelProps) {
  const edge = world.edges.get(selection.id);
  if (!edge) return null;
  const side = (id: number | null) => {
    const county = id == null ? undefined : world.counties.get(id);
    return county ? (
      <button className="text-left hover:underline" onClick={() => select({ kind: "county", id: county.id })}>
        {county.name}
      </button>
    ) : (
      <span className="text-muted">outside</span>
    );
  };
  return (
    <Section title="Border segment">
      <div className="flex flex-col gap-1 text-sm">
        <span>Between {side(edge.left_county_id)}</span>
        <span>and {side(edge.right_county_id)}</span>
      </div>
      <Muted>Double-click the border to add a point on it.</Muted>
    </Section>
  );
}
