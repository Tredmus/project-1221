"use client";

import { useActionState } from "react";
import {
  acceptInviteAction,
  declineInviteAction,
  type ClanState,
} from "@/app/actions/clan";

const INIT: ClanState = { ok: false, error: null };

interface Invitation {
  id: string;
  clan_name: string;
  clan_tag: string;
  invited_by_name: string;
  created_at: string;
}

function InviteRow({ invite }: { invite: Invitation }) {
  const [acceptState, acceptAction, acceptPending] = useActionState(
    acceptInviteAction,
    INIT,
  );
  const [declineState, declineAction, declinePending] = useActionState(
    declineInviteAction,
    INIT,
  );

  if (acceptState.ok) {
    return (
      <li className="py-3 font-serif italic text-verdigris text-sm">
        ✓ Welcome to [{invite.clan_tag}] {invite.clan_name}.
      </li>
    );
  }
  if (declineState.ok) {
    return (
      <li className="py-3 font-serif italic text-parchment-deep text-sm">
        Invitation declined.
      </li>
    );
  }

  return (
    <li className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="font-display text-gold-bright">
          [{invite.clan_tag}] {invite.clan_name}
        </div>
        <div className="font-serif text-xs text-parchment-dark">
          Invited by {invite.invited_by_name}
        </div>
        {(acceptState.error || declineState.error) && (
          <p className="font-serif italic text-blood text-xs mt-0.5">
            {acceptState.error ?? declineState.error}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <form action={acceptAction}>
          <input type="hidden" name="invite_id" value={invite.id} />
          <button
            type="submit"
            disabled={acceptPending || declinePending}
            className="btn-imperial text-xs"
          >
            {acceptPending ? "Joining…" : "Accept"}
          </button>
        </form>
        <form action={declineAction}>
          <input type="hidden" name="invite_id" value={invite.id} />
          <button
            type="submit"
            disabled={acceptPending || declinePending}
            className="btn-ghost text-xs"
          >
            {declinePending ? "…" : "Decline"}
          </button>
        </form>
      </div>
    </li>
  );
}

interface ClanInvitationsProps {
  invitations: Invitation[];
}

export default function ClanInvitations({ invitations }: ClanInvitationsProps) {
  if (invitations.length === 0) return null;

  return (
    <section className="panel border-gold/30">
      <h2 className="panel-heading">Pending invitations</h2>
      <div className="panel-body">
        <ul className="divide-y divide-gold/10">
          {invitations.map((inv) => (
            <InviteRow key={inv.id} invite={inv} />
          ))}
        </ul>
      </div>
    </section>
  );
}
