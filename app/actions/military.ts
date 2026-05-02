"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export interface MilitaryState {
  ok: boolean;
  error: string | null;
}

const FAIL = (e: string): MilitaryState => ({ ok: false, error: e });
const OK: MilitaryState = { ok: true, error: null };

function friendly(raw?: string): string {
  const map: Record<string, string> = {
    character_not_found:   "Character not found.",
    insufficient_funds:    "Not enough coins. Soldiers cost 5 coins each.",
    count_must_be_positive:"Recruit at least 1 soldier.",
    no_army:               "You have no army yet. Recruit some soldiers first.",
    army_is_empty:         "Your army is empty.",
    not_adjacent:          "Your army cannot march there — nodes are not adjacent.",
  };
  return map[raw ?? ""] ?? "Something went wrong. Try again.";
}

async function authCharacter() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("characters")
    .select("id, coins, node_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data
    ? { supabase, characterId: data.id as string, coins: data.coins as number, nodeId: data.node_id as number | null }
    : null;
}

// ─────────────────────────────────────────────────────────────────
// recruitAction
// ─────────────────────────────────────────────────────────────────

export async function recruitAction(
  _prev: MilitaryState,
  formData: FormData,
): Promise<MilitaryState> {
  const count = Number(formData.get("count") ?? 0);
  if (!Number.isFinite(count) || count < 1) return FAIL("Enter a positive number.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("recruit_soldiers", {
    p_character_id: ctx.characterId,
    p_count:        Math.floor(count),
  });

  if (error) {
    console.error("[recruitAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/military");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// marchAction
// ─────────────────────────────────────────────────────────────────

export async function marchAction(
  _prev: MilitaryState,
  formData: FormData,
): Promise<MilitaryState> {
  const targetNodeId = Number(formData.get("target_node_id"));
  if (!Number.isFinite(targetNodeId) || targetNodeId <= 0)
    return FAIL("Invalid target node.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("march_army", {
    p_character_id:   ctx.characterId,
    p_target_node_id: Math.floor(targetNodeId),
  });

  if (error) {
    console.error("[marchAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/military");
  return OK;
}
