import Link from "next/link";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign in · Imperium",
};

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { next } = await searchParams;

  return (
    <>
      <h2 className="panel-heading">Return to the realm</h2>
      <div className="panel-body space-y-5">
        <p className="font-serif text-parchment-dark">
          Sign in to resume your character.
        </p>

        <LoginForm next={next ?? "/game"} />

        <p className="text-sm text-parchment-deep">
          New to the empire?{" "}
          <Link href="/auth/register" className="text-gold hover:text-gold-bright">
            Create a character
          </Link>
          .
        </p>
      </div>
    </>
  );
}
