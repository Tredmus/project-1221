import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Cookie-refreshing helper used by the root middleware.
 *
 * Refreshes the Supabase auth session on every request and rewrites cookies
 * back onto the response so that Server Components see fresh tokens.
 *
 * Also implements the global route guard:
 *   - /game/*  and /admin/*  require an authenticated user.
 *   - /onboarding requires an authenticated user without a character row.
 *   - Authenticated users with a character are bounced out of /onboarding.
 *
 * Keep this file thin. All actual policy lives in the routes themselves;
 * this is just a convenience redirect to avoid flashing pages users can't
 * see.
 */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isGameRoute = pathname.startsWith("/game");
  const isAdminRoute = pathname.startsWith("/admin");
  const isOnboardingRoute = pathname.startsWith("/onboarding");
  const isAuthRoute = pathname.startsWith("/auth");

  if (!user && (isGameRoute || isAdminRoute || isOnboardingRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute && !pathname.startsWith("/auth/callback") && !pathname.startsWith("/auth/logout")) {
    const url = request.nextUrl.clone();
    url.pathname = "/game";
    return NextResponse.redirect(url);
  }

  // Onboarding gate: if the user is logged in but has no character, push them
  // to /onboarding for any /game/* page. We do a lightweight existence query
  // here — it's a single indexed lookup on (user_id) and runs on every game
  // request, so keep it tight.
  if (user && (isGameRoute || (isOnboardingRoute && false))) {
    const { count } = await supabase
      .from("characters")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if ((count ?? 0) === 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  if (user && isOnboardingRoute) {
    const { count } = await supabase
      .from("characters")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if ((count ?? 0) > 0) {
      const url = request.nextUrl.clone();
      url.pathname = "/game";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
