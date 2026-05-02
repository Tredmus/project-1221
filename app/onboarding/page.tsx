import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatSupabaseError } from "@/lib/supabase/formatError";
import OnboardingForm from "./OnboardingForm";
import { PROFESSIONS } from "@/lib/types/game.types";

export const metadata = {
  title: "Choose your path · Imperium",
};

/** Always fetch cities with the current session — never cache an empty list. */
export const dynamic = "force-dynamic";

type CityRow = { id: number; name: string; properties: unknown };

/**
 * Load starting cities: table SELECT first (needs GRANT + RLS), then RPC
 * `list_starting_cities` if still empty (SECURITY DEFINER — works when grants lag).
 */
async function loadStartingCities(supabase: Awaited<ReturnType<typeof createServerSupabase>>): Promise<{
  rows: CityRow[];
  warn: string | null;
}> {
  const table = await supabase
    .from("cities")
    .select("id, name, properties")
    .order("name");

  if (!table.error && (table.data?.length ?? 0) > 0) {
    return { rows: table.data as CityRow[], warn: null };
  }

  const rpc = await supabase.rpc("list_starting_cities");

  if (!rpc.error && (rpc.data as CityRow[] | null)?.length) {
    return { rows: rpc.data as CityRow[], warn: null };
  }

  const rows = ((rpc.data as CityRow[] | null) ?? (table.data as CityRow[] | null) ?? []) as CityRow[];
  const err = rpc.error ?? table.error;
  const warn =
    rows.length === 0 && err
      ? formatSupabaseError(err)
      : rows.length === 0
        ? "No rows from public.cities and list_starting_cities RPC returned empty (run migrations 008–009 in Supabase SQL?)."
        : null;

  return { rows, warn };
}

/**
 * Onboarding page. Shown the first time a user logs in, before they have a
 * character row. The middleware sends them here automatically; this page
 * loads the list of starting cities (cities flagged via the schema seed)
 * and presents the profession-and-city selector.
 */
export default async function OnboardingPage() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { count } = await supabase
    .from("characters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) > 0) redirect("/");

  const { rows: cities, warn } = await loadStartingCities(supabase);

  if (warn) {
    // warn — not error — so Next dev overlay does not treat this as a crash
    console.warn("[onboarding] cities:", warn);
  }

  const startingCities = cities.map((c) => ({
    id: c.id,
    name: c.name,
    description:
      typeof c.properties === "object" &&
      c.properties !== null &&
      "description" in c.properties &&
      typeof (c.properties as Record<string, unknown>).description === "string"
        ? ((c.properties as Record<string, unknown>).description as string)
        : null,
  }));

  return (
    <main className="page-root mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-12">
      <header className="text-center">
        <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
          Genesis
        </p>
        <h1 className="mt-3">Choose your path</h1>
        <div className="divider-laurel max-w-md mx-auto" />
        <p className="font-serif text-lg text-parchment-dark max-w-2xl mx-auto">
          Every empire begins with a single soul. Tell us who you are, what
          you do, and where you call home.
        </p>
      </header>

      <section className="mt-10">
        <OnboardingForm
          professions={[...PROFESSIONS]}
          cities={startingCities}
        />
      </section>
    </main>
  );
}
