/**
 * The landing hero's "live" register: a scripted sale with SAMPLE data (not
 * real products, prices or sales). Pure and unit-tested; the GSAP timeline in
 * hero-demo.tsx only decides WHEN each step happens and animates the DOM.
 * Money in cents; prices include tax, like the demo store of the app.
 */

export type DemoProduct = { sku: string; name: string; barcode: string; priceCents: number };

export const DEMO_TAX_RATE = 0.0825;

export const DEMO_CATALOG: readonly DemoProduct[] = [
  { sku: "CBL-USBC-1M", name: "USB-C Cable 1 m", barcode: "2000000000015", priceCents: 999 },
  { sku: "CHG-20W-C", name: "20 W USB-C Charger", barcode: "2000000000053", priceCents: 1999 },
  { sku: "CAS-IP15-CLR", name: "Clear Phone Case", barcode: "2000000000152", priceCents: 1599 },
];

export type DemoStep = { type: "scan"; sku: string } | { type: "charge"; tenderedCents: number };

/** The sale the hero plays: 2 cables, a charger and a case, paid with 60.00 in cash. */
export const DEMO_SCRIPT: readonly DemoStep[] = [
  { type: "scan", sku: "CBL-USBC-1M" },
  { type: "scan", sku: "CHG-20W-C" },
  { type: "scan", sku: "CBL-USBC-1M" },
  { type: "scan", sku: "CAS-IP15-CLR" },
  { type: "charge", tenderedCents: 6000 },
];

export type DemoLine = { sku: string; name: string; quantity: number; unitCents: number; lineCents: number };

export type DemoState = {
  status: "scanning" | "paid";
  lines: DemoLine[];
  lastSku: string | null;
  totalCents: number;
  taxCents: number;
  tenderedCents: number;
  changeCents: number;
  /** Sample "today" figures shown by the dashboard card once the sale is paid. */
  saleNumber: number;
  todaySalesCents: number;
  todaySalesCount: number;
};

/** Sample baseline for the dashboard card (clearly labelled as sample data in the UI). */
const BASE_TODAY = { saleNumber: 1042, salesCents: 128_410, count: 41 };

export const INITIAL_DEMO: DemoState = {
  status: "scanning",
  lines: [],
  lastSku: null,
  totalCents: 0,
  taxCents: 0,
  tenderedCents: 0,
  changeCents: 0,
  saleNumber: BASE_TODAY.saleNumber,
  todaySalesCents: BASE_TODAY.salesCents,
  todaySalesCount: BASE_TODAY.count,
};

/** Tax already included in a tax-inclusive total: total − total / (1 + rate). */
export function includedTax(totalCents: number, rate = DEMO_TAX_RATE): number {
  return Math.round(totalCents - totalCents / (1 + rate));
}

export function productBySku(sku: string): DemoProduct {
  const product = DEMO_CATALOG.find((p) => p.sku === sku);
  if (!product) throw new Error(`Unknown demo product ${sku}`);
  return product;
}

export type DemoAction = DemoStep | { type: "reset" } | { type: "finish" };

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return INITIAL_DEMO;
    case "finish":
      return DEMO_SCRIPT.reduce(demoReducer, INITIAL_DEMO);
    case "scan": {
      if (state.status === "paid") return state;
      const product = productBySku(action.sku);
      const existing = state.lines.find((l) => l.sku === product.sku);
      const lines = existing
        ? state.lines.map((l) => (l.sku === product.sku ? { ...l, quantity: l.quantity + 1, lineCents: (l.quantity + 1) * l.unitCents } : l))
        : [...state.lines, { sku: product.sku, name: product.name, quantity: 1, unitCents: product.priceCents, lineCents: product.priceCents }];
      const totalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);
      return { ...state, lines, lastSku: product.sku, totalCents, taxCents: includedTax(totalCents) };
    }
    case "charge": {
      if (state.status === "paid" || state.lines.length === 0 || action.tenderedCents < state.totalCents) return state;
      return {
        ...state,
        status: "paid",
        tenderedCents: action.tenderedCents,
        changeCents: action.tenderedCents - state.totalCents,
        saleNumber: state.saleNumber + 1,
        todaySalesCents: state.todaySalesCents + state.totalCents,
        todaySalesCount: state.todaySalesCount + 1,
      };
    }
  }
}

/** The state after the whole script: what reduced-motion users see right away. */
export const FINAL_DEMO: DemoState = demoReducer(INITIAL_DEMO, { type: "finish" });

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
