"use client";

import { isMainNodeType } from "@1221/game-core";
import type { Selection } from "../MapView";
import { Muted, Section } from "./ui";
import { nodeName, type PanelProps } from "./SelectionPanel";

interface Problem {
  text: string;
  target?: Selection;
}

/** Map rules from GDD 3.1 that the editor allows to be broken while drawing. */
export function ProblemsPanel({ world, select, focus }: PanelProps) {
  const groups: { title: string; items: Problem[] }[] = [];
  const counties = [...world.counties.values()];

  groups.push({
    title: "Counties without a main node",
    items: counties.filter((c) => c.main_node_id == null).map((c) => ({ text: c.name, target: { kind: "county", id: c.id } })),
  });
  groups.push({
    title: "Counties without a duchy",
    items: counties.filter((c) => c.duchy_id == null).map((c) => ({ text: c.name, target: { kind: "county", id: c.id } })),
  });
  groups.push({
    title: "Counties without a shape",
    items: counties.filter((c) => !world.polygons.get(c.id)?.length).map((c) => ({ text: c.name, target: { kind: "county", id: c.id } })),
  });
  groups.push({
    title: "Main-type nodes that aren't their county's main node",
    items: [...world.nodes.values()]
      .filter((n) => isMainNodeType(n.type) && (n.county_id == null || world.counties.get(n.county_id)?.main_node_id !== n.id))
      .map((n) => ({ text: `${nodeName(n)} (${n.type})`, target: { kind: "node", id: n.id } })),
  });
  groups.push({
    title: "Nodes outside every county",
    items: [...world.nodes.values()].filter((n) => n.county_id == null).map((n) => ({ text: nodeName(n), target: { kind: "node", id: n.id } })),
  });
  groups.push({
    title: "Duchies without 2–3 counties",
    items: [...world.duchies.values()]
      .map((d) => ({ d, n: counties.filter((c) => c.duchy_id === d.id).length }))
      .filter(({ n }) => n < 2 || n > 3)
      .map(({ d, n }) => ({ text: `${d.name}: ${n}` })),
  });
  groups.push({
    title: "Duchies without a main county",
    items: [...world.duchies.values()].filter((d) => d.main_county_id == null).map((d) => ({ text: d.name })),
  });

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return (
      <Section title="Problems">
        <Muted>Nothing to fix.</Muted>
      </Section>
    );
  }
  return (
    <>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <Section key={g.title} title={`${g.title} (${g.items.length})`}>
            <ul className="flex flex-col gap-0.5 text-sm">
              {g.items.slice(0, 50).map((item, i) => (
                <li key={i}>
                  {item.target ? (
                    <button
                      className="text-left hover:underline"
                      onClick={() => {
                        select(item.target!);
                        focus(item.target!);
                      }}
                    >
                      {item.text}
                    </button>
                  ) : (
                    item.text
                  )}
                </li>
              ))}
              {g.items.length > 50 ? <li className="text-muted">…and {g.items.length - 50} more</li> : null}
            </ul>
          </Section>
        ))}
    </>
  );
}
