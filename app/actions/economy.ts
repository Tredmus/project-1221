"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────

export interface EconomyState {
  error: string | null;
  ok: boolean;
}

const FAIL = (error: string): EconomyState => ({ ok: false, error });
const OK: EconomyState = { ok: true, error: null };

function friendlyRpcError(raw: string | undefined): string {
  const map: Record<string, string> = {
    insufficient_ap:          "Not enough action points. Refills at midnight.",
    character_not_found:      "Character not found.",
    building_not_found:       "Building not found.",
    not_at_this_city:         "You must be in this city to perform that action.",
    ap_must_be_positive:      "AP amount must be greater than zero.",
    quantity_must_be_positive:"Quantity must be greater than zero.",
    price_cannot_be_negative: "Price cannot be negative.",
    insufficient_inventory:   "You don't have enough of that item.",
    order_not_found_or_closed:"That listing is no longer available.",
    cannot_buy_own_listing:   "You can't buy your own listing.",
    quantity_exceeds_listing:  "That quantity is no longer available.",
    order_not_found_or_not_yours: "Listing not found or doesn't belong to you.",
    insufficient_funds:       "Not enough coins.",
  };
  return map[raw ?? ""] ?? "Something went wrong. Try again.";
}

async function authCharacter() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("characters")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return data ? { supabase, characterId: data.id as string } : null;
}

// ─────────────────────────────────────────────────────────────────
// queueWorkAction
// ─────────────────────────────────────────────────────────────────

export async function queueWorkAction(
  _prev: EconomyState,
  formData: FormData,
): Promise<EconomyState> {
  const buildingId = Number(formData.get("building_id"));
  const apToSpend  = Number(formData.get("ap_to_spend"));

  if (!Number.isFinite(buildingId) || buildingId <= 0)
    return FAIL("Invalid building.");
  if (!Number.isFinite(apToSpend) || apToSpend < 1)
    return FAIL("Enter at least 1 action point.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("queue_work_action", {
    p_character_id: ctx.characterId,
    p_building_id:  Math.floor(buildingId),
    p_ap_to_spend:  Math.floor(apToSpend),
  });

  if (error) {
    console.error("[queueWorkAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendlyRpcError(result.error));

  revalidatePath("/game/work");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// createListingAction
// ─────────────────────────────────────────────────────────────────

export async function createListingAction(
  _prev: EconomyState,
  formData: FormData,
): Promise<EconomyState> {
  const cityId       = Number(formData.get("city_id"));
  const itemTypeId   = String(formData.get("item_type_id") ?? "").trim();
  const quantity     = Number(formData.get("quantity"));
  const pricePerUnit = Number(formData.get("price_per_unit"));

  if (!Number.isFinite(cityId) || cityId <= 0)    return FAIL("Invalid city.");
  if (!itemTypeId)                                  return FAIL("Select an item to list.");
  if (!Number.isFinite(quantity) || quantity <= 0)  return FAIL("Quantity must be positive.");
  if (!Number.isFinite(pricePerUnit) || pricePerUnit < 0)
    return FAIL("Price must be zero or more.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("create_market_listing", {
    p_seller_id:      ctx.characterId,
    p_city_id:        Math.floor(cityId),
    p_item_type_id:   itemTypeId,
    p_quantity:       quantity,
    p_price_per_unit: pricePerUnit,
  });

  if (error) {
    console.error("[createListingAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendlyRpcError(result.error));

  revalidatePath("/game/market");
  revalidatePath("/game/city");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// buyOrderAction
// ─────────────────────────────────────────────────────────────────

export async function buyOrderAction(
  _prev: EconomyState,
  formData: FormData,
): Promise<EconomyState> {
  const orderId = String(formData.get("order_id") ?? "").trim();
  const quantity = Number(formData.get("quantity"));

  if (!orderId)                                     return FAIL("Invalid order.");
  if (!Number.isFinite(quantity) || quantity <= 0)  return FAIL("Quantity must be positive.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("fill_market_order", {
    p_buyer_id:  ctx.characterId,
    p_order_id:  orderId,
    p_quantity:  quantity,
  });

  if (error) {
    console.error("[buyOrderAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendlyRpcError(result.error));

  revalidatePath("/game/market");
  revalidatePath("/game/character");
  revalidatePath("/game");
  return OK;
}

// ─────────────────────────────────────────────────────────────────
// cancelListingAction
// ─────────────────────────────────────────────────────────────────

export async function cancelListingAction(
  _prev: EconomyState,
  formData: FormData,
): Promise<EconomyState> {
  const orderId = String(formData.get("order_id") ?? "").trim();
  if (!orderId) return FAIL("Invalid order.");

  const ctx = await authCharacter();
  if (!ctx) return FAIL("Not authenticated.");

  const { data, error } = await ctx.supabase.rpc("cancel_market_order", {
    p_character_id: ctx.characterId,
    p_order_id:     orderId,
  });

  if (error) {
    console.error("[cancelListingAction]", error);
    return FAIL("Server error. Try again.");
  }

  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return FAIL(friendlyRpcError(result.error));

  revalidatePath("/game/market");
  revalidatePath("/game/character");
  return OK;
}
