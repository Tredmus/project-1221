import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdminUserId } from "@/lib/game/admin";

/**
 * Admin layout — gates access to anyone listed in IMPERIUM_ADMIN_USER_IDS.
 *
 * This is the ONLY place in the codebase outside Edge Functions that
 * should be allowed to import `lib/supabase/admin.ts`. The Server Actions
 * underneath each /admin page must re-check the gate before doing any
 * service-role work.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login?next=/admin");
  if (!isAdminUserId(user.id)) redirect("/game");

  return (
    <div className="page-root mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between border-b border-gold/20 pb-4">
        <div>
          <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
            Imperial Chancery
          </p>
          <h1 className="text-2xl">Admin</h1>
        </div>
        <nav className="flex gap-4 font-display uppercase tracking-imperial text-xs">
          <Link href="/admin" className="text-gold hover:text-gold-bright">
            Overview
          </Link>
          <Link
            href="/admin/seed"
            className="text-gold hover:text-gold-bright"
          >
            Seed world
          </Link>
          <Link href="/game" className="text-parchment-deep hover:text-gold">
            Back to game
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
