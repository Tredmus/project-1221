"use client";

import { useActionState } from "react";
import { markAllReadAction } from "@/app/actions/clan";

export default function MarkAllReadButton() {
  const [state, formAction, isPending] = useActionState(markAllReadAction, {
    ok: false,
    error: null,
  });

  if (state.ok) {
    return (
      <span className="font-serif italic text-verdigris text-sm">
        ✓ All marked as read.
      </span>
    );
  }

  return (
    <form action={formAction}>
      <button type="submit" disabled={isPending} className="btn-ghost">
        {isPending ? "Marking…" : "Mark all as read"}
      </button>
      {state.error && (
        <span className="font-serif italic text-blood text-sm ml-2">
          {state.error}
        </span>
      )}
    </form>
  );
}
