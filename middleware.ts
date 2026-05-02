import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every request except:
     *   - _next/static, _next/image  (Next.js assets)
     *   - favicon and other static files
     *   - api routes (we don't have any yet, but reserve them)
     *
     * The matcher is intentionally broad: every page request refreshes the
     * Supabase session cookie, so dashboards always show fresh data.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
