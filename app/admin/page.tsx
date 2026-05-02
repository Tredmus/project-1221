import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "Admin · Imperium",
};

interface CountRow {
  label: string;
  count: number;
}

export default async function AdminOverviewPage() {
  const supabase = await createServerSupabase();

  const tables = [
    "regions",
    "provinces",
    "nodes",
    "node_connections",
    "cities",
    "characters",
    "clans",
    "market_orders",
    "battle_orders",
    "game_events",
  ] as const;

  const counts: CountRow[] = await Promise.all(
    tables.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      return { label: table, count: count ?? 0 };
    }),
  );

  return (
    <div className="space-y-8">
      <section className="panel">
        <h2 className="panel-heading">World census</h2>
        <div className="panel-body">
          <p className="font-serif text-parchment-dark mb-4">
            A bird&rsquo;s-eye view of the realm. Use the seed page to add
            nodes, connections, and cities.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {counts.map((row) => (
              <div
                key={row.label}
                className="border border-gold/15 bg-imperial-shadow/40 px-3 py-3 rounded-sm"
              >
                <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
                  {row.label.replace("_", " ")}
                </div>
                <div className="mt-1 font-display text-2xl text-gold-bright">
                  {row.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-heading">Quick actions</h2>
        <div className="panel-body flex flex-wrap gap-3">
          <Link href="/admin/seed" className="btn-imperial">
            Seed nodes &amp; connections
          </Link>
          <Link href="/game/map" className="btn-ghost">
            View map
          </Link>
        </div>
      </section>
    </div>
  );
}
