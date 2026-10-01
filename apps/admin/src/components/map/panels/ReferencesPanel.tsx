"use client";

import { Eye, EyeOff, Move, Trash2, Upload } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import type { MapController } from "../MapView";
import { Button, Field, Muted, Section, TextInput } from "./ui";
import type { PanelProps } from "./SelectionPanel";

/** WebGL can't show textures above this size on many GPUs; bigger images are scaled down. */
const MAX_SIDE = 8192;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  if (width <= MAX_SIDE && height <= MAX_SIDE) return { blob: file, width, height };
  const scale = MAX_SIDE / Math.max(width, height);
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { blob: await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }), width, height };
}

export function ReferencesPanel({
  world,
  actions,
  run,
  controller,
  editing,
  onEdit,
}: PanelProps & { controller: RefObject<MapController | null>; editing: number | null; onEdit(id: number | null): void }) {
  const refs = [...world.references.values()].sort((a, b) => a.sort - b.sort || a.id - b.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tileUrl, setTileUrl] = useState("");

  const upload = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      window.alert("Use a PNG, JPEG or WebP image.");
      return;
    }
    await run("Upload reference", async () => {
      const { blob, width, height } = await prepareImage(file);
      const box = controller.current?.boxForImage(width, height);
      if (!box) throw new Error("The map isn't ready yet");
      await actions.addReferenceImage(blob, file.name.replace(/\.[^.]+$/, ""), box);
    });
    const added = [...world.references.values()].sort((a, b) => b.id - a.id)[0];
    if (added) onEdit(added.id);
  };

  return (
    <>
      <Section title="Reference images">
        <Muted>
          Historical maps under the counties, for tracing. Upload an image and stretch it over the coastline with its
          handles, or add a tile layer of a map someone already georeferenced (Allmaps, MapWarper, David Rumsey).
        </Muted>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button tone="accent" onClick={() => fileInput.current?.click()}>
          <Upload size={14} /> Upload an image
        </Button>
        <Field label="Or an XYZ tile URL">
          <input
            className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm outline-none focus:border-accent"
            placeholder="https://…/{z}/{x}/{y}.png"
            value={tileUrl}
            onChange={(e) => setTileUrl(e.target.value)}
          />
        </Field>
        <Button
          disabled={!/^https:\/\/.+\{z\}.+\{x\}.+\{y\}/.test(tileUrl)}
          onClick={() =>
            void run("Add tile layer", async () => {
              await actions.addReferenceTiles(new URL(tileUrl).hostname, tileUrl);
              setTileUrl("");
            })
          }
        >
          Add tile layer
        </Button>
      </Section>
      {refs.map((ref) => (
        <Section
          key={ref.id}
          title={ref.kind === "image" ? "Image" : "Tile layer"}
          actions={
            <Button
              aria-label={ref.visible ? "Hide" : "Show"}
              title={ref.visible ? "Hide" : "Show"}
              onClick={() => void run("Save reference", () => actions.updateReference(ref.id, { visible: !ref.visible }))}
            >
              {ref.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </Button>
          }
        >
          <TextInput value={ref.name} ariaLabel="Reference name" onCommit={(name) => name && void run("Rename", () => actions.updateReference(ref.id, { name }))} />
          <Field label={`Opacity ${Math.round(ref.opacity * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={ref.opacity}
              onPointerUp={(e) => void run("Save reference", () => actions.updateReference(ref.id, { opacity: Number(e.currentTarget.value) }))}
              onKeyUp={(e) => void run("Save reference", () => actions.updateReference(ref.id, { opacity: Number(e.currentTarget.value) }))}
            />
          </Field>
          <div className="flex gap-2">
            {ref.kind === "image" ? (
              <Button tone={editing === ref.id ? "accent" : "default"} onClick={() => onEdit(editing === ref.id ? null : ref.id)}>
                <Move size={14} /> {editing === ref.id ? "Done placing" : "Place"}
              </Button>
            ) : null}
            <Button
              tone="danger"
              aria-label="Delete reference"
              onClick={() => {
                if (window.confirm(`Delete ${ref.name}?`)) {
                  if (editing === ref.id) onEdit(null);
                  void run("Delete reference", () => actions.deleteReference(ref));
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
          {editing === ref.id ? <Muted>Drag the corners to stretch it and the middle handle to move it.</Muted> : null}
        </Section>
      ))}
    </>
  );
}
