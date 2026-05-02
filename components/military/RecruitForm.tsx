"use client";

import { useActionState, useState } from "react";
import { recruitAction, type MilitaryState } from "@/app/actions/military";

const INIT: MilitaryState = { ok: false, error: null };
const COST_PER_SOLDIER = 5;

export default function RecruitForm({ characterCoins }: { characterCoins: number }) {
  const [state, formAction, isPending] = useActionState(recruitAction, INIT);
  const [count, setCount] = useState(10);

  const maxAffordable = Math.floor(characterCoins / COST_PER_SOLDIER);
  const safeCnt = Math.min(count, maxAffordable);
  const totalCost = safeCnt * COST_PER_SOLDIER;

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="label-imperial mb-0" htmlFor="recruit-count">
            Soldiers to recruit
          </label>
          <span className="font-serif text-xs text-parchment-deep">
            {characterCoins} coins available · {COST_PER_SOLDIER}c each
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            id="recruit-count"
            type="range"
            min={1}
            max={Math.max(1, maxAffordable)}
            value={safeCnt}
            onChange={(e) => setCount(Number(e.target.value))}
            className="flex-1 accent-gold"
          />
          <input
            type="number"
            name="count"
            value={safeCnt}
            onChange={(e) =>
              setCount(Math.max(1, Math.min(maxAffordable, Number(e.target.value))))
            }
            min={1}
            max={maxAffordable}
            className="w-16 text-center bg-imperial-shadow border border-gold/20 rounded-sm text-parchment text-sm py-1 [appearance:textfield]"
          />
        </div>
      </div>

      <div className="bg-imperial-shadow/60 rounded-sm border border-gold/10 px-3 py-2.5 text-sm flex justify-between">
        <span className="font-serif text-parchment-dark">Total cost</span>
        <span className="font-display text-gold-bright tabular-nums">
          {totalCost} coins
        </span>
      </div>

      {state.ok && (
        <p className="font-serif italic text-verdigris text-sm">
          ✓ {safeCnt} soldiers join your ranks.
        </p>
      )}
      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={isPending || maxAffordable < 1}
        className="btn-imperial w-full"
      >
        {isPending
          ? "Mustering…"
          : maxAffordable < 1
          ? "Not enough coins"
          : `Recruit ${safeCnt} soldiers (${totalCost}c)`}
      </button>
    </form>
  );
}
