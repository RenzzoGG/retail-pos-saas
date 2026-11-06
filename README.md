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

No `.env.local` yet? `npm run dev:local` starts the app with the local Supabase URL and publishable
key read at runtime from `supabase status` (nothing is printed or saved).

Emails (sign-up confirmation, password reset, team invitations) are caught by **Mailpit**:
http://localhost:54324

Supabase Studio (browse tables, policies and data): http://localhost:54323

### Demo data (local only)

`supabase/seed.sql` runs on `npm run db:reset` and creates two fictional stores and these users.
**The password is for local development only** — the seed never runs against production.

| Email | Role | Store |
| --- | --- | --- |
| `owner@demo.stocktill.test` | owner | Stocktill Demo Electronics (USD, prices include 8.25 % tax) |
| `admin@demo.stocktill.test` | admin | Stocktill Demo Electronics |
| `cashier@demo.stocktill.test` | cashier | Stocktill Demo Electronics |
| `owner@other.stocktill.test` | owner | Other Shop (EUR, 21 % tax added) |

Password for all of them: `stocktill-demo`. The demo store uses the `America/New_York` time zone. The demo store has 20 electronics accessories,
3 customers and 60 days of sales history (discounts, split payments, returns and a few write-offs), so
the dashboard and reports have data right away.

Stop everything with `npm run docker:down` and `npm run supabase:stop`.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js dev server, production build, production server (`start` serves the standalone build, as the Docker image will) |
| `lint` / `typecheck` / `test` | ESLint, TypeScript (`tsc --noEmit`), Vitest |
| `supabase:start` / `supabase:stop` / `supabase:status` | Local Supabase stack |
| `db:generate` / `db:check` | Generate / validate Drizzle migrations into `supabase/migrations` |
| `db:migrate` / `db:reset` | Apply pending migrations / rebuild the local database and re-run the seed |
| `test:integration` | Integration tests against local Supabase, signed in as the demo users |
| `test:e2e` | Playwright E2E (Chromium) on the production build: onboarding, inventory, import, POS, receipts, returns and customers |
| `dev:local` | `next dev` with the local Supabase public URL/key injected at runtime |
| `test:db` | pgTAP database tests: RLS, tenant isolation, roles, stock, audit log |
| `db:lint` | Lint SQL functions (`supabase db lint`) |
| `db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local database |
| `docker:dev` / `docker:down` | App in Docker Compose (dev mode) |

### Point of sale

**POS** (`/app/pos`) works with the keyboard and USB barcode scanners: `F2` scan, `F4` customer, `F8` charge,
`F9` complete payment, `Esc` back to cart, `Alt+Shift+Backspace` clear the sale, `Enter` new sale.
Try the demo barcodes `2000000000015` (USB-C cable) or `2000000000053` (20 W charger). Cashiers can
discount up to the store limit (10 % by default, editable in Settings).

After a sale, **Print receipt** / **Download PDF** give an 80 mm thermal ticket (also from the sale
detail, to reprint). Owners and admins register **returns** from the sale detail: units per line,
“Return to stock” (uncheck it for damaged items), reason and refund method; each return has its own
PDF receipt. **Customers** (`/app/customers`) can be created from the POS with “+ New customer”.
The receipt note (footer) is set per store in **Settings**.

### Dashboard and reports

- **Dashboard** (`/app`): owners and admins see sales today / this week / this month compared with the
  same point of the previous period, gross profit, average ticket, refunds, write-offs, a 30-day chart,
  best sellers and payment methods. Cashiers see today's store sales and their own, without profit.
- **Reports** (`/app/reports`, owner/admin): quick ranges or a custom range in the store's time zone;
  sales by day or month, gross profit (net of returns, write-offs as a loss), best sellers by units or
  revenue, and sales by category, payment method and cashier. **Export to Excel** downloads the range as
  `.xlsx` (Summary, Sales and Items sheets).

### Sample import files

`docs/samples/` has files to try **Products → Import** (owner/admin):

- `products-import-sample.xlsx` / `.csv`: 10 new products, 2 rows that update demo products (turn on
  “Update existing products”) and 8 rows with errors, to see the preview and the error report.
- `products-600.csv`: 600 valid products with opening stock.

Regenerate them with `node scripts/generate-import-samples.mjs`.

### First-time Playwright setup

```bash
npx playwright install chromium
sudo npx playwright install-deps chromium   # system libraries (Linux/WSL), once
```

## License

[MIT](LICENSE)
