import { getAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const { user, isAdmin } = await getAdmin();

  if (!isAdmin) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg">
          {user.email} is signed in but isn&apos;t an admin.
        </p>
        <p className="max-w-md text-sm text-muted">Admin rights are granted in the database (see the README).</p>
        <form action="/auth/signout" method="post">
          <button className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium">Sign out</button>
        </form>
      </main>
    );
  }

  return children;
}
