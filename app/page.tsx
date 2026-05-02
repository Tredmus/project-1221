import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Landing page.
 *
 * If the visitor is authenticated, send them straight into the game.
 * Otherwise show the marketing-style splash.
 */
export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/game");
  }

  return (
    <main className="page-root mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-display uppercase tracking-imperial text-xs text-gold-dim">
        Anno Domini · MMXXVI
      </p>
      <h1 className="mt-4 font-display text-5xl md:text-7xl text-gold-bright drop-shadow-[0_0_25px_rgba(201,164,76,0.15)]">
        IMPERIVM
      </h1>
      <div className="divider-laurel max-w-md" />
      <p className="font-serif text-xl md:text-2xl text-parchment leading-relaxed max-w-2xl">
        A browser-based realm of empire, craft, and intrigue. Take the role of a
        peasant, a smith, a soldier, or a senator in a living medieval world —
        and rise as far as your ambition will carry you.
      </p>
      <p className="mt-4 font-serif italic text-parchment-deep">
        The dice are cast at every midnight.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <Link href="/auth/register" className="btn-imperial">
          Enter the world
        </Link>
        <Link href="/auth/login" className="btn-ghost">
          I have a character
        </Link>
      </div>

      <footer className="mt-24 text-xs text-parchment-deep/70 font-display uppercase tracking-imperial">
        Alea Iacta Est
      </footer>
    </main>
  );
}
