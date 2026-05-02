"use client";

import { useActionState } from "react";
import { openElectionAction, type PoliticsState } from "@/app/actions/politics";

const INIT: PoliticsState = { ok: false, error: null };

interface OpenElectionFormProps {
  positions: Array<{ id: string; scope: string; term_days: number }>;
  scopeId: number;
}

export default function OpenElectionForm({ positions, scopeId }: OpenElectionFormProps) {
  const [state, formAction, isPending] = useActionState(openElectionAction, INIT);

  if (state.ok) {
    return (
      <p className="font-serif italic text-verdigris text-sm">
        ✓ Election opened. Voting closes in 24 hours.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap gap-3 items-end">
      <input type="hidden" name="scope_id" value={scopeId} />
      <input type="hidden" name="closes_hours" value="24" />
      <div>
        <label className="label-imperial" htmlFor="open-pos">Position</label>
        <select id="open-pos" name="position_id" className="input-imperial">
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id.charAt(0).toUpperCase() + p.id.slice(1)} ({p.scope}, {p.term_days}d term)
            </option>
          ))}
        </select>
      </div>
      {state.error && (
        <p className="w-full font-serif italic text-blood text-sm">{state.error}</p>
      )}
      <button type="submit" disabled={isPending} className="btn-imperial self-end">
        {isPending ? "Opening…" : "Open election"}
      </button>
    </form>
  );
}
