import "server-only";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { CurrentCharacter, Profession } from "@/lib/types/game.types";

/**
 * The single source of "who is the user playing right now?" for any
 * authenticated game page. Use this from Server Components.
 *
 * - If the visitor isn't logged in, redirects to /auth/login.
 * - If they're logged in but have no character row yet, redirects to
 *   /onboarding.
 * - Otherwise returns a denormalised view with the character, their
 *   current node, and home city joined in.
 *
 * The returned shape is what's threaded into the game shell (AP bar,
 * coin display, top nav). Don't add fields to it without first thinking
 * about the cost of fetching them on every page.
 */
export async function getCurrentCharacter(): Promise<CurrentCharacter> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data, error } = await supabase
    .from("characters")
    .select(
      `
        id, user_id, name, profession, level, experience,
        coins, gems, action_points, max_action_points, travel_tier,
        strength, craft, charisma, intelligence,
        titles, clan_id, clan_role,
        home_city_id, node_id,
        home_city:cities!characters_home_city_id_fkey ( id, name ),
        current_node:nodes!characters_node_id_fkey (
          id, name, type, map_x, map_y, county_id
        )
      `,
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // Don't leak Postgres internals to the page; logging is enough.
    console.error("[getCurrentCharacter]", error);
    throw new Error("Could not load your character.");
  }

  if (!data) {
    redirect("/onboarding");
  }

  // Supabase's typed-result inference for joined columns can return
  // arrays in some configurations. Normalise to a single object or null.
  const home_city = Array.isArray(data.home_city)
    ? (data.home_city[0] ?? null)
    : (data.home_city ?? null);

  const current_node = Array.isArray(data.current_node)
    ? (data.current_node[0] ?? null)
    : (data.current_node ?? null);

  return {
    ...data,
    profession: data.profession as Profession,
    clan_role: data.clan_role as CurrentCharacter["clan_role"],
    home_city,
    current_node: current_node
      ? {
          ...current_node,
          map_x: Number(current_node.map_x),
          map_y: Number(current_node.map_y),
        }
      : null,
  };
}
