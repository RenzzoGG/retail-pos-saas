import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;
