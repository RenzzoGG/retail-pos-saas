# syntax=docker/dockerfile:1
# Production image (Railway). Multi-stage: the final image carries only the
# Next.js standalone server (server.js + the traced node_modules it needs),
# the static assets and public/, so no build tools, sources or dev deps ship.
# Local development uses docker/dev.Dockerfile through compose.yaml instead.

ARG NODE_IMAGE=node:24-slim

# ── 1. deps: install exactly what package-lock.json says ─────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# vendor/ holds dependencies installed from local tarballs (see vendor/README.md).
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

# ── 2. build: next build with output "standalone" ────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined into the browser bundle (and the CSP) at
# build time, so they must be build arguments. Railway passes a service
# variable as a build argument when the Dockerfile declares an ARG with its
# name. None of them is a secret (the publishable key is meant for browsers).
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_DEMO_ENABLED
ARG NEXT_PUBLIC_DEMO_PASSWORD
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \
    NEXT_PUBLIC_DEMO_ENABLED=${NEXT_PUBLIC_DEMO_ENABLED} \
    NEXT_PUBLIC_DEMO_PASSWORD=${NEXT_PUBLIC_DEMO_PASSWORD}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ may be absent in a fresh clone (git does not track empty folders and
# public/.gitkeep is excluded by .dockerignore); the runner stage copies it.
RUN mkdir -p public && npm run build

# ── 3. runner: minimal runtime, unprivileged user ───────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
# HOSTNAME: Docker sets it to the container id; server.js binds to HOSTNAME,
# so force all interfaces. PORT: Railway injects its own; 3000 is the default.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# The official image ships the unprivileged "node" user (uid 1000).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# Used by `docker run` / Compose. Railway ignores it and uses the healthcheck
# path set in the service settings (also /api/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# exec form: node is PID 1 and receives SIGTERM directly (graceful shutdown).
CMD ["node", "server.js"]
