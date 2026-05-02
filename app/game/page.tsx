import Link from "next/link";
import { format } from "date-fns";
import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "Hall · Imperium",
};

/**
 * Game dashboard. Recent events, location summary, quick actions.
 *
 * The map and the character sheet are dedicated pages — this page is a
 * landing surface that orients the player when they arrive.
 */
export default async function GameHomePage() {
  const character = await getCurrentCharacter();
  const supabase = await createServerSupabase();

  // Recent events involving this character.
  const { data: events } = await supabase
    .from("game_events")
    .select("id, event_type, payload, created_at")
    .eq("actor_id", character.id)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="panel lg:col-span-2">
        <h2 className="panel-heading">The day at hand</h2>
        <div className="panel-body space-y-4">
          <p className="font-serif text-lg text-parchment">
            {greeting(character.name)}
          </p>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Calling" value={prettify(character.profession)} />
            <Field label="Level" value={String(character.level)} />
            <Field label="Experience" value={String(character.experience)} />
            <Field
              label="Hearth"
              value={character.home_city?.name ?? "—"}
            />
            <Field
              label="Standing in"
              value={character.current_node?.name ?? "—"}
            />
            <Field
              label="Titles"
              value={
                character.titles.length === 0
                  ? "None yet"
                  : character.titles.join(", ")
              }
            />
          </dl>

          <div className="divider-laurel" />

          <div className="flex flex-wrap gap-3">
            <Link href="/game/map" className="btn-imperial">
              Open the map
            </Link>
            <Link href="/game/character" className="btn-ghost">
              View character
            </Link>
            <Link href="/game/work" className="btn-ghost">
              Find work
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-heading">Chronicle</h2>
        <div className="panel-body">
          {!events || events.length === 0 ? (
            <p className="font-serif italic text-parchment-deep">
              No deeds recorded yet. The empire is waiting.
            </p>
          ) : (
            <ul className="space-y-3">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="border-l-2 border-gold/30 pl-3 py-0.5"
                >
                  <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
                    {format(new Date(e.created_at), "d LLL · HH:mm")}
                  </div>
                  <div className="font-serif text-sm text-parchment">
                    {prettify(e.event_type)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim">
        {label}
      </dt>
      <dd className="font-serif text-parchment mt-0.5">{value}</dd>
    </div>
  );
}

function prettify(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function greeting(name: string) {
  const hour = new Date().getUTCHours();
  if (hour < 6) return `The night is long, ${name}.`;
  if (hour < 12) return `The morning courier brings news, ${name}.`;
  if (hour < 18) return `The empire toils on, ${name}.`;
  return `Evening falls over the empire, ${name}.`;
}
