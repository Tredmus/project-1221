"use client";

import { useActionState } from "react";
import { castVoteAction, type PoliticsState } from "@/app/actions/politics";

const INIT: PoliticsState = { ok: false, error: null };

interface Candidate {
  id: string;
  name: string;
  profession: string;
}

interface VoteFormProps {
  electionId: string;
  candidates: Candidate[];
  hasVoted: boolean;
  myVoteFor: string | null;
}

export default function VoteForm({
  electionId,
  candidates,
  hasVoted,
  myVoteFor,
}: VoteFormProps) {
  const [state, formAction, isPending] = useActionState(castVoteAction, INIT);

  if (state.ok || hasVoted) {
    const voted = candidates.find((c) => c.id === myVoteFor);
    return (
      <p className="font-serif italic text-verdigris text-sm">
        ✓ You voted for {voted?.name ?? "a candidate"}.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="election_id" value={electionId} />
      <div className="space-y-1.5">
        {candidates.map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <input
              type="radio"
              name="candidate_id"
              value={c.id}
              className="accent-gold"
            />
            <span className="font-serif text-parchment group-hover:text-gold-bright transition">
              {c.name}
            </span>
            <span className="font-display uppercase tracking-imperial text-[0.6rem] text-parchment-deep">
              {c.profession}
            </span>
          </label>
        ))}
      </div>
      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}
      <button type="submit" disabled={isPending} className="btn-imperial">
        {isPending ? "Casting…" : "Cast my vote"}
      </button>
    </form>
  );
}
