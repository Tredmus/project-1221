import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";

export const revalidate = 30;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("cities")
    .select("name")
    .eq("id", Number(id))
    .maybeSingle();
  return { title: data ? `${data.name} · Imperium` : "City · Imperium" };
}

export default async function CityPage({ params }: PageProps) {
  const { id: idStr } = await params;
  const cityId = Number(idStr);
  if (!Number.isFinite(cityId) || cityId <= 0) notFound();

  const [character, supabase] = await Promise.all([
    getCurrentCharacter(),
    createServerSupabase(),
  ]);

  const { data: city } = await supabase
    .from("cities")
    .select("id, name, wall_level, is_capital, node_id, properties")
    .eq("id", cityId)
    .maybeSingle();

  // Current mayor: active officeholder for 'mayor' at this city's scope_id.
  const { data: mayorRow } = await supabase
    .from("officeholders")
    .select(`id, character:characters ( name, profession )`)
    .eq("position_id", "mayor")
    .eq("scope_id", cityId)
    .gte("term_end", new Date().toISOString().slice(0, 10))
    .order("term_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mayor = mayorRow
    ? (Array.isArray(mayorRow.character) ? mayorRow.character[0] : mayorRow.character)
    : null;

  if (!city) notFound();

  // Is the current character physically at this city?
  const isHere = character.node_id !== null && city.node_id === character.node_id;

  // Citizens currently at this city's node.
  const { data: citizens } = city.node_id
    ? await supabase
        .from("characters")
        .select("id, name, profession")
        .eq("node_id", city.node_id)
        .limit(20)
    : { data: [] };

  // Buildings.
  const { data: rawBuildings } = await supabase
    .from("city_buildings")
    .select(`
      id, level,
      building_type:building_types (
        name,
        output_item_id,
        output_qty_per_ap,
        wage_per_ap,
        output_item:item_types ( name )
      )
    `)
    .eq("city_id", cityId)
    .order("id");

  // Open market orders — top 5 per item type, cheapest first.
  const { data: orders } = await supabase
    .from("market_orders")
    .select(`
      id, quantity, price_per_unit,
      item:item_types ( name, category )
    `)
    .eq("city_id", cityId)
    .eq("status", "open")
    .order("price_per_unit", { ascending: true })
    .limit(10);

  const desc =
    typeof city.properties === "object" &&
    city.properties !== null &&
    "description" in city.properties
      ? String((city.properties as Record<string, unknown>).description)
      : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="!text-4xl">{city.name}</h1>
            {city.is_capital && (
              <span className="font-display uppercase tracking-imperial text-[0.65rem] text-gold border border-gold/40 px-2 py-0.5 rounded-sm">
                Capital
              </span>
            )}
          </div>
          {desc && (
            <p className="font-serif italic text-parchment-dark mt-1">{desc}</p>
          )}
          <div className="flex items-center gap-4 mt-2 font-display uppercase tracking-imperial text-xs text-parchment-deep">
            <span>Walls: {city.wall_level}</span>
            <span>Citizens: {citizens?.length ?? 0}</span>
            {mayor && (
              <span className="text-gold-dim">
                Mayor: <span className="text-gold-bright">{mayor.name}</span>
              </span>
            )}
          </div>
        </div>
        {isHere ? (
          <div className="flex flex-wrap gap-3">
            <Link href="/game/work" className="btn-imperial">
              Find work here
            </Link>
            <Link href="/game/market" className="btn-ghost">
              Visit market
            </Link>
          </div>
        ) : (
          <p className="font-serif italic text-parchment-deep text-sm">
            Travel here to work or trade.
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Buildings */}
        <section className="panel lg:col-span-2">
          <h2 className="panel-heading">Workshops</h2>
          <div className="panel-body">
            {!rawBuildings || rawBuildings.length === 0 ? (
              <p className="font-serif italic text-parchment-deep">
                No workshops yet.
              </p>
            ) : (
              <ul className="divide-y divide-gold/10">
                {rawBuildings.map((b) => {
                  const bt = Array.isArray(b.building_type)
                    ? b.building_type[0]
                    : b.building_type;
                  const item = Array.isArray(bt?.output_item)
                    ? bt?.output_item[0]
                    : bt?.output_item;
                  return (
                    <li key={b.id} className="py-3 flex items-center gap-4">
                      <div className="flex-1">
                        <div className="font-display text-gold-bright">
                          {bt?.name ?? "Workshop"}
                          <span className="text-gold-dim text-xs ml-2">
                            lv {b.level}
                          </span>
                        </div>
                        <div className="font-serif text-sm text-parchment-dark">
                          {item
                            ? `${bt?.output_qty_per_ap} ${item.name} / AP`
                            : "Service only"}{" "}
                          · {bt?.wage_per_ap} coin / AP
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Citizens + Market preview */}
        <div className="space-y-6">
          <section className="panel">
            <h2 className="panel-heading">In the city</h2>
            <div className="panel-body">
              {!citizens || citizens.length === 0 ? (
                <p className="font-serif italic text-parchment-deep text-sm">
                  Empty streets.
                </p>
              ) : (
                <ul className="space-y-2">
                  {citizens.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-2">
                      <span
                        className={`font-serif text-sm ${
                          c.id === character.id
                            ? "text-gold-bright font-medium"
                            : "text-parchment"
                        }`}
                      >
                        {c.name}
                        {c.id === character.id ? " (you)" : ""}
                      </span>
                      <span className="font-display uppercase tracking-imperial text-[0.6rem] text-parchment-deep">
                        {c.profession}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-heading">Market</h2>
            <div className="panel-body space-y-2">
              {!orders || orders.length === 0 ? (
                <p className="font-serif italic text-parchment-deep text-sm">
                  Nothing for sale.
                </p>
              ) : (
                <ul className="space-y-2">
                  {orders.map((o) => {
                    const item = Array.isArray(o.item) ? o.item[0] : o.item;
                    return (
                      <li key={o.id} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-serif text-parchment">
                          {item?.name ?? "Item"}
                        </span>
                        <span className="font-display text-gold-bright tabular-nums">
                          {o.price_per_unit}c
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {isHere && (
                <Link
                  href="/game/market"
                  className="btn-ghost w-full mt-2 text-center"
                >
                  Full market →
                </Link>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-heading">Politics</h2>
            <div className="panel-body space-y-2">
              {mayor ? (
                <div className="text-sm font-serif text-parchment">
                  Mayor: <span className="text-gold-bright">{mayor.name}</span>
                </div>
              ) : (
                <p className="font-serif italic text-parchment-deep text-sm">
                  No mayor in office.
                </p>
              )}
              <Link href="/game/politics" className="btn-ghost w-full text-center">
                Senate →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
