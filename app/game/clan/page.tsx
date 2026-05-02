import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import { format } from "date-fns";
import CreateClanForm from "@/components/clan/CreateClanForm";
import ClanInvitations from "@/components/clan/ClanInvitations";
import ClanChat from "@/components/clan/ClanChat";
import {
  InviteForm,
  DepositForm,
  LeaveClanForm,
} from "@/components/clan/ClanActions";

export const metadata = {
  title: "Clan · Imperium",
};

export const revalidate = 30;

export default async function ClanPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  // ── No-clan state: pending invitations + create form ──────────

  if (!character.clan_id) {
    const { data: rawInvites } = await supabase
      .from("clan_invitations")
      .select(`
        id, created_at,
        clan:clans ( name, tag ),
        invited_by_char:characters!clan_invitations_invited_by_fkey ( name )
      `)
      .eq("character_id", character.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const invitations = (rawInvites ?? []).map((r) => {
      const clan = Array.isArray(r.clan) ? r.clan[0] : r.clan;
      const inviter = Array.isArray(r.invited_by_char)
        ? r.invited_by_char[0]
        : r.invited_by_char;
      return {
        id:              r.id,
        clan_name:       clan?.name ?? "Unknown",
        clan_tag:        clan?.tag  ?? "???",
        invited_by_name: inviter?.name ?? "Someone",
        created_at:      r.created_at,
      };
    });

    return (
      <div className="space-y-8">
        <header>
          <h1>Clans</h1>
          <p className="font-serif text-parchment-dark">
            A clan pools resources, coordinates strategy, and fights as one.
            You are currently a lone wanderer.
          </p>
        </header>

        <ClanInvitations invitations={invitations} />

        <section className="panel">
          <h2 className="panel-heading">Found a new clan</h2>
          <div className="panel-body">
            <CreateClanForm />
          </div>
        </section>
      </div>
    );
  }

  // ── In-clan state ─────────────────────────────────────────────

  const { data: clan } = await supabase
    .from("clans")
    .select("id, name, tag, treasury_gold, created_at, leader_id")
    .eq("id", character.clan_id)
    .maybeSingle();

  if (!clan) {
    return (
      <p className="font-serif italic text-parchment-deep">
        Your clan could not be found.
      </p>
    );
  }

  // Members
  const { data: members } = await supabase
    .from("characters")
    .select("id, name, profession, clan_role, node_id, created_at")
    .eq("clan_id", character.clan_id)
    .order("clan_role") // leader first via alpha sort (leader < member < officer)
    .order("created_at");

  // Recent messages (last 40, displayed oldest → newest)
  const { data: rawMessages } = await supabase
    .from("clan_messages")
    .select(`
      id, content, created_at,
      author:characters!clan_messages_author_id_fkey ( id, name )
    `)
    .eq("clan_id", character.clan_id)
    .order("created_at", { ascending: false })
    .limit(40);

  const messages = (rawMessages ?? [])
    .map((m) => {
      const author = Array.isArray(m.author) ? m.author[0] : m.author;
      return {
        id:          m.id,
        content:     m.content,
        created_at:  m.created_at,
        author_name: author?.name ?? "Unknown",
        author_id:   (author as { id?: string })?.id ?? "",
      };
    })
    .reverse();

  // Outgoing invitations (pending)
  const { data: outgoing } = await supabase
    .from("clan_invitations")
    .select(`
      id, created_at,
      target:characters!clan_invitations_character_id_fkey ( name )
    `)
    .eq("clan_id", character.clan_id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);

  const isLeader  = character.clan_role === "leader";
  const isOfficer = character.clan_role === "officer";
  const canInvite = isLeader || isOfficer;

  const ROLE_LABEL: Record<string, string> = {
    leader: "Leader",
    officer: "Officer",
    member: "Member",
  };

  return (
    <div className="space-y-8">
      {/* Clan header */}
      <header className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <div className="font-display uppercase tracking-imperial text-xs text-gold-dim mb-1">
            [{clan.tag}]
          </div>
          <h1 className="!text-4xl">{clan.name}</h1>
          <p className="font-serif text-sm text-parchment-dark mt-1">
            {members?.length ?? 0} member{(members?.length ?? 0) !== 1 ? "s" : ""}
            {" · "}
            Founded {format(new Date(clan.created_at), "d MMM yyyy")}
          </p>
        </div>
        <div className="panel px-4 py-3 text-right">
          <div className="label-imperial mb-0.5">Treasury</div>
          <div className="font-display text-2xl text-gold-bright tabular-nums">
            {Math.floor(Number(clan.treasury_gold))}
            <span className="text-gold-dim text-base ml-1">coins</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Members + invite */}
        <div className="space-y-6">
          <section className="panel">
            <h2 className="panel-heading">Members</h2>
            <div className="panel-body">
              <ul className="divide-y divide-gold/10">
                {(members ?? []).map((m) => (
                  <li key={m.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div
                        className={`font-serif ${
                          m.id === character.id ? "text-gold-bright" : "text-parchment"
                        }`}
                      >
                        {m.name}{m.id === character.id ? " (you)" : ""}
                      </div>
                      <div className="font-display uppercase tracking-imperial text-[0.6rem] text-parchment-deep">
                        {m.profession}
                      </div>
                    </div>
                    <span className="font-display uppercase tracking-imperial text-[0.6rem] text-gold-dim border border-gold/20 px-1.5 py-0.5 rounded-sm">
                      {ROLE_LABEL[m.clan_role ?? "member"] ?? "Member"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {canInvite && (
            <section className="panel">
              <h2 className="panel-heading">Invite a character</h2>
              <div className="panel-body">
                <InviteForm />
                {outgoing && outgoing.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gold/10">
                    <p className="label-imperial mb-2">Pending outgoing</p>
                    <ul className="space-y-1">
                      {outgoing.map((o) => {
                        const target = Array.isArray(o.target)
                          ? o.target[0]
                          : o.target;
                        return (
                          <li
                            key={o.id}
                            className="font-serif text-sm text-parchment-dark"
                          >
                            {target?.name ?? "Unknown"} —{" "}
                            <span className="text-parchment-deep">awaiting reply</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Treasury deposit */}
          <section className="panel">
            <h2 className="panel-heading">Contribute to treasury</h2>
            <div className="panel-body">
              <DepositForm maxCoins={character.coins} />
            </div>
          </section>

          {/* Leave clan */}
          <section className="panel border-blood/20">
            <h2 className="panel-heading text-blood/80">Danger zone</h2>
            <div className="panel-body">
              <LeaveClanForm isLeader={isLeader} />
            </div>
          </section>
        </div>

        {/* Right: Chat */}
        <section className="panel lg:col-span-2">
          <h2 className="panel-heading">Clan chat</h2>
          <div className="panel-body">
            <ClanChat
              messages={messages}
              currentCharacterId={character.id}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
