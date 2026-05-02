import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { parseProvincePolygon } from "@/lib/map/parseProvincePolygon";
import ProvinceMapEditor from "@/components/admin/ProvinceMapEditor";
import type { MapConnectionView, MapNodeView, NodeType } from "@/lib/types/game.types";
import type { MapEditorReferenceServerProps } from "@/app/admin/map-editor/types";

export const metadata = {
  title: "Map editor · Admin · Imperium",
};

export interface MapEditorProvinceRow {
  id: number;
  name: string;
  map_x: number | null;
  map_y: number | null;
  map_polygon: [number, number][] | null;
}

export interface MapEditorRegionRow {
  id: number;
  name: string;
}

export default async function AdminMapEditorPage() {
  const supabase = await createServerSupabase();

  const [
    { data: rawNodes },
    { data: rawConns },
    { data: rawProvinces },
    { data: rawRegions },
  ] = await Promise.all([
    supabase
      .from("nodes")
      .select("id, name, type, map_x, map_y, province_id, is_capital"),
    supabase
      .from("node_connections")
      .select("node_a_id, node_b_id, road_type, travel_cost, min_tier_required"),
    supabase.from("provinces").select("id, name, map_x, map_y, map_polygon"),
    supabase.from("regions").select("id, name").order("name"),
  ]);

  const nodes: MapNodeView[] = (rawNodes ?? []).map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type as NodeType,
    map_x: Number(n.map_x),
    map_y: Number(n.map_y),
    province_id: n.province_id,
    is_capital: n.is_capital,
  }));

  const connections: MapConnectionView[] = (rawConns ?? []).map((c) => ({
    node_a_id: c.node_a_id,
    node_b_id: c.node_b_id,
    road_type: c.road_type as MapConnectionView["road_type"],
    travel_cost: c.travel_cost,
    min_tier_required: c.min_tier_required,
  }));

  const provinces: MapEditorProvinceRow[] = (rawProvinces ?? []).map((p) => ({
    id: p.id as number,
    name: p.name as string,
    map_x: p.map_x != null && p.map_x !== "" ? Number(p.map_x) : null,
    map_y: p.map_y != null && p.map_y !== "" ? Number(p.map_y) : null,
    map_polygon: parseProvincePolygon(p.map_polygon),
  }));

  const regions: MapEditorRegionRow[] = (rawRegions ?? []).map((r) => ({
    id: r.id as number,
    name: r.name as string,
  }));

  let reference: MapEditorReferenceServerProps = {
    signedUrl: null,
    panX: 0,
    panY: 0,
    scale: 1,
    opacity: 0.38,
  };

  try {
    const admin = createAdminSupabase();
    const { data: settings } = await admin
      .from("map_editor_settings")
      .select(
        "reference_storage_path, reference_pan_x, reference_pan_y, reference_scale, reference_opacity",
      )
      .eq("id", 1)
      .maybeSingle();

    if (settings && settings.reference_storage_path) {
      const path = String(settings.reference_storage_path);
      const { data: signed, error: signErr } = await admin.storage
        .from("map-editor-reference")
        .createSignedUrl(path, 4 * 60 * 60);

      if (!signErr && signed?.signedUrl) {
        reference = {
          signedUrl: signed.signedUrl,
          panX: Number(settings.reference_pan_x ?? 0),
          panY: Number(settings.reference_pan_y ?? 0),
          scale: Number(settings.reference_scale ?? 1),
          opacity: Number(settings.reference_opacity ?? 0.38),
        };
      }
    }
  } catch (e) {
    console.error("[map-editor] reference bundle", e);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
          Cartography
        </p>
        <h2 className="text-xl mt-1">Province polygon editor</h2>
        <p className="font-serif text-parchment-dark text-sm mt-2 max-w-2xl">
          Trace borders in the same parchment space as the live map. Create new
          provinces from the sidebar, then place vertices. Double-click to close
          the ring and save. Use a reference image: enable &ldquo;Adjust
          reference&rdquo; to pan and scale it, then turn it off to trace.
        </p>
      </div>

      <ProvinceMapEditor
        nodes={nodes}
        connections={connections}
        provinces={provinces}
        regions={regions}
        reference={reference}
      />
    </div>
  );
}
