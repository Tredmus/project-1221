"use client";

import { useActionState, useState } from "react";
import {
  buyOrderAction,
  createListingAction,
  cancelListingAction,
  type EconomyState,
} from "@/app/actions/economy";

const INIT: EconomyState = { ok: false, error: null };

// ──────────────────────────────────────────────────────────────────
// BuyRow — a single order row with an inline buy form.
// ──────────────────────────────────────────────────────────────────
interface BuyRowProps {
  order: {
    id: string;
    quantity: number;
    price_per_unit: number;
    seller_name: string;
    item_name: string;
  };
  characterCoins: number;
}

export function BuyRow({ order, characterCoins }: BuyRowProps) {
  const [state, formAction, isPending] = useActionState(buyOrderAction, INIT);
  const [qty, setQty] = useState(1);

  const maxQty = Math.min(order.quantity, Math.floor(characterCoins / order.price_per_unit));
  const canAfford = maxQty >= 1 && order.price_per_unit <= characterCoins;
  const total = qty * order.price_per_unit;

  if (state.ok) {
    return (
      <tr className="border-b border-gold/10">
        <td colSpan={5} className="py-2.5 px-3 font-serif italic text-verdigris text-sm">
          ✓ Purchased {qty} × {order.item_name} for {total} coins.
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gold/10 group hover:bg-imperial-shadow/30 transition">
      <td className="py-2.5 px-3 font-serif text-parchment">{order.item_name}</td>
      <td className="py-2.5 px-3 font-serif text-parchment-dark text-sm">{order.seller_name}</td>
      <td className="py-2.5 px-3 font-display text-gold-bright tabular-nums text-right">
        {order.price_per_unit}c
      </td>
      <td className="py-2.5 px-3 text-parchment-deep text-sm tabular-nums text-right">
        {order.quantity}
      </td>
      <td className="py-2.5 px-3 text-right">
        <form action={formAction} className="flex items-center gap-2 justify-end">
          <input type="hidden" name="order_id" value={order.id} />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setQty((v) => Math.max(1, v - 1))}
              className="w-5 h-5 text-gold-dim border border-gold/20 rounded-sm text-xs flex items-center justify-center hover:border-gold/60"
            >
              −
            </button>
            <input
              type="number"
              name="quantity"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(order.quantity, Number(e.target.value))))}
              min={1}
              max={order.quantity}
              className="w-12 text-center bg-imperial-shadow border border-gold/20 rounded-sm text-parchment text-sm py-0.5 [appearance:textfield]"
            />
            <button
              type="button"
              onClick={() => setQty((v) => Math.min(order.quantity, v + 1))}
              className="w-5 h-5 text-gold-dim border border-gold/20 rounded-sm text-xs flex items-center justify-center hover:border-gold/60"
            >
              +
            </button>
          </div>
          <button
            type="submit"
            disabled={!canAfford || isPending}
            className="btn-ghost text-[0.65rem]"
          >
            {isPending ? "…" : `Buy (${total}c)`}
          </button>
        </form>
        {state.error && (
          <p className="text-blood font-serif italic text-xs mt-0.5 text-right">{state.error}</p>
        )}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────
// CreateListingForm — list an item for sale.
// ──────────────────────────────────────────────────────────────────
interface InventoryOption {
  item_type_id: string;
  name: string;
  quantity: number;
}

interface CreateListingFormProps {
  cityId: number;
  inventory: InventoryOption[];
}

export function CreateListingForm({ cityId, inventory }: CreateListingFormProps) {
  const [state, formAction, isPending] = useActionState(createListingAction, INIT);
  const [selectedItemId, setSelectedItemId] = useState(inventory[0]?.item_type_id ?? "");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(1);

  const selectedItem = inventory.find((i) => i.item_type_id === selectedItemId);
  const maxQty = selectedItem?.quantity ?? 1;
  const totalValue = qty * price;

  if (inventory.length === 0) {
    return (
      <p className="font-serif italic text-parchment-deep text-sm">
        Your saddlebag is empty. Work to earn goods to sell.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="city_id" value={cityId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label-imperial" htmlFor="item_type_id">
            Item
          </label>
          <select
            id="item_type_id"
            name="item_type_id"
            value={selectedItemId}
            onChange={(e) => {
              setSelectedItemId(e.target.value);
              setQty(1);
            }}
            className="input-imperial"
          >
            {inventory.map((i) => (
              <option key={i.item_type_id} value={i.item_type_id}>
                {i.name} (×{Math.floor(i.quantity)})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label-imperial" htmlFor="list-qty">
            Quantity
          </label>
          <input
            id="list-qty"
            name="quantity"
            type="number"
            min={1}
            max={maxQty}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(maxQty, Number(e.target.value))))}
            className="input-imperial"
          />
          <p className="text-xs text-parchment-deep/70 mt-0.5">
            Max: {Math.floor(maxQty)}
          </p>
        </div>

        <div>
          <label className="label-imperial" htmlFor="list-price">
            Price per unit
          </label>
          <input
            id="list-price"
            name="price_per_unit"
            type="number"
            min={0}
            step={1}
            value={price}
            onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
            className="input-imperial"
          />
          <p className="text-xs text-parchment-deep/70 mt-0.5">
            Total: {totalValue} coins
          </p>
        </div>
      </div>

      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}
      {state.ok && (
        <p className="font-serif italic text-verdigris text-sm">
          ✓ Listed {qty} × {selectedItem?.name} at {price}c each.
        </p>
      )}

      <button type="submit" disabled={isPending || state.ok} className="btn-imperial">
        {isPending ? "Listing…" : `List for sale (${totalValue}c total)`}
      </button>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────
// CancelListingButton — cancel your own listing.
// ──────────────────────────────────────────────────────────────────
interface CancelButtonProps {
  orderId: string;
  itemName: string;
  quantity: number;
}

export function CancelListingButton({ orderId, itemName, quantity }: CancelButtonProps) {
  const [state, formAction, isPending] = useActionState(cancelListingAction, INIT);

  if (state.ok) {
    return (
      <span className="font-serif italic text-verdigris text-xs">
        ✓ Cancelled — {quantity} {itemName} returned.
      </span>
    );
  }

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="order_id" value={orderId} />
      {state.error && (
        <span className="text-blood text-xs font-serif italic mr-2">{state.error}</span>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="font-display uppercase tracking-imperial text-[0.6rem] text-blood hover:text-blood/80 border border-blood/30 hover:border-blood/60 px-2 py-0.5 rounded-sm transition"
      >
        {isPending ? "…" : "Cancel"}
      </button>
    </form>
  );
}
