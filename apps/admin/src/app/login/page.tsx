import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Project 1221 Admin</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Sign in with an admin account.</p>
        <LoginForm />
      </div>
    </main>
  );
}
