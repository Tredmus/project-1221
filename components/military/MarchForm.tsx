"use client";

import { useActionState } from "react";
import { marchAction, type MilitaryState } from "@/app/actions/military";

const INIT: MilitaryState = { ok: false, error: null };

interface Node {
  id: number;
  name: string | null;
  type: string;
}

export default function MarchForm({ adjacentNodes }: { adjacentNodes: Node[] }) {
  const [state, formAction, isPending] = useActionState(marchAction, INIT);

  if (state.ok) {
    return (
      <p className="font-serif italic text-verdigris text-sm">
        ✓ Your army is on the march.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap gap-2">
      <select name="target_node_id" className="input-imperial flex-1">
        {adjacentNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name ?? `Node #${n.id}`} ({n.type})
          </option>
        ))}
      </select>
      <button type="submit" disabled={isPending} className="btn-imperial">
        {isPending ? "Marching…" : "March →"}
      </button>
      {state.error && (
        <p className="w-full font-serif italic text-blood text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
