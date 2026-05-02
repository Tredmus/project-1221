import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import GameMap, { type CharacterPresence } from "@/components/map/GameMap";
import type { MapConnectionView, MapNodeView, NodeType } from "@/lib/types/game.types";

export const metadata = {
  title: "Map · Imperium",
};

// Revalidate every 30 s so the map picks up new characters/nodes without
// needing a full page reload. After a travel action, revalidatePath()
// in the Server Action makes this happen immediately.
export const revalidate = 30;

export default async function MapPage() {
  const character = await getCurrentCharacter();
  const supabase = await createServerSupabase();

  const [
    { data: rawNodes },
    { data: rawConns },
    { data: rawChars },
  ] = await Promise.all([
    supabase
      .from("nodes")
      .select("id, name, type, map_x, map_y, province_id, is_capital"),
    supabase
      .from("node_connections")
      .select("node_a_id, node_b_id, road_type, travel_cost, min_tier_required"),
    // Fetch all characters who have a node_id set. We only need name + location
    // for the presence display — nothing sensitive.
    supabase
      .from("characters")
      .select("id, name, node_id")
      .not("node_id", "is", null),
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

  const otherCharacters: CharacterPresence[] = (rawChars ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    node_id: c.node_id as number | null,
  }));

  const isEmpty = nodes.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1>The known world</h1>
        <p className="font-serif text-parchment-dark">
          Click any node to inspect it and plot a route. The gold dot above
          a node marks where you stand. Small numbered badges show other
          characters at that location.
          {isEmpty && (
            <span className="block mt-2 font-serif italic text-parchment-deep">
              No nodes have been seeded yet. Visit{" "}
              <code className="text-gold">/admin/seed</code> to add the
              first cities and roads.
            </span>
          )}
        </p>
      </header>

      <GameMap
        nodes={nodes}
        connections={connections}
        currentNodeId={character.node_id ?? null}
        characterId={character.id}
        characterAP={character.action_points}
        characterTravelTier={character.travel_tier}
        otherCharacters={otherCharacters}
      />
    </div>
  );
}
