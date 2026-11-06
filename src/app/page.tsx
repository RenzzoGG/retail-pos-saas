import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button-styles";
import { ImportArt, ReceiptArt, ReportsArt, ScanArt, StockArt } from "@/features/landing/components/feature-art";
import { HeroDemo } from "@/features/landing/components/hero-demo";
import { ScrollReveals } from "@/features/landing/components/scroll-reveals";
import { SecurityArt } from "@/features/landing/components/security-section";

/**
 * Marketing landing (Server Component). All text, headings and links are in
 * the HTML (fast first paint, SEO, works without JS). Only the animated
 * islands (HeroDemo, Reveal, *Art, SecuritySection) are Client Components that
 * load GSAP. Stocktill is a fictional brand and every figure shown is sample data.
 */
export const metadata: Metadata = {
  title: "Stocktill — Point of sale and inventory for small shops",
  description:
    "Sell fast with a barcode scanner, keep stock right, import from Excel, print 80 mm receipts and see your profit. A fictional SaaS built as a portfolio project.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Stocktill",
    title: "Stocktill — Point of sale and inventory for small shops",
    description: "Scanner-friendly POS, inventory, Excel import, receipts, returns and reports. A fictional portfolio project.",
  },
  twitter: { card: "summary_large_image", title: "Stocktill — POS and inventory for small shops" },
};

const REPO = "https://github.com/RenzzoGG/retail-pos-saas";

const ROLES = [
  { role: "Owner", can: "Everything, including billing" },
  { role: "Admin", can: "Inventory, costs, reports, returns, team" },
  { role: "Cashier", can: "Sells and sees stock — never costs or profit" },
];

const FEATURES: { id: string; eyebrow: string; title: string; text: string; points: string[]; art: ReactNode }[] = [
  {
    id: "pos",
    eyebrow: "Point of sale",
    title: "Ring up a sale in seconds, with or without a mouse",
    text: "Works with any USB barcode scanner. Fast consecutive scans are all counted, quantities and discounts are a keystroke away, and payments can be split between cash, card and transfer.",
    points: ["Keyboard shortcuts for the whole flow", "Cashier discount limit set by the owner", "Double-click safe: one click, one sale"],
    art: <ScanArt />,
  },
  {
    id: "inventory",
    eyebrow: "Inventory",
    title: "Stock that is always right, and alerts before you run out",
    text: "Stock only changes through sales, returns and stock entries, and every change is recorded. Weighted average cost keeps your margins honest.",
    points: ["SKU and barcode per product", "Low-stock threshold per product", "Full history of who changed what"],
    art: <StockArt />,
  },
  {
    id: "import",
    eyebrow: "Excel import",
    title: "Bring your catalog from a spreadsheet",
    text: "Upload an .xlsx or .csv file, check the preview row by row and confirm. Rows with problems are explained and can be downloaded to fix.",
    points: ["Preview before anything is saved", "Update existing products if you choose", "Protected against formula injection"],
    art: <ImportArt />,
  },
  {
    id: "receipts",
    eyebrow: "Receipts & returns",
    title: "80 mm receipts, and returns tied to the original sale",
    text: "Print or download a thermal-printer ticket after each sale. Owners and admins can return part of a sale: the refund is calculated for them and damaged items can be written off.",
    points: ["Proportional refunds, discounts included", "Return receipts as PDF", "Write-offs count as a loss in profit"],
    art: <ReceiptArt />,
  },
  {
    id: "reports",
    eyebrow: "Dashboard & reports",
    title: "Know how the shop is doing today, this week and this month",
    text: "Sales, gross profit after returns, best sellers and payment methods, computed in the database and exportable to Excel. Cashiers get a dashboard without costs or profit.",
    points: ["Comparisons with the previous period", "Accessible charts with data tables", "Excel export of any date range"],
    art: <ReportsArt />,
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is Stocktill a real product?",
    a: "No. Stocktill is a fictional brand created for a portfolio project. The app works end to end, but it is a demo: don't use it to run a real business.",
  },
  {
    q: "Do I need special hardware?",
    a: "No. A computer or tablet with a modern browser is enough. Any USB barcode scanner that types like a keyboard works, and receipts are 80 mm PDFs for common thermal printers.",
  },
  {
    q: "What happens after the 14-day trial?",
    a: "The plan costs 19 USD per month. In this demo payments run in Stripe test mode, so no real card is ever charged. If a subscription ends, your data stays available in read-only mode.",
  },
  {
    q: "Can my cashiers see costs and profit?",
    a: "No. Cashiers can sell and see stock, but costs, profit and reports are only for owners and admins. This is enforced in the database, not just hidden in the interface.",
  },
  {
    q: "Can I manage more than one store?",
    a: "Yes. Each store has its own team, products and sales, and stores are fully isolated from each other with row-level security.",
  },
  {
    q: "Where is the source code?",
    a: (
      <>
        On{" "}
        <a href={REPO} className="font-medium text-indigo-700 underline dark:text-indigo-300">
          GitHub
        </a>{" "}
        under the MIT license: Next.js, Supabase (PostgreSQL with RLS), Stripe and GSAP.
      </>
    ),
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-col bg-white font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 md:px-8">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Stocktill
          </Link>
          <nav aria-label="Sections" className="hidden gap-5 text-sm text-slate-700 md:flex dark:text-slate-300">
            <a href="#features" className="hover:text-indigo-700 dark:hover:text-indigo-300">Features</a>
            <a href="#security" className="hover:text-indigo-700 dark:hover:text-indigo-300">Security</a>
            <a href="#pricing" className="hover:text-indigo-700 dark:hover:text-indigo-300">Pricing</a>
            <a href="#faq" className="hover:text-indigo-700 dark:hover:text-indigo-300">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className={buttonClasses("ghost", "px-3")}>
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses("primary", "px-3")}>
              Start free trial
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <ScrollReveals />
        {/* ------------------------------------------------------------ hero */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(60%_50%_at_70%_20%,rgba(99,102,241,0.18),transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-24 md:px-8 lg:grid-cols-2 lg:pt-24 lg:pb-32">
            <div>
              <p className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                Point of sale + inventory for small shops
              </p>
              <h1 id="hero-title" className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Scan, sell and know your stock. All in one place.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-slate-700 dark:text-slate-300">
                Stocktill is a fast, scanner-friendly register with real inventory, Excel import, 80 mm receipts, returns and
                reports, for shops with one counter or several stores.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className={buttonClasses("primary", "px-6 py-3 text-base")}>
                  Start your 14-day free trial
                </Link>
                <Link href="/login" className={buttonClasses("secondary", "px-6 py-3 text-base")}>
                  Sign in
                </Link>
              </div>
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">Then 19 USD per month · Stripe test mode in this demo · cancel anytime</p>
            </div>
            <HeroDemo />
          </div>
        </section>

        {/* -------------------------------------------------------- features */}
        <section id="features" aria-labelledby="features-title" className="border-t border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <div data-reveal-group className="mx-auto max-w-2xl text-center">
              <h2 id="features-title" data-split className="text-3xl font-bold tracking-tight sm:text-4xl">
                Everything a small shop needs at the counter and in the back room
              </h2>
              <p data-reveal className="mt-4 text-slate-700 dark:text-slate-300">
                Built around how shops actually work: a scanner, a busy counter and an owner who wants the numbers right.
              </p>
            </div>

            <div className="mt-16 space-y-24">
              {FEATURES.map((f, i) => (
                <article key={f.id} id={f.id} aria-labelledby={`${f.id}-title`} className="grid items-center gap-10 md:grid-cols-2">
                  <div data-reveal-group className={i % 2 === 1 ? "md:order-2" : ""}>
                    <p data-reveal className="text-sm font-semibold tracking-wide text-indigo-700 uppercase dark:text-indigo-300">
                      {f.eyebrow}
                    </p>
                    <h3 id={`${f.id}-title`} data-split className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                      {f.title}
                    </h3>
                    <p data-reveal className="mt-4 text-slate-700 dark:text-slate-300">
                      {f.text}
                    </p>
                    <ul data-reveal className="mt-5 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                      {f.points.map((p) => (
                        <li key={p} className="flex gap-2">
                          <span aria-hidden="true" className="text-indigo-600 dark:text-indigo-400">✓</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="min-w-0">{f.art}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Server HTML; SecurityArt (client) pins and animates this section on desktop. */}
        <section id="security" aria-labelledby="security-title" className="flex min-h-screen items-center bg-slate-950 py-20 text-white">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 md:grid-cols-2 md:px-8">
            <div>
              <p className="text-sm font-semibold tracking-wide text-indigo-300 uppercase">Team & security</p>
              <h2 id="security-title" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                Everyone sees exactly what they should
              </h2>
              <p className="mt-4 text-slate-300">
                Invite your team by email and give each person a role. Permissions are checked on the server and again in the
                database, so even a direct API call can&apos;t cross the line.
              </p>
              <ul className="mt-6 space-y-3">
                {ROLES.map((r) => (
                  <li key={r.role} data-role className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                    <span className="mt-0.5 rounded bg-indigo-500 px-2 py-0.5 text-xs font-bold">{r.role}</span>
                    <span className="text-sm text-slate-200">{r.can}</span>
                  </li>
                ))}
              </ul>
            </div>
            <SecurityArt />
          </div>
        </section>

        {/* --------------------------------------------------------- pricing */}
        <section id="pricing" aria-labelledby="pricing-title" className="py-20">
          <div className="mx-auto max-w-6xl px-4 md:px-8">
            <div data-reveal-group className="mx-auto max-w-xl text-center">
              <h2 id="pricing-title" data-split className="text-3xl font-bold tracking-tight sm:text-4xl">
                One simple plan
              </h2>
              <p data-reveal className="mt-3 text-slate-700 dark:text-slate-300">Every feature, every role, as many products as you need.</p>
              <div data-reveal className="mt-10 rounded-2xl border-2 border-indigo-600 bg-white p-8 text-left shadow-xl dark:bg-slate-900">
                <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Stocktill Monthly</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-5xl font-bold tracking-tight">$19</span>
                  <span className="text-slate-600 dark:text-slate-400">USD / month</span>
                </p>
                <p className="mt-2 inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-800 dark:bg-green-900 dark:text-green-100">
                  14-day free trial
                </p>
                <ul className="mt-6 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                  {["Point of sale with barcode scanning", "Inventory, stock entries and Excel import", "Receipts, returns and customers", "Dashboard, reports and Excel export", "Team with owner, admin and cashier roles"].map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden="true" className="text-indigo-600 dark:text-indigo-400">✓</span>
                      {p}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={buttonClasses("primary", "mt-8 w-full py-3 text-base")}>
                  Start free trial
                </Link>
                <p className="mt-3 text-center text-xs text-slate-600 dark:text-slate-400">
                  Payments use Stripe test mode in this demo: no real charges.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="border-t border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mx-auto max-w-3xl px-4 md:px-8">
            <div data-reveal-group>
              <h2 id="faq-title" data-split className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
                Frequently asked questions
              </h2>
              <div className="mt-10 space-y-3">
                {FAQ.map((item) => (
                  <details key={item.q} data-reveal className="group rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium focus-visible:outline-2 focus-visible:outline-indigo-500">
                      {item.q}
                      <span aria-hidden="true" className="text-xl text-slate-500 transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <div className="mt-3 text-sm text-slate-700 dark:text-slate-300">{item.a}</div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- CTA */}
        <section aria-labelledby="cta-title" className="py-20">
          <div data-reveal-group className="mx-auto max-w-4xl rounded-3xl bg-indigo-700 px-6 py-14 text-center text-white md:px-12">
            <h2 id="cta-title" data-split className="text-3xl font-bold tracking-tight sm:text-4xl">
              Open your register today
            </h2>
            <p data-reveal className="mx-auto mt-4 max-w-xl text-indigo-100">
              Create a store in a minute, add your products and start selling when your free trial begins.
            </p>
            <div data-reveal className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className={buttonClasses("secondary", "border-0 px-6 py-3 text-base")}>
                Create your store
              </Link>
              <Link href="/login" className="inline-flex items-center rounded-md px-6 py-3 text-base font-medium text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-white">
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-10 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 md:flex-row md:items-start md:justify-between md:px-8">
          <div className="max-w-xl">
            <p className="font-semibold text-slate-900 dark:text-white">Stocktill</p>
            <p className="mt-1" data-testid="fictional-notice">
              Stocktill is a fictional brand and a portfolio project. It is not a commercial product and is not affiliated with
              any real company. All names, products and figures shown are sample data.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/signup" className="hover:underline">Sign up</Link>
            <Link href="/login" className="hover:underline">Sign in</Link>
            <a href={REPO} className="hover:underline">Source code (MIT)</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
