"use client";

import { useActionState } from "react";
import { createClanAction, type ClanState } from "@/app/actions/clan";

const INIT: ClanState = { ok: false, error: null };

export default function CreateClanForm() {
  const [state, formAction, isPending] = useActionState(createClanAction, INIT);

  if (state.ok) {
    return (
      <p className="font-serif italic text-verdigris text-sm">
        ✓ Your clan has been founded. Refresh to see your hall.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label-imperial" htmlFor="clan-name">
            Clan name
          </label>
          <input
            id="clan-name"
            name="name"
            type="text"
            required
            minLength={3}
            maxLength={40}
            placeholder="House of the Golden Spear"
            className="input-imperial"
          />
          <p className="text-xs text-parchment-deep/70 mt-0.5">
            Min 3 chars · must be unique
          </p>
        </div>
        <div>
          <label className="label-imperial" htmlFor="clan-tag">
            Tag
          </label>
          <input
            id="clan-tag"
            name="tag"
            type="text"
            required
            minLength={2}
            maxLength={5}
            placeholder="GOLD"
            className="input-imperial uppercase"
          />
          <p className="text-xs text-parchment-deep/70 mt-0.5">
            2–5 chars, displayed as [TAG]
          </p>
        </div>
      </div>

      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="btn-imperial"
      >
        {isPending ? "Founding…" : "Found this clan"}
      </button>
    </form>
  );
}
