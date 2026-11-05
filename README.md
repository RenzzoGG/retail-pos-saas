# Stocktill

> **Stocktill is a fictional brand** created for a portfolio project. It is not a commercial product.

Multi-tenant point of sale (POS) and inventory SaaS for small shops, built with Next.js, Supabase,
Drizzle, Stripe (test mode) and Docker. Work in progress: see [`docs/PHASES.md`](docs/PHASES.md)
and the technical design in [`docs/DESIGN.md`](docs/DESIGN.md).

## Requirements

- Node.js 24 and npm
- Docker Engine with Docker Compose v2 (the Supabase CLI runs its services in Docker)

## Run locally

```bash
npm ci                       # install dependencies (includes the Supabase CLI)
npm run supabase:start       # start local Supabase (first run downloads images)
cp .env.example .env.local   # then fill in values from `npm run supabase:status`
```

Then start the app with **one** of:

```bash
npm run dev                  # on the host  -> http://localhost:3000
npm run docker:dev           # in Docker    -> http://localhost:3000
```

Health check: `curl http://localhost:3000/api/health` → `{"status":"ok"}`

Stop everything with `npm run docker:down` and `npm run supabase:stop`.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js dev server, production build, production server |
| `lint` / `typecheck` / `test` | ESLint, TypeScript (`tsc --noEmit`), Vitest |
| `supabase:start` / `supabase:stop` / `supabase:status` | Local Supabase stack |
| `db:generate` / `db:check` | Generate / validate Drizzle migrations into `supabase/migrations` |
| `db:migrate` / `db:reset` | Apply pending migrations / rebuild the local database |
| `docker:dev` / `docker:down` | App in Docker Compose (dev mode) |

## License

[MIT](LICENSE)
