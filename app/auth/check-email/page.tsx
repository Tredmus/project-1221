import Link from "next/link";

export const metadata = {
  title: "Confirm your email · Imperium",
};

export default function CheckEmailPage() {
  return (
    <>
      <h2 className="panel-heading">Awaiting your seal</h2>
      <div className="panel-body space-y-4 text-center">
        <p className="font-serif text-lg text-parchment">
          A confirmation message has been dispatched to your inbox.
        </p>
        <p className="text-sm text-parchment-deep">
          Open it and click the link to complete your enrollment. Then return
          here to begin.
        </p>
        <div className="divider-laurel" />
        <Link href="/auth/login" className="btn-ghost">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
