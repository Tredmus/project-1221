import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatDistanceToNow } from "date-fns";
import MarkAllReadButton from "@/components/ui/MarkAllReadButton";

export const metadata = {
  title: "Notifications · Imperium",
};

type NotifType =
  | "work_processed"
  | "clan_invite"
  | "member_joined"
  | "promoted_leader"
  | string;

interface Notification {
  id: string;
  type: NotifType;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

function notifLabel(n: Notification): string {
  const p = n.payload;
  switch (n.type) {
    case "work_processed": {
      const parts: string[] = [];
      if (p.qty_earned && p.item_earned)
        parts.push(`${p.qty_earned} ${p.item_earned}`);
      if (p.coins_earned)
        parts.push(`${p.coins_earned} coins`);
      return parts.length
        ? `Tonight's work earned you: ${parts.join(" and ")}.`
        : "Your nightly work was processed.";
    }
    case "clan_invite":
      return `You have been invited to join [${p.clan_tag}] ${p.clan_name}.`;
    case "member_joined":
      return `${p.character_name} joined your clan ${p.clan_name}.`;
    case "promoted_leader":
      return `You are now the leader of ${p.clan_name}.`;
    default:
      return `Event: ${n.type}`;
  }
}

function notifIcon(type: NotifType): string {
  switch (type) {
    case "work_processed": return "⚒";
    case "clan_invite":    return "✉";
    case "member_joined":  return "⚑";
    case "promoted_leader": return "♛";
    default: return "•";
  }
}

export default async function NotificationsPage() {
  const character = await getCurrentCharacter();
  const supabase  = await createServerSupabase();

  const { data: rawNotifs } = await supabase
    .from("notifications")
    .select("id, type, payload, read_at, created_at")
    .eq("character_id", character.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const notifications: Notification[] = (rawNotifs ?? []).map((n) => ({
    id:         n.id,
    type:       n.type as NotifType,
    payload:    (n.payload ?? {}) as Record<string, unknown>,
    read_at:    n.read_at,
    created_at: n.created_at,
  }));

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1>Notifications</h1>
          {unreadCount > 0 && (
            <p className="font-serif text-parchment-dark text-sm">
              {unreadCount} unread
            </p>
          )}
        </div>
        {unreadCount > 0 && <MarkAllReadButton />}
      </header>

      <section className="panel">
        <div className="divide-y divide-gold/10">
          {notifications.length === 0 ? (
            <div className="panel-body">
              <p className="font-serif italic text-parchment-deep">
                All quiet. Work, travel, and trade to fill your feed.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  className={`flex gap-4 px-4 py-3.5 transition ${
                    isUnread
                      ? "bg-imperial-shadow/30"
                      : "opacity-60"
                  }`}
                >
                  <div className="w-8 h-8 shrink-0 flex items-center justify-center font-display text-base text-gold-bright border border-gold/20 rounded-sm bg-ash/60">
                    {notifIcon(n.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-sm text-parchment leading-relaxed">
                      {notifLabel(n)}
                    </p>
                    <p className="font-display uppercase tracking-imperial text-[0.6rem] text-parchment-deep mt-0.5">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                      })}
                      {isUnread && (
                        <span className="ml-2 text-gold-bright">· unread</span>
                      )}
                    </p>
                    {/* Clan invite action links handled by the clan page */}
                    {n.type === "clan_invite" && isUnread && (
                      <a
                        href="/game/clan"
                        className="font-display uppercase tracking-imperial text-[0.65rem] text-gold hover:text-gold-bright mt-1 inline-block"
                      >
                        View in Clan page →
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
