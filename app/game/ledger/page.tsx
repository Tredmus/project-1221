import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import { format } from "date-fns";

export const metadata = {
  title: "Coin Ledger · Imperium",
};

export const revalidate = 60;

const REASON_LABEL: Record<string, string> = {
  wage:              "Wage",
  market_buy:        "Market purchase",
  recruit_soldiers:  "Army recruitment",
  clan_deposit:      "Clan treasury deposit",
  travel:            "Travel fee",
};

export default async function LedgerPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  const { data: entries } = await supabase
    .from("ledger_entries")
    .select("id, delta, reason, ref_type, ref_id, created_at")
    .eq("character_id", character.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const totalIn  = (entries ?? []).filter((e) => e.delta > 0).reduce((s, e) => s + Number(e.delta), 0);
  const totalOut = (entries ?? []).filter((e) => e.delta < 0).reduce((s, e) => s + Number(e.delta), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1>Coin ledger</h1>
        <p className="font-serif text-parchment-dark">
          Every coin that has entered or left your purse, in order.
        </p>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="panel">
          <div className="panel-body text-center">
            <div className="label-imperial mb-0.5">Current balance</div>
            <div className="font-display text-3xl text-gold-bright tabular-nums">
              {Math.floor(character.coins)}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body text-center">
            <div className="label-imperial mb-0.5">Total earned</div>
            <div className="font-display text-2xl text-verdigris tabular-nums">
              +{Math.floor(totalIn)}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body text-center">
            <div className="label-imperial mb-0.5">Total spent</div>
            <div className="font-display text-2xl text-blood/80 tabular-nums">
              {Math.ceil(totalOut)}
            </div>
          </div>
        </div>
      </div>

      {/* Entries */}
      <section className="panel">
        <div className="divide-y divide-gold/10">
          {!entries || entries.length === 0 ? (
            <div className="p-4">
              <p className="font-serif italic text-parchment-deep">
                No transactions yet. Work, trade, and recruit to fill this ledger.
              </p>
            </div>
          ) : (
            entries.map((e) => {
              const isCredit = Number(e.delta) > 0;
              return (
                <div key={e.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="w-8 h-8 shrink-0 rounded-full border flex items-center justify-center font-display text-sm"
                    style={{
                      borderColor: isCredit ? "rgb(74 107 90 / 0.4)" : "rgb(110 31 31 / 0.4)",
                      color: isCredit ? "rgb(74 107 90)" : "rgb(110 31 31)",
                    }}
                  >
                    {isCredit ? "+" : "−"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-serif text-sm text-parchment">
                      {REASON_LABEL[e.reason] ?? e.reason}
                    </div>
                    <div className="font-display uppercase tracking-imperial text-[0.6rem] text-parchment-deep">
                      {format(new Date(e.created_at), "d MMM yyyy, HH:mm")}
                      {e.ref_type ? ` · ${e.ref_type}` : ""}
                    </div>
                  </div>
                  <div
                    className={`font-display text-lg tabular-nums ${
                      isCredit ? "text-verdigris" : "text-blood/80"
                    }`}
                  >
                    {isCredit ? "+" : ""}
                    {Number(e.delta)}
                    <span className="text-xs ml-1 opacity-60">c</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
