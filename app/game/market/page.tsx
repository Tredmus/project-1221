import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  BuyRow,
  CancelListingButton,
  CreateListingForm,
} from "@/components/city/MarketActions";

export const metadata = {
  title: "Market · Imperium",
};

export const revalidate = 30;

export default async function MarketPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  // Find the city at the character's current node.
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
        <h1>Market</h1>
        <section className="panel">
          <div className="panel-body space-y-2">
            <p className="font-serif text-lg text-parchment">
              No market here.
            </p>
            <p className="font-serif text-parchment-dark">
              Each city hosts its own bazaar. Travel to Constantinople,
              Adrianople, or Thessaloniki to buy, sell, and trade.
            </p>
            <a href="/game/map" className="btn-ghost inline-block mt-2">
              Open the map
            </a>
          </div>
        </section>
      </div>
    );
  }

  // Open orders in this city — exclude own listings in the main table
  // but surface them separately below.
  const { data: allOrders } = await supabase
    .from("market_orders")
    .select(`
      id, quantity, price_per_unit, seller_id,
      seller:characters ( name ),
      item:item_types ( name, category )
    `)
    .eq("city_id", city.id)
    .eq("status", "open")
    .order("price_per_unit", { ascending: true });

  interface RawOrder {
    id: string;
    quantity: number;
    price_per_unit: number;
    seller_id: string;
    seller: { name: string } | { name: string }[] | null;
    item: { name: string; category: string } | { name: string; category: string }[] | null;
  }

  const normalized = (allOrders ?? []).map((o: RawOrder) => {
    const seller = Array.isArray(o.seller) ? o.seller[0] : o.seller;
    const item   = Array.isArray(o.item)   ? o.item[0]   : o.item;
    return {
      id:             o.id,
      quantity:       Number(o.quantity),
      price_per_unit: Number(o.price_per_unit),
      seller_id:      o.seller_id,
      seller_name:    seller?.name ?? "Unknown",
      item_name:      item?.name   ?? "Unknown item",
      category:       item?.category ?? "resource",
    };
  });

  const othersOrders  = normalized.filter((o) => o.seller_id !== character.id);
  const myOrders      = normalized.filter((o) => o.seller_id === character.id);

  // Sellable inventory (non-currency, quantity > 0).
  const { data: rawInv } = await supabase
    .from("inventory")
    .select(`
      item_type_id, quantity,
      item:item_types ( name, category )
    `)
    .eq("character_id", character.id)
    .gt("quantity", 0);

  const sellableInventory = (rawInv ?? [])
    .map((r) => {
      const item = Array.isArray(r.item) ? r.item[0] : r.item;
      return {
        item_type_id: r.item_type_id as string,
        name:         item?.name ?? r.item_type_id,
        quantity:     Number(r.quantity),
        category:     item?.category ?? "resource",
      };
    })
    .filter((i) => i.category !== "currency");

  return (
    <div className="space-y-8">
      <header>
        <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
          {city.name}
        </p>
        <h1>Bazaar</h1>
        <p className="font-serif text-parchment-dark">
          Buy from open listings or put your own goods up for sale. Items
          listed are escrowed from your saddlebag immediately.
        </p>
      </header>

      {/* Open listings */}
      <section className="panel">
        <h2 className="panel-heading">Open listings</h2>
        <div className="panel-body p-0">
          {othersOrders.length === 0 ? (
            <p className="font-serif italic text-parchment-deep p-4">
              Nothing for sale right now. Be the first to list.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gold/20">
                    <th className="text-left py-2 px-3 label-imperial mb-0">Item</th>
                    <th className="text-left py-2 px-3 label-imperial mb-0">Seller</th>
                    <th className="text-right py-2 px-3 label-imperial mb-0">Price</th>
                    <th className="text-right py-2 px-3 label-imperial mb-0">Qty</th>
                    <th className="text-right py-2 px-3 label-imperial mb-0">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {othersOrders.map((o) => (
                    <BuyRow
                      key={o.id}
                      order={o}
                      characterCoins={character.coins}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Create listing */}
        <section className="panel">
          <h2 className="panel-heading">List an item for sale</h2>
          <div className="panel-body">
            <CreateListingForm
              cityId={city.id}
              inventory={sellableInventory}
            />
          </div>
        </section>

        {/* My listings */}
        <section className="panel">
          <h2 className="panel-heading">Your listings</h2>
          <div className="panel-body">
            {myOrders.length === 0 ? (
              <p className="font-serif italic text-parchment-deep text-sm">
                You have no open listings.
              </p>
            ) : (
              <ul className="divide-y divide-gold/10">
                {myOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <div className="font-display text-gold-bright">
                        {o.item_name}
                      </div>
                      <div className="font-serif text-xs text-parchment-dark">
                        ×{o.quantity} at {o.price_per_unit}c each
                        <span className="text-parchment-deep ml-1">
                          ({o.quantity * o.price_per_unit}c total)
                        </span>
                      </div>
                    </div>
                    <CancelListingButton
                      orderId={o.id}
                      itemName={o.item_name}
                      quantity={o.quantity}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
