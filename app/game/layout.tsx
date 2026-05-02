import Link from "next/link";
import { getCurrentCharacter } from "@/lib/game/getCurrentCharacter";
import { createServerSupabase } from "@/lib/supabase/server";
import APBar from "@/components/ui/APBar";
import CoinDisplay from "@/components/ui/CoinDisplay";

const STATIC_NAV = [
  { href: "/game",                 label: "Hall"     },
  { href: "/game/map",             label: "Map"      },
  { href: "/game/character",       label: "Self"     },
  { href: "/game/clan",            label: "Clan"     },
  { href: "/game/work",            label: "Work"     },
  { href: "/game/market",          label: "Market"   },
  { href: "/game/politics",        label: "Senate"   },
  { href: "/game/military",        label: "Military" },
  { href: "/game/ledger",          label: "Ledger"   },
  { href: "/game/notifications",   label: "Alerts"   },
];

export default async function GameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const character = await getCurrentCharacter();

  const supabase = await createServerSupabase();

  // Parallel: city lookup (for nav) + unread notification count (for badge).
  const [cityResult, unreadResult] = await Promise.all([
    character.node_id
      ? supabase.from("cities").select("id, name").eq("node_id", character.node_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("character_id", character.id)
      .is("read_at", null),
  ]);

  const city       = cityResult.data;
  const unreadCount = unreadResult.count ?? 0;

  return (
    <div className="page-root mx-auto max-w-7xl px-4 py-4 lg:px-6 lg:py-6">
      <header className="border-b border-gold/20 pb-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <Link
              href="/game"
              className="font-display uppercase tracking-imperial text-sm text-gold hover:text-gold-bright"
            >
              Imperium
            </Link>
            <span className="text-parchment-deep/60">·</span>
            <span className="font-serif text-parchment">
              {character.name}
            </span>
            <span className="text-parchment-deep/60 text-xs uppercase tracking-imperial font-display">
              {character.profession}
            </span>
            {city && (
              <>
                <span className="text-parchment-deep/60 hidden sm:inline">·</span>
                <Link
                  href={`/game/city/${city.id}`}
                  className="hidden sm:inline font-serif text-sm text-parchment-dark hover:text-gold-bright transition"
                >
                  {city.name}
                </Link>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <APBar
              current={character.action_points}
              max={character.max_action_points}
              compact
            />
            <CoinDisplay
              coins={character.coins}
              gems={character.gems}
              compact
            />
            <form action="/auth/logout" method="post">
              <button type="submit" className="btn-ghost">
                Log out
              </button>
            </form>
          </div>
        </div>

        <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-display uppercase tracking-imperial">
          {STATIC_NAV.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="relative text-parchment-deep hover:text-gold"
            >
              {link.label}
              {link.href === "/game/notifications" && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[1rem] h-4 flex items-center justify-center rounded-full bg-blood text-[0.5rem] text-parchment px-0.5 font-display">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          ))}
          {city && (
            <Link
              href={`/game/city/${city.id}`}
              className="text-gold/70 hover:text-gold"
            >
              {city.name}
            </Link>
          )}
        </nav>
      </header>

      {children}
    </div>
  );
}
