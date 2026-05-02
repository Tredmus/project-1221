import { redirect } from "next/navigation";
import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import BuildingCard from "@/components/city/BuildingCard";
import { format } from "date-fns";

export const metadata = {
  title: "Work · Imperium",
};

interface Building {
  id: number;
  level: number;
  building_type_id: string;
  name: string;
  output_item_id: string | null;
  output_item_name: string | null;
  output_qty_per_ap: number;
  wage_per_ap: number;
  required_stat: string | null;
}

export default async function WorkPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  // Find the city at the character's current node, if any.
  const { data: city } = character.node_id
    ? await supabase
        .from("cities")
        .select("id, name, properties")
        .eq("node_id", character.node_id)
        .maybeSingle()
    : { data: null };

  if (!city) {
    return (
      <div className="space-y-6">
        <h1>Work</h1>
        <section className="panel">
          <div className="panel-body space-y-3">
            <p className="font-serif text-lg text-parchment">
              There is no workshop to be found here.
            </p>
            <p className="font-serif text-parchment-dark">
              Travel to a city — Constantinople, Adrianople, or Thessaloniki —
              to find forges, sawmills, and bakeries where you can earn coin
              and gather goods.
            </p>
            <a href="/game/map" className="btn-ghost inline-block mt-2">
              Open the map
            </a>
          </div>
        </section>
      </div>
    );
  }

  // Fetch buildings at this city, joined to building_types and item_types.
  const { data: rawBuildings } = await supabase
    .from("city_buildings")
    .select(`
      id, level,
      building_type_id,
      building_type:building_types (
        name,
        output_item_id,
        output_qty_per_ap,
        wage_per_ap,
        required_stat,
        output_item:item_types ( name )
      )
    `)
    .eq("city_id", city.id)
    .order("id");

  const buildings: Building[] = (rawBuildings ?? []).map((row) => {
    const bt = Array.isArray(row.building_type)
      ? row.building_type[0]
      : row.building_type;
    const item = Array.isArray(bt?.output_item)
      ? bt?.output_item[0]
      : bt?.output_item;
    return {
      id:                row.id,
      level:             row.level,
      building_type_id:  row.building_type_id,
      name:              bt?.name ?? row.building_type_id,
      output_item_id:    bt?.output_item_id ?? null,
      output_item_name:  item?.name ?? null,
      output_qty_per_ap: Number(bt?.output_qty_per_ap ?? 1),
      wage_per_ap:       Number(bt?.wage_per_ap ?? 0),
      required_stat:     bt?.required_stat ?? null,
    };
  });

  // Fetch today's pending work actions for this character.
  const { data: pendingWork } = await supabase
    .from("work_actions")
    .select(`
      id, ap_spent, created_at,
      building:city_buildings (
        building_type_id,
        building_type:building_types ( name )
      )
    `)
    .eq("character_id", character.id)
    .is("processed_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  // Helper: resolve character's stat for a given building
  const statValue = (stat: string | null): number => {
    if (!stat) return 0;
    const map: Record<string, number> = {
      strength:    character.strength,
      craft:       character.craft,
      charisma:    character.charisma,
      intelligence: character.intelligence,
    };
    return map[stat] ?? 0;
  };

  return (
    <div className="space-y-8">
      <header>
        <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
          {city.name}
        </p>
        <h1>Find work</h1>
        <p className="font-serif text-parchment-dark">
          Commit action points to a workshop. Your output and wages arrive in
          your saddlebag at midnight, after tonight&rsquo;s cycle runs.
        </p>
      </header>

      {/* Buildings */}
      {buildings.length === 0 ? (
        <section className="panel">
          <div className="panel-body">
            <p className="font-serif italic text-parchment-deep">
              No workshops in {city.name} yet. An administrator can seed
              city buildings from <code className="text-gold">/admin/seed</code>.
            </p>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {buildings.map((b) => (
            <BuildingCard
              key={b.id}
              building={b}
              characterAP={character.action_points}
              relevantStatValue={statValue(b.required_stat)}
            />
          ))}
        </div>
      )}

      {/* Pending queue */}
      {pendingWork && pendingWork.length > 0 && (
        <section className="panel">
          <h2 className="panel-heading">Queued for tonight</h2>
          <div className="panel-body">
            <ul className="divide-y divide-gold/10">
              {pendingWork.map((w) => {
                const bt_raw = Array.isArray(w.building)
                  ? w.building[0]
                  : w.building;
                const bt2 = Array.isArray(bt_raw?.building_type)
                  ? bt_raw?.building_type[0]
                  : bt_raw?.building_type;
                return (
                  <li key={w.id} className="flex items-center justify-between py-2.5 gap-4">
                    <div>
                      <div className="font-display text-gold-bright text-sm">
                        {bt2?.name ?? "Workshop"}
                      </div>
                      <div className="font-serif text-xs text-parchment-deep">
                        {format(new Date(w.created_at), "HH:mm")} · {w.ap_spent} AP
                        committed
                      </div>
                    </div>
                    <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim border border-gold/20 px-2 py-1 rounded-sm">
                      Pending
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
