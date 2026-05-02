"use client";

import { useActionState } from "react";
import { registerAction, type AuthFormState } from "../actions";

const initialState: AuthFormState = { error: null };

export default function RegisterForm() {
  const [state, formAction, isPending] = useActionState(
    registerAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label-imperial" htmlFor="username">
          Account name
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-zA-Z0-9_-]{3,24}"
          className="input-imperial"
          placeholder="caesar"
        />
        <p className="mt-1 text-xs text-parchment-deep/70">
          3–24 characters. Letters, numbers, underscore, hyphen.
        </p>
      </div>

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
          autoComplete="new-password"
          required
          minLength={8}
          className="input-imperial"
        />
        <p className="mt-1 text-xs text-parchment-deep/70">
          At least 8 characters.
        </p>
      </div>

      {state.error ? (
        <p className="text-sm text-blood font-serif italic">{state.error}</p>
      ) : null}

      <button type="submit" disabled={isPending} className="btn-imperial w-full">
        {isPending ? "Sealing the oath…" : "Swear in"}
      </button>
    </form>
  );
}
