"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export interface PoliticsState {
  ok: boolean;
  error: string | null;
}

const FAIL = (e: string): PoliticsState => ({ ok: false, error: e });
const OK: PoliticsState = { ok: true, error: null };

function friendly(raw?: string): string {
  const map: Record<string, string> = {
    position_not_found:       "That position doesn't exist.",
    election_already_open:    "An election for this position is already running.",
    character_not_found:      "Character not found.",
    election_not_open:        "This election is not currently open.",
    candidate_not_found:      "That candidate doesn't exist.",
    already_voted:            "You have already voted in this election.",
  };
  return map[raw ?? ""] ?? "Something went wrong. Try again.";
}

async function authCharacter() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("characters")
    .select("id, node_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { supabase, characterId: data.id as string, nodeId: data.node_id as number | null } : null;
}

// ─────────────────────────────────────────────────────────────────
// openElectionAction
// ─────────────────────────────────────────────────────────────────

export async function openElectionAction(
  _prev: PoliticsState,
  formData: FormData,
): Promise<PoliticsState> {
  const positionId = String(formData.get("position_id") ?? "").trim();
  const scopeId    = Number(formData.get("scope_id"));
  const hours      = Number(formData.get("closes_hours") ?? 24);

  if (!positionId)                             return FAIL("Select a position.");
  if (!Number.isFinite(scopeId) || scopeId <= 0) return FAIL("Invalid scope.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("open_election", {
    p_character_id: ctx.characterId,
    p_position_id:  positionId,
    p_scope_id:     scopeId,
    p_closes_hours: Math.max(1, Math.min(72, Math.floor(hours))),
  });

  if (error) {
    console.error("[openElectionAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/politics");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// castVoteAction
// ─────────────────────────────────────────────────────────────────

export async function castVoteAction(
  _prev: PoliticsState,
  formData: FormData,
): Promise<PoliticsState> {
  const electionId   = String(formData.get("election_id")   ?? "").trim();
  const candidateId  = String(formData.get("candidate_id")  ?? "").trim();

  if (!electionId)  return FAIL("Invalid election.");
  if (!candidateId) return FAIL("Select a candidate.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("cast_vote", {
    p_voter_id:     ctx.characterId,
    p_election_id:  electionId,
    p_candidate_id: candidateId,
  });

  if (error) {
    console.error("[castVoteAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/politics");
  revalidatePath(`/game/city`);
  return OK;
}
