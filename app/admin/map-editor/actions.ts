"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/game/admin";
import type { Json } from "@/lib/types/database.types";

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
    return { ok: false, error: "A closed province needs at least three vertices." };
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

export async function updateProvincePolygonAction(
  provinceId: number,
  ring: unknown,
): Promise<PolygonSaveResult> {
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { error: "Forbidden.", ok: false };
  }

  if (!Number.isFinite(provinceId) || provinceId < 1) {
    return { error: "Invalid province.", ok: false };
  }

  const validated = validateRing(ring);
  if (!validated.ok) {
    return { error: validated.error, ok: false };
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("provinces")
    .update({ map_polygon: validated.ring as unknown as Json })
    .eq("id", provinceId);

  if (error) {
    console.error("[map-editor] update province", error);
    return { error: error.message, ok: false };
  }

  revalidatePath("/admin/map-editor");
  revalidatePath("/game/map");

  return { error: null, ok: true };
}

export interface CreateProvinceResult {
  error: string | null;
  ok: boolean;
  id: number | null;
}

const NAME_MAX = 120;

export async function createProvinceAction(
  name: string,
  regionId: number | null,
): Promise<CreateProvinceResult> {
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
    .from("provinces")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    console.error("[map-editor] create province", error);
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
