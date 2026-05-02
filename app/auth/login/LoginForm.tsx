"use client";

import { useActionState } from "react";
import { loginAction, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label className="label-imperial" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input-imperial"
          placeholder="caesar@rome.imp"
        />
      </div>

      <div>
        <label className="label-imperial" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input-imperial"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-blood font-serif italic">{state.error}</p>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-imperial w-full">
        {isPending ? "Authenticating…" : "Enter"}
      </button>
    </form>
  );
}
