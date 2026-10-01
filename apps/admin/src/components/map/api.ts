import type { Biome, NodeType } from "@1221/game-core";
import type { Json } from "@1221/shared";
import type { BrowserSupabase } from "@/lib/supabase-browser";
import type { County, MapNode, MapPatch, MapReference, TierKind, World, WorldSnapshot } from "./world";

/** A point of a county outline being drawn: an existing point, a new one, or one on an edge. */
export type PointSpec = { id: number } | { lon: number; lat: number } | { edge: number; lon: number; lat: number };

export const REFERENCE_BUCKET = "map-references";

/** Supabase errors carry the database message (the map functions write readable ones). */
function must<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

/**
 * Every change the editor makes. Topology goes through the map_* database functions,
 * which check the admin role and keep shared borders consistent; the rest is plain table
 * writes that row-level security limits to admins. Each action applies the result to
 * the world.
 */
export function createActions(supabase: BrowserSupabase, world: World) {
  const patch = async (call: PromiseLike<{ data: Json | null; error: { message: string } | null }>) => {
    const result = must(await call) as unknown as MapPatch;
    world.applyPatch(result);
    return result;
  };
  const reloadTier = async (kind: TierKind) => {
    world.setTier(kind, must(await supabase.from(kind).select("*").order("id")));
  };

  return {
    async load() {
      const [map, refs] = await Promise.all([
        supabase.rpc("get_world_map"),
        supabase.from("map_references").select("*").order("sort").order("id"),
      ]);
      world.load(must(map) as unknown as WorldSnapshot, must(refs));
    },

    // Counties and borders ----------------------------------------------------------------

    createCounty: (points: PointSpec[], countyId?: number) =>
      patch(supabase.rpc("map_create_county", { p_points: points as Json, p_name: "New county", p_county_id: countyId })),

    splitEdge: (edgeId: number, lon: number, lat: number) =>
      patch(supabase.rpc("map_split_edge", { p_edge_id: edgeId, p_lon: lon, p_lat: lat })),

    deletePoint: (id: number) => patch(supabase.rpc("map_delete_point", { p_point_id: id })),

    mergePoints: (from: number, into: number) => patch(supabase.rpc("map_merge_points", { p_from: from, p_into: into })),

    async movePoint(id: number, lon: number, lat: number) {
      const row = must(await supabase.from("border_points").update({ lon, lat }).eq("id", id).select().single());
      world.applyPatch({ points: [row] });
    },

    deleteCounty: (id: number) => patch(supabase.rpc("map_delete_county", { p_county_id: id })),

    async updateCounty(id: number, fields: Partial<Pick<County, "name" | "duchy_id" | "culture_id" | "religion_id" | "main_node_id">>) {
      const row = must(await supabase.from("counties").update(fields).eq("id", id).select().single());
      world.applyPatch({ counties: [row] });
      // Leaving a duchy clears its main county in the database.
      if ("duchy_id" in fields) await reloadTier("duchies");
    },

    // Nodes and roads ---------------------------------------------------------------------

    createNode: (args: { lon: number; lat: number; type: NodeType; biome: Biome; countyId: number | null; fromNodeId?: number }) =>
      patch(
        supabase.rpc("map_create_node", {
          p_lon: args.lon,
          p_lat: args.lat,
          p_type: args.type,
          p_biome: args.biome,
          p_county_id: args.countyId ?? undefined,
          p_from_node_id: args.fromNodeId,
        }),
      ),

    updateNode: (node: MapNode) =>
      patch(
        supabase.rpc("map_update_node", {
          p_node_id: node.id,
          p_lon: node.lon,
          p_lat: node.lat,
          p_type: node.type,
          p_biome: node.biome,
          p_name: node.name ?? undefined,
          p_county_id: node.county_id ?? undefined,
        }),
      ),

    async deleteNode(id: number) {
      must(await supabase.from("nodes").delete().eq("id", id));
      world.nodeDeleted(id);
    },

    async createRoad(a: number, b: number) {
      const [node_a, node_b] = a < b ? [a, b] : [b, a];
      const row = must(await supabase.from("roads").insert({ node_a, node_b }).select().single());
      world.applyPatch({ roads: [row] });
      return row;
    },

    async deleteRoad(id: number) {
      must(await supabase.from("roads").delete().eq("id", id));
      world.roadDeleted(id);
    },

    // Empires, kingdoms, duchies ----------------------------------------------------------

    async createTier(kind: TierKind, name: string, parentId: number | null) {
      const row =
        kind === "empires"
          ? { name }
          : kind === "kingdoms"
            ? { name, empire_id: parentId }
            : { name, kingdom_id: parentId };
      must(await supabase.from(kind).insert(row as never));
      await reloadTier(kind);
    },

    async updateTier(kind: TierKind, id: number, fields: Record<string, string | number | null>) {
      must(await supabase.from(kind).update(fields as never).eq("id", id));
      await reloadTier(kind);
    },

    async deleteTier(kind: TierKind, id: number) {
      must(await supabase.from(kind).delete().eq("id", id));
      await reloadTier(kind);
      // Children keep existing with an empty link (on delete set null).
      if (kind === "empires") await reloadTier("kingdoms");
      if (kind === "kingdoms") await reloadTier("duchies");
      if (kind === "duchies") {
        const counties = must(await supabase.from("counties").select("*").order("id"));
        world.applyPatch({ counties });
      }
    },

    // Reference images ---------------------------------------------------------------------

    async addReferenceImage(file: Blob, name: string, box: [number, number, number, number]) {
      const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
      const path = `${crypto.randomUUID()}.${ext}`;
      must(await supabase.storage.from(REFERENCE_BUCKET).upload(path, file, { contentType: file.type }));
      const [west, south, east, north] = box;
      must(
        await supabase
          .from("map_references")
          .insert({ name, kind: "image", storage_path: path, west, south, east, north, sort: world.references.size }),
      );
      await this.reloadReferences();
    },

    async addReferenceTiles(name: string, tileUrl: string) {
      must(await supabase.from("map_references").insert({ name, kind: "tiles", tile_url: tileUrl, sort: world.references.size }));
      await this.reloadReferences();
    },

    async updateReference(id: number, fields: Partial<Pick<MapReference, "name" | "opacity" | "visible" | "west" | "south" | "east" | "north">>) {
      must(await supabase.from("map_references").update(fields).eq("id", id));
      await this.reloadReferences();
    },

    async deleteReference(ref: MapReference) {
      must(await supabase.from("map_references").delete().eq("id", ref.id));
      if (ref.storage_path) await supabase.storage.from(REFERENCE_BUCKET).remove([ref.storage_path]);
      await this.reloadReferences();
    },

    async reloadReferences() {
      world.setReferences(must(await supabase.from("map_references").select("*").order("sort").order("id")));
    },

    /** Private bucket: the editor reads images through short-lived signed URLs. */
    async referenceUrl(path: string) {
      return must(await supabase.storage.from(REFERENCE_BUCKET).createSignedUrl(path, 60 * 60 * 12)).signedUrl;
    },
  };
}

export type EditorActions = ReturnType<typeof createActions>;
