"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TierKind } from "../world";
import { Button, Muted, NONE, Section, SelectInput, TextInput, idValue, valueId } from "./ui";
import type { PanelProps } from "./SelectionPanel";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Empires, kingdoms and duchies: names, links up the hierarchy, main counties. */
export function HierarchyPanel({ world, actions, run }: PanelProps) {
  const empires = [...world.empires.values()].sort(byName);
  const kingdoms = [...world.kingdoms.values()].sort(byName);
  const duchies = [...world.duchies.values()].sort(byName);
  const counties = [...world.counties.values()];

  const remove = (kind: TierKind, id: number, name: string) => {
    if (window.confirm(`Delete ${name}? What it contains stays, unassigned.`)) void run(`Delete ${name}`, () => actions.deleteTier(kind, id));
  };
  const rename = (kind: TierKind, id: number) => (name: string) => name && void run("Rename", () => actions.updateTier(kind, id, { name }));

  return (
    <>
      <Muted>
        <span className="block px-4 pt-3">
          Only counties are drawn. Put counties in duchies, duchies in kingdoms and kingdoms in empires; their borders are
          computed from the counties. Color the map by tier under Display.
        </span>
      </Muted>
      <Section title={`Empires (${empires.length})`} actions={<AddButton onAdd={(name) => run("Add empire", () => actions.createTier("empires", name, null))} />}>
        {empires.map((e) => (
          <Row key={e.id} onDelete={() => remove("empires", e.id, e.name)}>
            <TextInput value={e.name} ariaLabel="Empire name" onCommit={rename("empires", e.id)} />
            <Muted>{kingdoms.filter((k) => k.empire_id === e.id).length} kingdoms</Muted>
          </Row>
        ))}
      </Section>
      <Section title={`Kingdoms (${kingdoms.length})`} actions={<AddButton onAdd={(name) => run("Add kingdom", () => actions.createTier("kingdoms", name, null))} />}>
        {kingdoms.map((k) => (
          <Row key={k.id} onDelete={() => remove("kingdoms", k.id, k.name)}>
            <TextInput value={k.name} ariaLabel="Kingdom name" onCommit={rename("kingdoms", k.id)} />
            <SelectInput
              ariaLabel="Empire"
              value={idValue(k.empire_id)}
              options={[{ value: NONE, label: "No empire" }, ...empires.map((e) => ({ value: String(e.id), label: e.name }))]}
              onChange={(v) => void run("Save kingdom", () => actions.updateTier("kingdoms", k.id, { empire_id: valueId(v) }))}
            />
            <Muted>{duchies.filter((d) => d.kingdom_id === k.id).length} duchies</Muted>
          </Row>
        ))}
      </Section>
      <Section title={`Duchies (${duchies.length})`} actions={<AddButton onAdd={(name) => run("Add duchy", () => actions.createTier("duchies", name, null))} />}>
        {duchies.map((d) => {
          const members = counties.filter((c) => c.duchy_id === d.id).sort(byName);
          return (
            <Row key={d.id} onDelete={() => remove("duchies", d.id, d.name)}>
              <TextInput value={d.name} ariaLabel="Duchy name" onCommit={rename("duchies", d.id)} />
              <SelectInput
                ariaLabel="Kingdom"
                value={idValue(d.kingdom_id)}
                options={[{ value: NONE, label: "No kingdom" }, ...kingdoms.map((k) => ({ value: String(k.id), label: k.name }))]}
                onChange={(v) => void run("Save duchy", () => actions.updateTier("duchies", d.id, { kingdom_id: valueId(v) }))}
              />
              <SelectInput
                ariaLabel="Main county"
                value={idValue(d.main_county_id)}
                options={[
                  { value: NONE, label: members.length ? "Main county: not set" : "Main county: add counties first" },
                  ...members.map((c) => ({ value: String(c.id), label: `Main county: ${c.name}` })),
                ]}
                onChange={(v) => void run("Save duchy", () => actions.updateTier("duchies", d.id, { main_county_id: valueId(v) }))}
              />
              <Muted>{members.length} counties</Muted>
            </Row>
          );
        })}
      </Section>
    </>
  );
}

function Row({ children, onDelete }: { children: ReactNode; onDelete(): void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
      <Button tone="danger" aria-label="Delete" onClick={onDelete}>
        <Trash2 size={13} />
      </Button>
    </div>
  );
}

function AddButton({ onAdd }: { onAdd(name: string): Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        const name = window.prompt("Name")?.trim();
        if (!name) return;
        setBusy(true);
        await onAdd(name);
        setBusy(false);
      }}
    >
      <Plus size={14} /> Add
    </Button>
  );
}
