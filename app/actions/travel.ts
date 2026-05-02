"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { dijkstra } from "@/lib/game/pathfinding";
import type { ConnectionInput } from "@/lib/game/pathfinding";

/**
 * The shape returned by the travelAction when it does NOT redirect.
 * On success the action revalidates the map and returns ok. On failure
 * it returns an error string for the client to display.
 */
export interface TravelState {
  error: string | null;
  apRemaining: number | null;
}

const INITIAL_STATE: TravelState = { error: null, apRemaining: null };
export { INITIAL_STATE as TRAVEL_INITIAL_STATE };

/**
 * Move a character from their current node to a target node, spending AP.
 *
 * Security model:
 *   1. The Server Action fetches the character's own row (RLS-enforced —
 *      you can only read your own character).
 *   2. It re-computes the path server-side from the live DB connections.
 *      We don't trust the client-supplied `ap_cost` — only `target_node_id`
 *      is taken from the form; cost is computed here.
 *   3. The atomic `spend_ap_and_travel` RPC does the final AP check and
 *      deduction inside a row-locked transaction.
 *
 * This two-layer approach means:
 *   - A client cannot fake a lower AP cost.
 *   - A race condition (two concurrent requests) cannot bypass the AP check.
 */
export async function travelAction(
  _prev: TravelState,
  formData: FormData,
): Promise<TravelState> {
  const targetNodeIdRaw = Number(formData.get("target_node_id"));

  if (!Number.isFinite(targetNodeIdRaw) || targetNodeIdRaw <= 0) {
    return { error: "Invalid destination.", apRemaining: null };
  }
  const targetNodeId = Math.floor(targetNodeIdRaw);

  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated.", apRemaining: null };

  // Fetch character + current node in one RLS-enforced query.
  const { data: character, error: charErr } = await supabase
    .from("characters")
    .select("id, node_id, action_points, travel_tier")
    .eq("user_id", user.id)
    .maybeSingle();

  if (charErr || !character) {
    return { error: "Could not load your character.", apRemaining: null };
  }
  if (character.node_id === null) {
    return { error: "Your character has no starting location.", apRemaining: null };
  }
  if (character.node_id === targetNodeId) {
    return { error: "You are already there.", apRemaining: null };
  }

  // Fetch all connections for authoritative server-side pathfinding.
  const { data: rawConns, error: connErr } = await supabase
    .from("node_connections")
    .select("node_a_id, node_b_id, travel_cost, min_tier_required");

  if (connErr) {
    return { error: "Could not load the road network.", apRemaining: null };
  }

  const connections: ConnectionInput[] = (rawConns ?? []).map((c) => ({
    node_a_id: c.node_a_id,
    node_b_id: c.node_b_id,
    travel_cost: c.travel_cost,
    min_tier_required: c.min_tier_required,
  }));

  const pathResult = dijkstra(
    connections,
    character.node_id,
    targetNodeId,
    character.travel_tier ?? 1,
  );

  if (!pathResult.reachable) {
    return {
      error: "No passable road to that destination from here.",
      apRemaining: null,
    };
  }

  const apCost = pathResult.totalCost;

  if (character.action_points < apCost) {
    return {
      error: `Not enough action points. Need ${apCost}, have ${character.action_points}. Refills at midnight.`,
      apRemaining: null,
    };
  }

  // Atomic move: locked transaction, AP deduction, game_event insert.
  const { data: result, error: rpcErr } = await supabase.rpc(
    "spend_ap_and_travel",
    {
      p_character_id:   character.id,
      p_target_node_id: targetNodeId,
      p_ap_cost:        apCost,
    },
  );

  if (rpcErr) {
    console.error("[travel] rpc error", rpcErr);
    return { error: "Travel failed. Try again.", apRemaining: null };
  }

  // The RPC returns a JSONB object.
  const rpcResult = result as { ok: boolean; error?: string; ap_remaining?: number };

  if (!rpcResult.ok) {
    const known: Record<string, string> = {
      insufficient_ap:    "Not enough action points. Refills at midnight.",
      character_not_found: "Character not found.",
      invalid_ap_cost:    "Invalid AP cost (server error).",
    };
    return {
      error: known[rpcResult.error ?? ""] ?? "Travel failed.",
      apRemaining: null,
    };
  }

  // Success — invalidate the map so the server component re-fetches
  // the character's new position on the next navigation.
  revalidatePath("/game/map");
  revalidatePath("/game");

  return { error: null, apRemaining: rpcResult.ap_remaining ?? null };
}
