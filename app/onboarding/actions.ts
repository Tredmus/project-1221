"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Profession } from "@/lib/types/game.types";

export interface OnboardingState {
  error: string | null;
}

const VALID_PROFESSIONS: ReadonlySet<Profession> = new Set([
  "peasant",
  "soldier",
  "merchant",
  "blacksmith",
  "farmer",
  "miner",
  "politician",
  "priest",
]);

export async function createCharacterAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const name = String(formData.get("name") ?? "").trim();
  const profession = String(formData.get("profession") ?? "") as Profession;
  const cityIdRaw = String(formData.get("city_id") ?? "");
  const cityId = Number.parseInt(cityIdRaw, 10);

  if (!name || name.length < 2 || name.length > 32) {
    return { error: "Pick a name between 2 and 32 characters." };
  }
  if (!VALID_PROFESSIONS.has(profession)) {
    return { error: "Choose a profession." };
  }
  if (!Number.isFinite(cityId) || cityId <= 0) {
    return { error: "Choose a starting city." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // Look up the city's node — characters spawn at the city's node.
  const { data: city, error: cityErr } = await supabase
    .from("cities")
    .select("id, node_id")
    .eq("id", cityId)
    .maybeSingle();

  if (cityErr) {
    console.error("[onboarding] city lookup", cityErr);
    return { error: "Could not load that city. Try another." };
  }
  if (!city) return { error: "That city does not exist." };

  // Create the character. The user_id FK enforces the public.users row
  // exists; the handle_new_user trigger guarantees that, so this should
  // always succeed unless someone deleted their users row.
  const { error: insertErr } = await supabase.from("characters").insert({
    user_id: user.id,
    name,
    profession,
    home_city_id: city.id,
    node_id: city.node_id,
  });

  if (insertErr) {
    console.error("[onboarding] insert", insertErr);
    if (insertErr.message?.toLowerCase().includes("characters_user_id"))
      return { error: "You already have a character." };
    return { error: "Could not create your character. Try again." };
  }

  redirect("/");
}
