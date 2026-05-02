"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Server Actions for the auth flow.
 *
 * Each action receives a FormData payload, calls Supabase, and either
 * returns a structured error (rendered by the page) or redirects.
 *
 * We deliberately do NOT use the service-role client here — Supabase Auth
 * provides its own privileged path for sign-up.
 */

export interface AuthFormState {
  error: string | null;
}

const friendly = (rawError: string | undefined | null): string => {
  if (!rawError) return "Something went wrong. Try again.";

  const lower = rawError.toLowerCase();
  if (lower.includes("invalid login credentials"))
    return "Wrong email or password.";
  if (lower.includes("email not confirmed"))
    return "Please confirm your email first. Check your inbox.";
  if (lower.includes("user already registered"))
    return "An account with that email already exists.";
  if (lower.includes("password should be"))
    return "Password must be at least 8 characters.";
  return rawError;
};

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/game");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: friendly(error.message) };
  }

  redirect(next.startsWith("/") ? next : "/game");
}

export async function registerAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const username = String(formData.get("username") ?? "").trim();

  if (!email || !password || !username) {
    return { error: "Email, password, and a name are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) {
    return {
      error:
        "Names use 3–24 characters: letters, numbers, underscore, or hyphen.",
    };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The handle_new_user() trigger reads username from raw_user_meta_data.
      data: { username },
    },
  });

  if (error) {
    return { error: friendly(error.message) };
  }

  redirect("/auth/check-email");
}

export async function logoutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
