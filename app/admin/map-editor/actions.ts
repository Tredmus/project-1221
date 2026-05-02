"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/game/admin";
import type { Json } from "@/lib/types/database.types";
import { NODE_TYPES } from "@/lib/types/game.types";

const MAX_VERTICES = 800;

const MAP_EDITOR_REF_BUCKET = "map-editor-reference";

const REF_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const REF_SCALE_MIN = 0.08;
const REF_SCALE_MAX = 128;

export interface PolygonSaveResult {
  error: string | null;
  ok: boolean;
}

function validateRing(
  ring: unknown,
): { ok: true; ring: [number, number][] } | { ok: false; error: string } {
  if (!Array.isArray(ring)) {
    return { ok: false, error: "Polygon must be an array." };
  }
  if (ring.length < 3) {
    return { ok: false, error: "A closed county needs at least three vertices." };
  }
  if (ring.length > MAX_VERTICES) {
    return { ok: false, error: `At most ${MAX_VERTICES} vertices allowed.` };
  }
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const pair = ring[i];
    if (!Array.isArray(pair) || pair.length < 2) {
      return { ok: false, error: `Invalid vertex at index ${i}.` };
    }
    const x = Number(pair[0]);
    const y = Number(pair[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: `Non-finite coordinate at index ${i}.` };
    }
    out.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  }
  return { ok: true, ring: out };
}

export async function updateCountyPolygonAction(
  countyId: number,
  ring: unknown,
): Promise<PolygonSaveResult> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { error: "Forbidden.", ok: false };
  }

  if (!Number.isFinite(countyId) || countyId < 1) {
    return { error: "Invalid county.", ok: false };
  }

  const validated = validateRing(ring);
  if (!validated.ok) {
    return { error: validated.error, ok: false };
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("counties")
    .update({ map_polygon: validated.ring as unknown as Json })
    .eq("id", countyId);

  if (error) {
    console.error("[map-editor] update county", error);
    return { error: error.message, ok: false };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");

  return { error: null, ok: true };
}

export interface CreateCountyResult {
  error: string | null;
  ok: boolean;
  id: number | null;
}

const NAME_MAX = 120;

export async function createCountyAction(
  name: string,
  regionId: number | null,
): Promise<CreateCountyResult> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { error: "Forbidden.", ok: false, id: null };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Name is required.", ok: false, id: null };
  }
  if (trimmed.length > NAME_MAX) {
    return { error: `Name must be at most ${NAME_MAX} characters.`, ok: false, id: null };
  }

  if (
    regionId !== null &&
    (!Number.isFinite(regionId) || regionId < 1)
  ) {
    return { error: "Invalid region.", ok: false, id: null };
  }

  const admin = createAdminSupabase();

  const insertRow = {
    name: trimmed,
    owner_type: "independent" as const,
    map_x: 500,
    map_y: 400,
    ...(regionId !== null ? { region_id: regionId } : {}),
  };

  const { data, error } = await admin
    .from("counties")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    console.error("[map-editor] create county", error);
    return { error: error.message, ok: false, id: null };
  }

  const id = data?.id;
  if (id === undefined || id === null || typeof id !== "number") {
    return { error: "Insert did not return an id.", ok: false, id: null };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");

  return { error: null, ok: true, id };
}

const REF_OBJECT_PATH_RE = /^reference\/current\.(jpg|png|webp|gif)$/;

function referenceExtFromMime(mime: string): string | null {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/jpeg") return "jpg";
  return null;
}

/**
 * Step 1 of 2: mint a signed upload URL so the browser can PUT the file
 * straight to Storage (avoids Next.js Server Action body limits).
 */
export async function beginMapEditorReferenceUploadAction(
  contentType: string,
  byteLength: number,
): Promise<
  | {
      ok: true;
      objectPath: string;
      /** Full upload URL (includes token). Use fetch PUT, not the browser user JWT. */
      signedUrl: string;
    }
  | { ok: false; error: string }
> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { ok: false, error: "Choose a valid image file." };
  }
  if (byteLength > REF_UPLOAD_MAX_BYTES) {
    return { ok: false, error: "File exceeds 100 MB limit." };
  }

  const ext = referenceExtFromMime(contentType);
  if (!ext) {
    return { ok: false, error: "Use JPEG, PNG, WebP, or GIF." };
  }

  const objectPath = `reference/current.${ext}`;
  const admin = createAdminSupabase();

  const { data: row, error: settingsErr } = await admin
    .from("map_editor_settings")
    .select("reference_storage_path")
    .eq("id", 1)
    .maybeSingle();

  if (settingsErr) {
    console.error("[map-editor] map_editor_settings", settingsErr);
    const hint = settingsErr.message.includes("permission denied")
      ? " Run migration 018_map_editor_settings_service_role.sql (GRANT for service_role)."
      : " If the table is missing, apply migration 017_map_editor_reference_storage.sql.";
    return {
      ok: false,
      error: `${settingsErr.message}${hint}`,
    };
  }

  const oldPath = row?.reference_storage_path as string | null | undefined;
  if (oldPath && oldPath !== objectPath) {
    await admin.storage.from(MAP_EDITOR_REF_BUCKET).remove([oldPath]);
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(MAP_EDITOR_REF_BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (signErr || !signed?.signedUrl) {
    console.error("[map-editor] createSignedUploadUrl", signErr);
    const hint =
      signErr?.message?.toLowerCase().includes("not found") ||
      signErr?.message?.toLowerCase().includes("does not exist")
        ? " Create the Storage bucket `map-editor-reference` (migration 017)."
        : "";
    return {
      ok: false,
      error: `${signErr?.message ?? "Could not start upload."}${hint}`,
    };
  }

  return { ok: true, objectPath, signedUrl: signed.signedUrl };
}

/**
 * Step 2 of 2: after the browser finishes uploading bytes to Storage, attach
 * the object path to map_editor_settings.
 */
export async function completeMapEditorReferenceUploadAction(
  objectPath: string,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!REF_OBJECT_PATH_RE.test(objectPath)) {
    return { ok: false, error: "Invalid storage path." };
  }

  const admin = createAdminSupabase();
  const { error: dbErr } = await admin
    .from("map_editor_settings")
    .update({
      reference_storage_path: objectPath,
      reference_pan_x: 0,
      reference_pan_y: 0,
      reference_scale: 1,
      reference_opacity: 0.38,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (dbErr) {
    console.error("[map-editor] settings after signed upload", dbErr);
    return { ok: false, error: dbErr.message };
  }

  revalidatePath("/admin/map-editor");
  return { ok: true, error: null };
}

export async function updateMapEditorReferenceTransformAction(
  panX: number,
  panY: number,
  scale: number,
  opacity: number,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  const clampedScale = Math.min(
    REF_SCALE_MAX,
    Math.max(REF_SCALE_MIN, Number(scale)),
  );
  const clampedOpacity = Math.min(1, Math.max(0, Number(opacity)));
  if (!Number.isFinite(panX) || !Number.isFinite(panY)) {
    return { ok: false, error: "Invalid pan." };
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("map_editor_settings")
    .update({
      reference_pan_x: panX,
      reference_pan_y: panY,
      reference_scale: clampedScale,
      reference_opacity: clampedOpacity,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("[map-editor] reference transform", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/map-editor");
  return { ok: true, error: null };
}

export async function removeMapEditorReferenceAction(): Promise<{
  ok: boolean;
  error: string | null;
}> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  const admin = createAdminSupabase();
  const { data: row } = await admin
    .from("map_editor_settings")
    .select("reference_storage_path")
    .eq("id", 1)
    .maybeSingle();

  const path = row?.reference_storage_path as string | null | undefined;
  if (path) {
    await admin.storage.from(MAP_EDITOR_REF_BUCKET).remove([path]);
  }

  const { error } = await admin
    .from("map_editor_settings")
    .update({
      reference_storage_path: null,
      reference_pan_x: 0,
      reference_pan_y: 0,
      reference_scale: 1,
      reference_opacity: 0.38,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("[map-editor] remove reference", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/map-editor");
  return { ok: true, error: null };
}

const SITE_NODE_TYPES: ReadonlySet<string> = new Set([
  "settlement",
  "farm",
  "mine",
  "port",
  "fortress",
]);

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim(),
  );
}

function isNodeTypeString(t: string): boolean {
  return (NODE_TYPES as readonly string[]).includes(t);
}

export async function updateMapNodeAction(
  nodeId: number,
  input: {
    name: string;
    type: string;
    countyId: number | null;
    mapX: number;
    mapY: number;
    locationOwnerId: string | null;
    locationOwnerType: "character" | "clan" | null;
  },
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!Number.isFinite(nodeId) || nodeId < 1) {
    return { ok: false, error: "Invalid node." };
  }

  const trimmed = input.name.trim();
  if (!trimmed) {
    return { ok: false, error: "Name is required." };
  }

  if (!isNodeTypeString(input.type)) {
    return { ok: false, error: "Invalid node type." };
  }

  if (
    input.countyId !== null &&
    (!Number.isFinite(input.countyId) || input.countyId < 1)
  ) {
    return { ok: false, error: "Invalid county." };
  }

  if (!Number.isFinite(input.mapX) || !Number.isFinite(input.mapY)) {
    return { ok: false, error: "Map position must be finite." };
  }

  let ownerId: string | null = input.locationOwnerId?.trim() || null;
  let ownerType = input.locationOwnerType;
  if (ownerId === "") ownerId = null;
  if (ownerType === null && ownerId !== null) {
    return { ok: false, error: "Choose owner type when setting an owner id." };
  }
  if (ownerId === null) ownerType = null;
  if (ownerId !== null && !isValidUuid(ownerId)) {
    return { ok: false, error: "Owner id must be a UUID." };
  }

  const siteType = SITE_NODE_TYPES.has(input.type) ? input.type : null;

  if (siteType && ownerId !== null && ownerType === null) {
    return { ok: false, error: "Owner type is required for that owner id." };
  }

  const admin = createAdminSupabase();

  const { error: nu } = await admin
    .from("nodes")
    .update({
      name: trimmed,
      type: input.type,
      county_id: input.countyId,
      map_x: input.mapX,
      map_y: input.mapY,
    })
    .eq("id", nodeId);

  if (nu) {
    console.error("[map-editor] update node", nu);
    return { ok: false, error: nu.message };
  }

  const { data: loc } = await admin
    .from("locations")
    .select("id")
    .eq("node_id", nodeId)
    .maybeSingle();

  const locId = loc?.id as number | undefined;

  if (locId != null) {
    if (!siteType) {
      await admin.from("locations").delete().eq("id", locId);
    } else {
      await admin
        .from("locations")
        .update({
          type: siteType,
          owner_id: ownerId,
          owner_type: ownerType,
        })
        .eq("id", locId);
    }
  } else if (siteType) {
    await admin.from("locations").insert({
      node_id: nodeId,
      type: siteType,
      level: 1,
      owner_id: ownerId,
      owner_type: ownerType,
    });
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");
  return { ok: true, error: null };
}

export async function createConnectedNodeAction(
  fromNodeId: number,
): Promise<{ ok: boolean; error: string | null; id: number | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden.", id: null };
  }

  if (!Number.isFinite(fromNodeId) || fromNodeId < 1) {
    return { ok: false, error: "Invalid node.", id: null };
  }

  const admin = createAdminSupabase();
  const { data: src, error: se } = await admin
    .from("nodes")
    .select("map_x, map_y, county_id")
    .eq("id", fromNodeId)
    .maybeSingle();

  if (se || !src) {
    return { ok: false, error: "Source node not found.", id: null };
  }

  const mx = Number(src.map_x) + 28;
  const my = Number(src.map_y);

  const { data: ins, error: ie } = await admin
    .from("nodes")
    .insert({
      name: "Untitled node",
      type: "road",
      county_id: src.county_id as number | null,
      map_x: mx,
      map_y: my,
      is_capital: false,
    })
    .select("id")
    .single();

  if (ie || ins?.id == null) {
    console.error("[map-editor] insert connected node", ie);
    return { ok: false, error: ie?.message ?? "Insert failed.", id: null };
  }

  const newId = ins.id as number;
  const a = Math.min(fromNodeId, newId);
  const b = Math.max(fromNodeId, newId);

  const { error: ce } = await admin.from("node_connections").insert({
    node_a_id: a,
    node_b_id: b,
    travel_cost: 1,
    road_type: "road",
    min_tier_required: 1,
  });

  if (ce) {
    console.error("[map-editor] insert connection", ce);
    await admin.from("nodes").delete().eq("id", newId);
    return { ok: false, error: ce.message, id: null };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");
  return { ok: true, error: null, id: newId };
}

/**
 * Moves a node on the parchment plane only (admin). Used after canvas drag.
 */
export async function updateMapNodePositionAction(
  nodeId: number,
  mapX: number,
  mapY: number,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!Number.isFinite(nodeId) || nodeId < 1) {
    return { ok: false, error: "Invalid node." };
  }
  if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
    return { ok: false, error: "Map position must be finite." };
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("nodes")
    .update({
      map_x: Math.round(mapX * 100) / 100,
      map_y: Math.round(mapY * 100) / 100,
    })
    .eq("id", nodeId);

  if (error) {
    console.error("[map-editor] update node position", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");
  return { ok: true, error: null };
}

/**
 * Same cleanup order as migration 019 RPC, but via table API so it works when
 * PostgREST has not loaded `map_editor_delete_node` into its schema cache yet.
 */
export async function deleteMapNodeAction(
  nodeId: number,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!Number.isFinite(nodeId) || nodeId < 1) {
    return { ok: false, error: "Invalid node." };
  }

  const admin = createAdminSupabase();

  const { error: e0a } = await admin
    .from("node_connections")
    .delete()
    .eq("node_a_id", nodeId);
  if (e0a) {
    console.error("[map-editor] delete node_connections (a)", e0a);
    return { ok: false, error: e0a.message };
  }
  const { error: e0b } = await admin
    .from("node_connections")
    .delete()
    .eq("node_b_id", nodeId);
  if (e0b) {
    console.error("[map-editor] delete node_connections (b)", e0b);
    return { ok: false, error: e0b.message };
  }

  const { error: e1 } = await admin
    .from("counties")
    .update({ capital_node_id: null })
    .eq("capital_node_id", nodeId);
  if (e1) {
    console.error("[map-editor] null county capital_node", e1);
    return { ok: false, error: e1.message };
  }

  const { error: e2 } = await admin
    .from("characters")
    .update({ node_id: null })
    .eq("node_id", nodeId);
  if (e2) {
    console.error("[map-editor] null characters.node_id", e2);
    return { ok: false, error: e2.message };
  }

  const { error: e3 } = await admin
    .from("cities")
    .update({ node_id: null })
    .eq("node_id", nodeId);
  if (e3) {
    console.error("[map-editor] null cities.node_id", e3);
    return { ok: false, error: e3.message };
  }

  const { error: e4 } = await admin
    .from("armies")
    .update({ node_id: null })
    .eq("node_id", nodeId);
  if (e4) {
    console.error("[map-editor] null armies.node_id", e4);
    return { ok: false, error: e4.message };
  }

  const { error: e5 } = await admin
    .from("battle_orders")
    .delete()
    .eq("target_node_id", nodeId);
  if (e5) {
    console.error("[map-editor] delete battle_orders", e5);
    return { ok: false, error: e5.message };
  }

  const { error: e6 } = await admin.from("locations").delete().eq("node_id", nodeId);
  if (e6) {
    console.error("[map-editor] delete locations", e6);
    return { ok: false, error: e6.message };
  }

  const { error: e7 } = await admin.from("nodes").delete().eq("id", nodeId);
  if (e7) {
    console.error("[map-editor] delete node row", e7);
    return { ok: false, error: e7.message };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");
  return { ok: true, error: null };
}

export async function deleteCountyAction(
  countyId: number,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { ok: false, error: "Forbidden." };
  }

  if (!Number.isFinite(countyId) || countyId < 1) {
    return { ok: false, error: "Invalid county." };
  }

  const admin = createAdminSupabase();

  const { error: e0 } = await admin
    .from("nodes")
    .update({ county_id: null })
    .eq("county_id", countyId);
  if (e0) {
    console.error("[map-editor] null nodes.county_id", e0);
    return { ok: false, error: e0.message };
  }

  const { error: e0d } = await admin
    .from("duchies")
    .update({ capital_county_id: null })
    .eq("capital_county_id", countyId);
  if (e0d) {
    console.error("[map-editor] null duchies.capital_county_id", e0d);
    return { ok: false, error: e0d.message };
  }

  const { error: e1 } = await admin
    .from("countries")
    .update({ capital_county_id: null })
    .eq("capital_county_id", countyId);
  if (e1) {
    console.error("[map-editor] null countries.capital_county_id", e1);
    return { ok: false, error: e1.message };
  }

  const { error: e2 } = await admin.from("counties").delete().eq("id", countyId);
  if (e2) {
    console.error("[map-editor] delete county", e2);
    return { ok: false, error: e2.message };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");
  return { ok: true, error: null };
}
