import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { buildSecurityHeaders } from "./src/lib/security-headers";

export default function config(phase: string): NextConfig {
  const securityHeaders = buildSecurityHeaders({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    isDev: phase === PHASE_DEVELOPMENT_SERVER,
  });

  return {
    // No "X-Powered-By: Next.js" (no need to advertise the stack).
    poweredByHeader: false,
    // Security headers on every response (phase 11, see src/lib/security-headers.ts).
    // Computed at build time: NEXT_PUBLIC_* values are build arguments.
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
    // Self-contained server bundle for the production Docker image (phase 11).
    output: "standalone",
    // pdfkit (receipts) reads its built-in font files (.afm) from disk with
    // dynamic paths: keep it as a plain Node package and copy its data files
    // into the standalone output used by the Docker image.
    serverExternalPackages: ["pdfkit"],
    outputFileTracingIncludes: {
      "/app/sales/*": ["./node_modules/pdfkit/js/data/**/*"],
    },
    experimental: {
      // Product import uploads a file (max 1 MB, checked again on the server).
      serverActions: { bodySizeLimit: "2mb" },
    },
    cacheComponents: true,
    partialPrefetching: true,
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };
}
