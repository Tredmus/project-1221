import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import RecruitForm from "@/components/military/RecruitForm";
import MarchForm from "@/components/military/MarchForm";

export const metadata = {
  title: "Military · Imperium",
};

export const revalidate = 30;

export default async function MilitaryPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  // Fetch the character's army.
  const { data: army } = await supabase
    .from("armies")
    .select(`
      id, soldier_count, mode,
      node:nodes ( id, name, type )
    `)
    .eq("character_id", character.id)
    .maybeSingle();

  const armyNode = army
    ? (Array.isArray(army.node) ? army.node[0] : army.node)
    : null;

  // Adjacent nodes from army's current position (for march target picker).
  const { data: adjacentConnections } = army && armyNode
    ? await supabase
        .from("node_connections")
        .select(`
          node_a_id, node_b_id, travel_cost,
          node_a:nodes!node_connections_node_a_id_fkey ( id, name, type ),
          node_b:nodes!node_connections_node_b_id_fkey ( id, name, type )
        `)
        .or(`node_a_id.eq.${armyNode.id},node_b_id.eq.${armyNode.id}`)
    : { data: [] };

  const adjacentNodes = (adjacentConnections ?? []).map((c) => {
    const nodeA = Array.isArray(c.node_a) ? c.node_a[0] : c.node_a;
    const nodeB = Array.isArray(c.node_b) ? c.node_b[0] : c.node_b;
    const other = nodeA?.id === armyNode?.id ? nodeB : nodeA;
    return { id: other?.id as number, name: other?.name as string | null, type: other?.type as string };
  }).filter((n) => n.id);

  // Armies at the character's current node (allies / enemies visible).
  const { data: localArmies } = character.node_id
    ? await supabase
        .from("armies")
        .select(`
          id, soldier_count, mode,
          character:characters ( id, name )
        `)
        .eq("node_id", character.node_id)
        .neq("character_id", character.id)
        .limit(10)
    : { data: [] };

  const MODE_LABEL: Record<string, string> = {
    garrison: "Garrisoned",
    marching: "Marching",
    attacking: "Attacking",
  };

  return (
    <div className="space-y-8">
      <header>
        <h1>Military</h1>
        <p className="font-serif text-parchment-dark">
          Raise levies, march your host, and impose your will upon the land.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Army overview */}
        <section className="panel">
          <h2 className="panel-heading">Your army</h2>
          <div className="panel-body space-y-4">
            {!army || army.soldier_count === 0 ? (
              <p className="font-serif italic text-parchment-deep">
                You have no soldiers. Recruit levies below.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label-imperial mb-0">Strength</div>
                  <div className="font-display text-3xl text-gold-bright tabular-nums">
                    {army.soldier_count}
                    <span className="text-gold-dim text-base ml-1">soldiers</span>
                  </div>
                </div>
                <div>
                  <div className="label-imperial mb-0">Status</div>
                  <div className="font-display uppercase tracking-imperial text-sm text-parchment border border-gold/20 inline-block px-2 py-0.5 rounded-sm">
                    {MODE_LABEL[army.mode] ?? army.mode}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="label-imperial mb-0">Position</div>
                  <div className="font-serif text-parchment">
                    {armyNode?.name ?? `Node #${armyNode?.id}`}
                    <span className="text-parchment-deep text-xs ml-2">
                      ({armyNode?.type ?? "unknown"})
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* March form */}
            {army && army.soldier_count > 0 && adjacentNodes.length > 0 && (
              <div className="pt-3 border-t border-gold/10">
                <p className="label-imperial mb-2">March to</p>
                <MarchForm adjacentNodes={adjacentNodes} />
              </div>
            )}
          </div>
        </section>

        {/* Recruit */}
        <section className="panel">
          <h2 className="panel-heading">Recruit soldiers</h2>
          <div className="panel-body">
            <p className="font-serif text-sm text-parchment-dark mb-4">
              Each soldier costs <span className="text-gold-bright">5 coins</span> upfront.
              Soldiers are recruited at your current location.
            </p>
            <RecruitForm characterCoins={character.coins} />
          </div>
        </section>
      </div>

      {/* Other armies at this location */}
      {localArmies && localArmies.length > 0 && (
        <section className="panel">
          <h2 className="panel-heading">
            Other forces at{" "}
            {character.current_node?.name ?? `Node #${character.node_id}`}
          </h2>
          <div className="panel-body">
            <ul className="divide-y divide-gold/10">
              {localArmies.map((a) => {
                const char = Array.isArray(a.character) ? a.character[0] : a.character;
                return (
                  <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                    <div className="font-serif text-parchment">
                      {char?.name ?? "Unknown"}&rsquo;s army
                    </div>
                    <div className="font-display text-gold-bright tabular-nums text-sm">
                      {a.soldier_count} soldiers
                      <span className="text-gold-dim ml-2 text-xs uppercase tracking-imperial">
                        {MODE_LABEL[a.mode] ?? a.mode}
                      </span>
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
