import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url));
}

export async function GET(request: NextRequest) {
  // Allow GET for convenience (e.g. a plain <a href="/auth/logout">).
  // CSRF surface is small here since signOut just clears the cookie.
  return POST(request);
}
