"use client";

import type { ColorBy } from "../geojson";
import type { LayerToggles } from "../MapView";
import { Section } from "./ui";

const COLOR_BY: { value: ColorBy; label: string }[] = [
  { value: "county", label: "County" },
  { value: "duchy", label: "Duchy" },
  { value: "kingdom", label: "Kingdom" },
  { value: "empire", label: "Empire" },
];

const LAYERS: { key: keyof LayerToggles; label: string }[] = [
  { key: "counties", label: "County colors" },
  { key: "labels", label: "Names" },
  { key: "nodes", label: "Nodes and roads" },
  { key: "references", label: "Reference images" },
  { key: "land", label: "Land" },
  { key: "coastline", label: "Coastline" },
  { key: "rivers", label: "Rivers" },
  { key: "lakes", label: "Lakes" },
];

export function DisplayPanel({
  colorBy,
  onColorBy,
  layers,
  onLayers,
}: {
  colorBy: ColorBy;
  onColorBy(value: ColorBy): void;
  layers: LayerToggles;
  onLayers(value: LayerToggles): void;
}) {
  return (
    <>
      <Section title="Color counties by">
        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_BY.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="color-by" checked={colorBy === o.value} onChange={() => onColorBy(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </Section>
      <Section title="Layers">
        {LAYERS.map((l) => (
          <label key={l.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={layers[l.key]} onChange={(e) => onLayers({ ...layers, [l.key]: e.target.checked })} />
            {l.label}
          </label>
        ))}
      </Section>
      <Section title="Borders">
        <p className="text-xs leading-relaxed text-muted">
          Thin: between counties of one duchy. Thicker: duchy, then kingdom borders. Red: empire borders. Dark: the edge of
          what&apos;s drawn.
        </p>
      </Section>
    </>
  );
}
