"use client";

import { useActionState } from "react";
import { seedWorldAction, type SeedState } from "../actions";

const initialState: SeedState = { error: null, summary: null };

export default function SeedForm({ sample }: { sample: string }) {
  const [state, formAction, isPending] = useActionState(
    seedWorldAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <textarea
        name="payload"
        defaultValue={sample}
        rows={20}
        spellCheck={false}
        className="input-imperial font-mono text-xs whitespace-pre"
      />

      {state.error ? (
        <p className="text-blood font-serif italic">{state.error}</p>
      ) : null}

      {state.summary ? (
        <pre className="rounded-sm border border-verdigris/40 bg-imperial-shadow/60 p-3 text-xs text-parchment">
          {state.summary}
        </pre>
      ) : null}

      <div className="flex gap-3">
        <button type="submit" disabled={isPending} className="btn-imperial">
          {isPending ? "Sealing decree…" : "Seed world"}
        </button>
      </div>
    </form>
  );
}
