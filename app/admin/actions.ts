"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/game/admin";

// ----------------------------------------------------------------
// Seed payload schema (no Zod yet — keep MVP dependencies thin)
// ----------------------------------------------------------------

interface NodeInput {
  key: string;
  name?: string;
  type?: "road" | "city" | "settlement" | "farm" | "mine" | "port" | "fortress";
  county_id?: number;
  is_capital?: boolean;
  map_x: number;
  map_y: number;
}

interface ConnectionInput {
  from: string;
  to: string;
  travel_cost?: number;
  road_type?: "road" | "river" | "sea";
  min_tier_required?: number;
}

interface CityInput {
  node_key: string;
  name: string;
  wall_level?: number;
  is_capital?: boolean;
  properties?: Record<string, unknown>;
}

interface SeedPayload {
  nodes?: NodeInput[];
  connections?: ConnectionInput[];
  cities?: CityInput[];
}

export interface SeedState {
  error: string | null;
  summary: string | null;
}

function validatePayload(raw: unknown): SeedPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Payload must be a JSON object.");
  }
  const out: SeedPayload = {};
  const obj = raw as Record<string, unknown>;

  if (obj.nodes !== undefined) {
    if (!Array.isArray(obj.nodes)) throw new Error("`nodes` must be an array.");
    out.nodes = obj.nodes.map((n, i) => {
      const node = n as Record<string, unknown>;
      if (typeof node.key !== "string" || !node.key.trim()) {
        throw new Error(`nodes[${i}].key is required (string).`);
      }
      if (typeof node.map_x !== "number" || typeof node.map_y !== "number") {
        throw new Error(`nodes[${i}] needs numeric map_x and map_y.`);
      }
      return node as unknown as NodeInput;
    });
  }

  if (obj.connections !== undefined) {
    if (!Array.isArray(obj.connections))
      throw new Error("`connections` must be an array.");
    out.connections = obj.connections.map((c, i) => {
      const conn = c as Record<string, unknown>;
      if (typeof conn.from !== "string" || typeof conn.to !== "string") {
        throw new Error(`connections[${i}] needs string from/to.`);
      }
      return conn as unknown as ConnectionInput;
    });
  }

  if (obj.cities !== undefined) {
    if (!Array.isArray(obj.cities))
      throw new Error("`cities` must be an array.");
    out.cities = obj.cities.map((c, i) => {
      const city = c as Record<string, unknown>;
      if (typeof city.node_key !== "string" || !city.node_key.trim()) {
        throw new Error(`cities[${i}].node_key is required.`);
      }
      if (typeof city.name !== "string" || !city.name.trim()) {
        throw new Error(`cities[${i}].name is required.`);
      }
      return city as unknown as CityInput;
    });
  }

  return out;
}

export async function seedWorldAction(
  _prev: SeedState,
  formData: FormData,
): Promise<SeedState> {
  // Re-check the admin gate. Never trust that the layout's check is enough.
  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user || !(await isAdminUser(session, user.id))) {
    return { error: "Forbidden.", summary: null };
  }

  const raw = String(formData.get("payload") ?? "").trim();
  if (!raw) return { error: "Payload is empty.", summary: null };

  let parsed: SeedPayload;
  try {
    const json = JSON.parse(raw) as unknown;
    parsed = validatePayload(json);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Invalid JSON.",
      summary: null,
    };
  }

  const admin = createAdminSupabase();

  // Track inserted node ids by their payload key so connections + cities
  // can reference them.
  const nodeIdsByKey = new Map<string, number>();

  // ---- Nodes ----
  let nodesInserted = 0;
  if (parsed.nodes?.length) {
    const rows = parsed.nodes.map((n) => ({
      name: n.name ?? null,
      type: n.type ?? "road",
      county_id: n.county_id ?? null,
      is_capital: n.is_capital ?? false,
      map_x: n.map_x,
      map_y: n.map_y,
    }));
    const { data: inserted, error } = await admin
      .from("nodes")
      .insert(rows)
      .select("id");
    if (error) {
      console.error("[seed] nodes", error);
      return { error: `Nodes: ${error.message}`, summary: null };
    }
    inserted?.forEach((row, idx) => {
      const key = parsed.nodes![idx].key;
      nodeIdsByKey.set(key, row.id);
    });
    nodesInserted = inserted?.length ?? 0;
  }

  // ---- Connections ----
  let connectionsInserted = 0;
  if (parsed.connections?.length) {
    // Connections may reference newly inserted nodes by key, OR existing
    // nodes already in the DB by numeric id (encoded as string).
    const existingByKey = nodeIdsByKey;

    const resolved = parsed.connections.map((c, i) => {
      const a = existingByKey.get(c.from) ?? Number(c.from);
      const b = existingByKey.get(c.to) ?? Number(c.to);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(
          `connections[${i}] references unknown node key (${c.from} → ${c.to}).`,
        );
      }
      return {
        node_a_id: a,
        node_b_id: b,
        travel_cost: c.travel_cost ?? 1,
        road_type: c.road_type ?? "road",
        min_tier_required: c.min_tier_required ?? 1,
      };
    });

    const { error } = await admin.from("node_connections").insert(resolved);
    if (error) {
      console.error("[seed] connections", error);
      return { error: `Connections: ${error.message}`, summary: null };
    }
    connectionsInserted = resolved.length;
  }

  // ---- Cities ----
  let citiesInserted = 0;
  if (parsed.cities?.length) {
    const rows = parsed.cities.map((c, i) => {
      const node_id = nodeIdsByKey.get(c.node_key);
      if (!node_id) {
        throw new Error(
          `cities[${i}] references unknown node key "${c.node_key}".`,
        );
      }
      return {
        node_id,
        name: c.name,
        wall_level: c.wall_level ?? 1,
        is_capital: c.is_capital ?? false,
        properties: c.properties ?? {},
      };
    });
    const { data: inserted, error } = await admin
      .from("cities")
      .insert(rows)
      .select("id, node_id");
    if (error) {
      console.error("[seed] cities", error);
      return { error: `Cities: ${error.message}`, summary: null };
    }

    // Backfill nodes.entity_id so the polymorphic pointer is set.
    if (inserted?.length) {
      for (const city of inserted) {
        if (city.node_id !== null) {
          await admin
            .from("nodes")
            .update({ entity_id: city.id })
            .eq("id", city.node_id);
        }
      }
    }
    citiesInserted = inserted?.length ?? 0;
  }

  revalidatePath("/admin");
  revalidatePath("/game/map");
  revalidatePath("/onboarding");

  const summary = [
    `Inserted ${nodesInserted} node(s).`,
    `Inserted ${connectionsInserted} connection(s).`,
    `Inserted ${citiesInserted} city/cities.`,
  ].join("\n");

  return { error: null, summary };
}
