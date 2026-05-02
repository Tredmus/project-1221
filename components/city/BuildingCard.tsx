"use client";

import { useActionState, useState } from "react";
import {
  queueWorkAction,
  type EconomyState,
} from "@/app/actions/economy";

interface BuildingCardProps {
  building: {
    id: number;
    level: number;
    building_type_id: string;
    name: string;
    output_item_id: string | null;
    output_item_name: string | null;
    output_qty_per_ap: number;
    wage_per_ap: number;
    required_stat: string | null;
  };
  characterAP: number;
  /** The stat value relevant to this building (e.g. strength, craft). */
  relevantStatValue: number;
}

const INITIAL: EconomyState = { ok: false, error: null };

export default function BuildingCard({
  building,
  characterAP,
  relevantStatValue,
}: BuildingCardProps) {
  const [state, formAction, isPending] = useActionState(queueWorkAction, INITIAL);
  const [ap, setAp] = useState(1);

  const maxAp = Math.max(1, characterAP);
  const effectiveAp = Math.min(ap, maxAp);
  const projectedItems = building.output_item_id
    ? effectiveAp * building.output_qty_per_ap
    : null;
  const projectedWage = effectiveAp * building.wage_per_ap;

  const statLabel = building.required_stat
    ? building.required_stat.charAt(0).toUpperCase() +
      building.required_stat.slice(1)
    : null;

  return (
    <div
      className={`panel transition ${
        state.ok ? "border-verdigris/40" : ""
      }`}
    >
      <div className="panel-heading flex items-center justify-between">
        <span>
          {building.name}{" "}
          <span className="text-parchment-deep/70">lv {building.level}</span>
        </span>
        {statLabel ? (
          <span className="text-parchment-deep">
            {statLabel} {relevantStatValue}
          </span>
        ) : null}
      </div>
      <div className="panel-body space-y-4">
        {/* Output info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="label-imperial mb-0">Produces</div>
            <div className="font-serif text-parchment">
              {building.output_item_name ? (
                <>
                  <span className="text-gold-bright">
                    {building.output_qty_per_ap}
                  </span>
                  <span className="text-parchment-dark">
                    {" "}
                    {building.output_item_name} / AP
                  </span>
                </>
              ) : (
                <span className="italic text-parchment-deep">No goods</span>
              )}
            </div>
          </div>
          <div>
            <div className="label-imperial mb-0">Wage</div>
            <div className="font-serif text-parchment">
              <span className="text-gold-bright">{building.wage_per_ap}</span>
              <span className="text-parchment-dark"> coin / AP</span>
            </div>
          </div>
        </div>

        {/* AP slider */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label
              className="label-imperial mb-0"
              htmlFor={`ap-${building.id}`}
            >
              AP to commit
            </label>
            <span className="font-display text-xs text-parchment-deep">
              {characterAP} available
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              id={`ap-${building.id}`}
              type="range"
              min={1}
              max={maxAp}
              value={effectiveAp}
              onChange={(e) => setAp(Number(e.target.value))}
              className="flex-1 accent-gold"
            />
            <span className="font-display text-gold-bright text-sm w-6 text-right tabular-nums">
              {effectiveAp}
            </span>
          </div>
        </div>

        {/* Projection */}
        <div className="bg-imperial-shadow/60 rounded-sm border border-gold/10 px-3 py-2.5 text-sm">
          <div className="font-display uppercase tracking-imperial text-[0.65rem] text-gold-dim mb-2">
            Tonight you will earn
          </div>
          <div className="flex flex-wrap gap-4">
            {projectedItems !== null && building.output_item_name ? (
              <span className="font-serif text-parchment">
                <span className="text-gold-bright font-display">
                  {projectedItems}
                </span>{" "}
                {building.output_item_name}
              </span>
            ) : null}
            <span className="font-serif text-parchment">
              <span className="text-gold-bright font-display">
                {projectedWage}
              </span>{" "}
              coin{projectedWage !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Success / Error */}
        {state.ok ? (
          <p className="font-serif italic text-verdigris text-sm">
            ✓ Queued. You will receive your earnings at midnight.
          </p>
        ) : state.error ? (
          <p className="font-serif italic text-blood text-sm">{state.error}</p>
        ) : null}

        {/* Submit form */}
        <form action={formAction}>
          <input type="hidden" name="building_id" value={building.id} />
          <input type="hidden" name="ap_to_spend" value={effectiveAp} />
          <button
            type="submit"
            disabled={isPending || characterAP < 1 || state.ok}
            className="btn-imperial w-full"
          >
            {isPending
              ? "Sealing the deed…"
              : state.ok
              ? "Queued for tonight"
              : `Work here (${effectiveAp} AP)`}
          </button>
        </form>
      </div>
    </div>
  );
}
