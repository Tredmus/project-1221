import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import StatsDisplay from "@/components/character/StatsDisplay";
import InventoryPanel from "@/components/character/InventoryPanel";
import APBar from "@/components/ui/APBar";
import CoinDisplay from "@/components/ui/CoinDisplay";
import type { InventoryItem } from "@/lib/types/game.types";

export const metadata = {
  title: "Self · Imperium",
};

export default async function CharacterPage() {
  const character = await getCurrentCharacter();
  const supabase = await createServerSupabase();

  const { data: rawInventory } = await supabase
    .from("inventory")
    .select(
      `
        item_type_id, quantity, condition,
        item:item_types ( name, category, description, weight )
      `,
    )
    .eq("character_id", character.id);

  const inventory: InventoryItem[] = (rawInventory ?? [])
    .map((row) => {
      const joined = Array.isArray(row.item) ? row.item[0] : row.item;
      if (!joined) return null;
      return {
        item_type_id: row.item_type_id,
        quantity: Number(row.quantity),
        condition: row.condition === null ? null : Number(row.condition),
        name: joined.name,
        category: joined.category,
        description: joined.description ?? null,
        weight: Number(joined.weight),
      } satisfies InventoryItem;
    })
    .filter((x): x is InventoryItem => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="panel lg:col-span-2">
        <h2 className="panel-heading">Character</h2>
        <div className="panel-body space-y-6">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="!text-4xl">{character.name}</h1>
            <span className="font-display uppercase tracking-imperial text-xs text-gold-dim">
              level {character.level} · {character.profession}
            </span>
          </div>

          {character.titles.length > 0 ? (
            <div>
              <div className="label-imperial">Titles</div>
              <ul className="flex flex-wrap gap-2">
                {character.titles.map((t) => (
                  <li
                    key={t}
                    className="border border-gold/40 bg-imperial/30 px-2 py-0.5 rounded-sm font-display uppercase tracking-imperial text-[0.65rem] text-gold-bright"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <div className="label-imperial">Stats</div>
            <StatsDisplay
              strength={character.strength}
              craft={character.craft}
              charisma={character.charisma}
              intelligence={character.intelligence}
            />
          </div>

          <div>
            <div className="label-imperial mb-2">Saddlebag</div>
            <InventoryPanel items={inventory} />
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="panel">
          <h2 className="panel-heading">Vitals</h2>
          <div className="panel-body space-y-4">
            <APBar
              current={character.action_points}
              max={character.max_action_points}
            />
            <CoinDisplay coins={character.coins} gems={character.gems} />
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-heading">Whereabouts</h2>
          <div className="panel-body space-y-2 font-serif">
            <p>
              <span className="label-imperial mb-0">Hearth</span>
              <span className="text-parchment">
                {character.home_city?.name ?? "Unhoused"}
              </span>
            </p>
            <p>
              <span className="label-imperial mb-0">Standing in</span>
              <span className="text-parchment">
                {character.current_node?.name ?? "—"}
              </span>
            </p>
            <p>
              <span className="label-imperial mb-0">Travel tier</span>
              <span className="text-parchment">{character.travel_tier}</span>
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}
