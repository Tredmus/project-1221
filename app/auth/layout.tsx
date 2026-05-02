import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="page-root mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link
        href="/"
        className="font-display uppercase tracking-imperial text-xs text-gold-dim hover:text-gold mb-8 text-center"
      >
        Imperium
      </Link>
      <div className="panel">{children}</div>
      <p className="mt-6 text-center text-xs text-parchment-deep/70 font-display uppercase tracking-imperial">
        Alea Iacta Est
      </p>
    </main>
  );
}
