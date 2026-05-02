"use client";

import { useActionState, useState } from "react";
import {
  inviteCharacterAction,
  depositTreasuryAction,
  leaveClanAction,
  type ClanState,
} from "@/app/actions/clan";

const INIT: ClanState = { ok: false, error: null };

// ──────────────────────────────────────────────────────────────────
// InviteForm — leader/officer only
// ──────────────────────────────────────────────────────────────────
export function InviteForm() {
  const [state, formAction, isPending] = useActionState(inviteCharacterAction, INIT);
  return (
    <form action={formAction} className="flex gap-2">
      <input
        name="character_name"
        type="text"
        placeholder="Character name…"
        className="input-imperial flex-1"
        required
      />
      <button type="submit" disabled={isPending} className="btn-ghost">
        {isPending ? "…" : "Invite"}
      </button>
      {state.ok && (
        <span className="self-center font-serif italic text-verdigris text-sm">
          ✓ Invitation sent.
        </span>
      )}
      {state.error && (
        <span className="self-center font-serif italic text-blood text-sm">
          {state.error}
        </span>
      )}
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────
// DepositForm
// ──────────────────────────────────────────────────────────────────
interface DepositFormProps {
  maxCoins: number;
}

export function DepositForm({ maxCoins }: DepositFormProps) {
  const [state, formAction, isPending] = useActionState(depositTreasuryAction, INIT);
  const [amount, setAmount] = useState(10);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <label className="label-imperial" htmlFor="deposit-amount">
          Deposit (coins)
        </label>
        <input
          id="deposit-amount"
          name="amount"
          type="number"
          min={1}
          max={maxCoins}
          value={amount}
          onChange={(e) =>
            setAmount(Math.max(1, Math.min(maxCoins, Number(e.target.value))))
          }
          className="input-imperial"
        />
        <p className="text-xs text-parchment-deep/70 mt-0.5">
          You have {maxCoins} coins
        </p>
      </div>
      <button
        type="submit"
        disabled={isPending || maxCoins < 1}
        className="btn-imperial self-end"
      >
        {isPending ? "Depositing…" : `Deposit ${amount}c`}
      </button>
      {state.ok && (
        <p className="w-full font-serif italic text-verdigris text-sm">
          ✓ Deposited to the clan treasury.
        </p>
      )}
      {state.error && (
        <p className="w-full font-serif italic text-blood text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────
// LeaveClanForm — requires typing LEAVE to confirm
// ──────────────────────────────────────────────────────────────────
export function LeaveClanForm({ isLeader }: { isLeader: boolean }) {
  const [state, formAction, isPending] = useActionState(leaveClanAction, INIT);
  const [confirmText, setConfirmText] = useState("");
  const [showForm, setShowForm] = useState(false);

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="font-display uppercase tracking-imperial text-[0.65rem] text-blood hover:text-blood/80 border border-blood/30 hover:border-blood/60 px-3 py-1.5 rounded-sm transition"
      >
        Leave clan
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {isLeader && (
        <p className="font-serif italic text-parchment-dark text-sm">
          You are the leader. Leaving will promote the longest-standing
          member. If you are the last member, the clan will be disbanded.
        </p>
      )}
      <div>
        <label className="label-imperial" htmlFor="leave-confirm">
          Type LEAVE to confirm
        </label>
        <input
          id="leave-confirm"
          name="confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="LEAVE"
          className="input-imperial"
        />
      </div>
      {state.error && (
        <p className="font-serif italic text-blood text-sm">{state.error}</p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || confirmText !== "LEAVE"}
          className="font-display uppercase tracking-imperial text-[0.65rem] text-blood hover:text-blood/80 border border-blood/30 hover:border-blood/60 px-3 py-1.5 rounded-sm transition disabled:opacity-40"
        >
          {isPending ? "Leaving…" : "Confirm leave"}
        </button>
        <button
          type="button"
          onClick={() => { setShowForm(false); setConfirmText(""); }}
          className="btn-ghost text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
