"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────
// Shared types & helpers
// ─────────────────────────────────────────────────────────────────

export interface ClanState {
  ok: boolean;
  error: string | null;
}

const FAIL = (error: string): ClanState => ({ ok: false, error });
const OK: ClanState = { ok: true, error: null };

function friendly(raw: string | undefined): string {
  const map: Record<string, string> = {
    character_not_found:    "Character not found.",
    already_in_clan:        "You are already in a clan.",
    name_too_short:         "Clan name must be at least 3 characters.",
    tag_invalid_length:     "Tag must be 2–5 characters.",
    name_taken:             "That name is already taken.",
    tag_taken:              "That tag is already taken.",
    not_in_clan:            "You are not in a clan.",
    insufficient_role:      "You need to be a leader or officer to do that.",
    cannot_invite_self:     "You can't invite yourself.",
    target_already_in_clan: "That character is already in a clan.",
    invite_not_found:       "Invitation not found or already answered.",
    insufficient_funds:     "Not enough coins.",
    amount_must_be_positive:"Amount must be greater than zero.",
  };
  return map[raw ?? ""] ?? "Something went wrong. Please try again.";
}

async function authCharacter() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("characters")
    .select("id, clan_id, clan_role")
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? { supabase, characterId: data.id as string, clanId: data.clan_id as string | null, clanRole: data.clan_role as string | null } : null;
}

// ─────────────────────────────────────────────────────────────────
// createClanAction
// ─────────────────────────────────────────────────────────────────

export async function createClanAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const name = String(formData.get("name") ?? "").trim();
  const tag  = String(formData.get("tag")  ?? "").trim();

  if (!name) return FAIL("Enter a clan name.");
  if (!tag)  return FAIL("Enter a clan tag.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("create_clan", {
    p_leader_id: ctx.characterId,
    p_name:      name,
    p_tag:       tag,
  });

  if (error) {
    console.error("[createClanAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// inviteCharacterAction
// ─────────────────────────────────────────────────────────────────

export async function inviteCharacterAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const targetName = String(formData.get("character_name") ?? "").trim();
  if (!targetName) return FAIL("Enter a character name.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");
  if (!ctx.clanId) return FAIL("You are not in a clan.");

  const { data, error } = await ctx.supabase.rpc("invite_to_clan", {
    p_inviter_id:  ctx.characterId,
    p_target_name: targetName,
    p_clan_id:     ctx.clanId,
  });

  if (error) {
    console.error("[inviteCharacterAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// acceptInviteAction
// ─────────────────────────────────────────────────────────────────

export async function acceptInviteAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  if (!inviteId) return FAIL("Invalid invitation.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("accept_clan_invite", {
    p_character_id: ctx.characterId,
    p_invite_id:    inviteId,
  });

  if (error) {
    console.error("[acceptInviteAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// declineInviteAction
// ─────────────────────────────────────────────────────────────────

export async function declineInviteAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const inviteId = String(formData.get("invite_id") ?? "").trim();
  if (!inviteId) return FAIL("Invalid invitation.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("decline_clan_invite", {
    p_character_id: ctx.characterId,
    p_invite_id:    inviteId,
  });

  if (error) {
    console.error("[declineInviteAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// leaveClanAction
// ─────────────────────────────────────────────────────────────────

export async function leaveClanAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  // Confirmation field prevents accidental submits.
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "LEAVE") return FAIL('Type LEAVE to confirm.');

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("leave_clan", {
    p_character_id: ctx.characterId,
  });

  if (error) {
    console.error("[leaveClanAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// depositTreasuryAction
// ─────────────────────────────────────────────────────────────────

export async function depositTreasuryAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const amount = Number(formData.get("amount") ?? 0);
  if (!Number.isFinite(amount) || amount <= 0)
    return FAIL("Enter a positive amount.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("deposit_to_clan_treasury", {
    p_character_id: ctx.characterId,
    p_amount:       amount,
  });

  if (error) {
    console.error("[depositTreasuryAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendly(result.error));

  revalidatePath("/game/clan");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// postMessageAction
// ─────────────────────────────────────────────────────────────────

export async function postMessageAction(
  _prev: ClanState,
  formData: FormData,
): Promise<ClanState> {
  const content = String(formData.get("content") ?? "").trim();
  if (!content)          return FAIL("Message cannot be empty.");
  if (content.length > 500) return FAIL("Maximum 500 characters.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");
  if (!ctx.clanId) return FAIL("You are not in a clan.");

  const { error } = await ctx.supabase
    .from("clan_messages")
    .insert({
      clan_id:   ctx.clanId,
      author_id: ctx.characterId,
      content,
    });

  if (error) {
    console.error("[postMessageAction]", error);
    return FAIL("Could not post message. Try again.");
  }

  revalidatePath("/game/clan");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// markAllReadAction
// ─────────────────────────────────────────────────────────────────

export async function markAllReadAction(
  _prev: ClanState,
): Promise<ClanState> {
  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { error } = await ctx.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("character_id", ctx.characterId)
    .is("read_at", null);

  if (error) {
    console.error("[markAllReadAction]", error);
    return FAIL("Could not mark notifications as read.");
  }

  revalidatePath("/game/notifications");
  revalidatePath("/game");
  return OK;
}
