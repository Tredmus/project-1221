import Link from "next/link";
import RegisterForm from "./RegisterForm";

export const metadata = {
  title: "Create a character · Imperium",
};

export default function RegisterPage() {
  return (
    <>
      <h2 className="panel-heading">Take an oath</h2>
      <div className="panel-body space-y-5">
        <p className="font-serif text-parchment-dark">
          Forge a new identity in the empire. After confirming your email,
          you&rsquo;ll choose a profession and a starting city.
        </p>

        <RegisterForm />

        <p className="text-sm text-parchment-deep">
          Already sworn in?{" "}
          <Link href="/auth/login" className="text-gold hover:text-gold-bright">
            Sign in
          </Link>
          .
        </p>
      </div>
    </>
  );
}
