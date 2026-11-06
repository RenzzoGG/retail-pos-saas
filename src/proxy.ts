import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 "Proxy" (formerly Middleware): runs before routes render.
 * Used to keep the Supabase session fresh and for optimistic redirects.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets, images, the health check and the Stripe
  // webhook (server-to-server: no session, it must get the raw body untouched).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/stripe|robots.txt|sitemap.xml|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
