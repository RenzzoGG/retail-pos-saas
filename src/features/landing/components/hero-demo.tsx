"use client";

import { useReducer, useRef, useState } from "react";
import { DEMO_SCRIPT, INITIAL_DEMO, type DemoLine, demoReducer, formatUsd, productBySku } from "../demo-cart";
import { MOTION_OK, REDUCED, gsap, prefersReducedMotion, useGSAP } from "../gsap";

/**
 * The hero's living register. Two layers work together:
 *  - A GSAP TIMELINE is the "director": it types the barcode, sweeps the laser,
 *    presses Charge and decides WHEN each step of the sale happens (.call()).
 *  - React (useReducer + demo-cart.ts) renders WHAT is on screen. Elements that
 *    appear (a cart line, the paid banner, the dashboard card) animate themselves
 *    when they mount, with their own small useGSAP.
 * With prefers-reduced-motion: reduce, nothing is animated: the finished sale
 * is shown at once. The whole mock is decorative (aria-hidden); a text
 * description sits next to it for screen readers.
 */
export function HeroDemo() {
  const root = useRef<HTMLDivElement>(null);
  const scan = useRef<HTMLSpanElement>(null);
  const [state, dispatch] = useReducer(demoReducer, INITIAL_DEMO);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add({ motion: MOTION_OK, reduce: REDUCED }, (context) => {
        if (context.conditions?.reduce) {
          dispatch({ type: "finish" }); // no motion: show the result
          return;
        }
        const field = scan.current as HTMLSpanElement;
        const clearField = () => {
          field.textContent = "";
        };

        const tl = gsap.timeline({
          delay: 0.8,
          repeat: -1, // loop forever...
          repeatDelay: 1.5, // ...with a pause between loops
          defaults: { ease: "power2.out" },
          onRepeat: () => {
            dispatch({ type: "reset" });
            clearField();
          },
        });

        for (const step of DEMO_SCRIPT) {
          if (step.type === "scan") {
            const code = productBySku(step.sku).barcode;
            const typed = { chars: 0 }; // a "proxy" object: GSAP tweens a number, onUpdate writes the text
            tl.set(typed, { chars: 0 })
              .to(typed, {
                chars: code.length,
                duration: 0.5,
                ease: "none",
                onUpdate: () => {
                  field.textContent = code.slice(0, Math.round(typed.chars));
                },
              })
              // "<0.25" = start 0.25 s after the START of the previous tween (overlap).
              .fromTo("[data-laser]", { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, duration: 0.3, ease: "power1.inOut" }, "<0.25")
              .to("[data-laser]", { autoAlpha: 0, duration: 0.15 })
              .call(() => {
                dispatch(step); // React adds the line; the line animates itself on mount
                clearField();
              })
              .to({}, { duration: 0.75 }); // an empty tween = a pause in the timeline
          } else {
            tl.to("[data-charge]", { scale: 0.94, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut" })
              .call(() => dispatch(step))
              .to({}, { duration: 3.4 }); // let people read the result
          }
        }

        // Pause the loop while the hero is off screen (saves CPU and battery).
        // A plain IntersectionObserver: the hero doesn't need ScrollTrigger, so
        // that plugin isn't part of the page's first load.
        const visibility = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? tl.resume() : tl.pause()));
        visibility.observe(root.current as HTMLDivElement);

        // Runs when this media condition stops matching (or on unmount):
        // matchMedia/useGSAP already kill the timeline.
        return () => {
          visibility.disconnect();
          dispatch({ type: "reset" });
          clearField();
        };
      });
    },
    { scope: root },
  );

  const paid = state.status === "paid";
  return (
    <div ref={root} className="relative mx-auto w-full max-w-xl" data-testid="hero-demo" data-status={state.status}>
      <p className="sr-only">
        Animated example of the Stocktill register with sample products: items are scanned into the cart, the total updates, the
        sale is paid in cash and today&apos;s sales go up on the dashboard.
      </p>
      <div aria-hidden="true" className="select-none">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-indigo-900/10 dark:border-slate-700 dark:bg-slate-900">
          {/* window bar */}
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
            <span className="ml-2 text-xs font-medium text-slate-600 dark:text-slate-300">Stocktill · Register</span>
            <span className="ml-auto rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100">
              Sample data
            </span>
          </div>

          <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <div className="min-w-0">
              {/* scan field */}
              <div className="relative flex items-center gap-2 overflow-hidden rounded-lg border-2 border-indigo-500 bg-white px-3 py-2 dark:bg-slate-950">
                <BarcodeIcon />
                <span
                  ref={scan}
                  className="min-h-5 font-mono text-sm text-slate-900 empty:before:text-slate-500 empty:before:content-['Scan_or_search…'] dark:text-slate-100"
                />
                <span data-laser className="absolute inset-x-0 top-1/2 h-0.5 origin-left bg-red-500 opacity-0 shadow-[0_0_8px_2px_rgba(239,68,68,.6)]" />
              </div>
              {/* cart */}
              <ul className="mt-3 space-y-2" data-testid="hero-cart">
                {state.lines.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700">
                    The cart is empty. Scan a product to start.
                  </li>
                ) : (
                  state.lines.map((line) => <CartLine key={line.sku} line={line} highlight={line.sku === state.lastSku && !paid} />)
                )}
              </ul>
            </div>

            {/* totals */}
            <div className="flex flex-col rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Tax (incl.)</span>
                <Money cents={state.taxCents} />
              </div>
              <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-700">
                <span className="font-semibold text-slate-900 dark:text-white">Total</span>
                <Money cents={state.totalCents} className="text-xl font-bold text-slate-900 dark:text-white" testId="hero-total" />
              </div>
              <div
                data-charge
                className={`mt-3 rounded-md px-3 py-2 text-center text-sm font-semibold text-white ${paid ? "bg-green-600" : "bg-indigo-600"}`}
              >
                {paid ? "Paid ✓" : "Charge  F8"}
              </div>
              {paid ? <PaidNote change={state.changeCents} number={state.saleNumber} /> : null}
            </div>
          </div>
        </div>

        {paid ? <DashboardCard cents={state.todaySalesCents} count={state.todaySalesCount} /> : null}
      </div>
    </div>
  );
}

function CartLine({ line, highlight }: { line: DemoLine; highlight: boolean }) {
  const ref = useRef<HTMLLIElement>(null);
  // Mount animation: the line slides in once (dependencies: [] by default).
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(ref.current, { autoAlpha: 0, y: -12, duration: 0.45, ease: "back.out(1.6)" });
    },
    { scope: ref },
  );
  // Quantity bump: re-runs when the quantity changes, without reverting the mount tween.
  useGSAP(
    () => {
      if (prefersReducedMotion() || line.quantity === 1) return;
      gsap.fromTo("[data-qty]", { scale: 1.6 }, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.5)" });
    },
    { scope: ref, dependencies: [line.quantity], revertOnUpdate: false },
  );
  return (
    <li
      ref={ref}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-500 ${
        highlight ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950" : "border-slate-200 dark:border-slate-700"
      }`}
    >
      <span data-qty className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-bold text-white dark:bg-white dark:text-slate-900">
        {line.quantity}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-100">{line.name}</span>
      <span className="font-mono text-slate-700 tabular-nums dark:text-slate-200">{formatUsd(line.lineCents)}</span>
    </li>
  );
}

/**
 * A number that counts to its new value. React renders the first value only;
 * after that GSAP writes the text (a "proxy" tween), so the two never fight.
 */
function Money({ cents, className = "", testId }: { cents: number; className?: string; testId?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(cents);
  const [initial] = useState(() => formatUsd(cents));
  useGSAP(
    () => {
      const el = ref.current as HTMLSpanElement;
      const from = shown.current;
      shown.current = cents;
      if (from === cents || prefersReducedMotion()) {
        el.textContent = formatUsd(cents);
        return;
      }
      const proxy = { value: from };
      gsap.to(proxy, {
        value: cents,
        duration: 0.6,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = formatUsd(Math.round(proxy.value));
        },
      });
    },
    { dependencies: [cents], revertOnUpdate: false },
  );
  return (
    <span ref={ref} className={`font-mono tabular-nums ${className}`} data-testid={testId} data-cents={cents}>
      {initial}
    </span>
  );
}

function PaidNote({ change, number }: { change: number; number: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(ref.current, { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: "back.out(2)" });
    },
    { scope: ref },
  );
  return (
    <p ref={ref} className="mt-2 text-center text-xs text-green-700 dark:text-green-400" data-testid="hero-paid">
      Sale #{number} · change {formatUsd(change)}
    </p>
  );
}

function DashboardCard({ cents, count }: { cents: number; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      // A tiny timeline: the card rises, then its bars grow one after another.
      gsap
        .timeline()
        .from(ref.current, { y: 40, autoAlpha: 0, duration: 0.6, ease: "power3.out" })
        .from("[data-bar]", { scaleY: 0, transformOrigin: "bottom", stagger: 0.06, duration: 0.4, ease: "power2.out" }, "-=0.25");
    },
    { scope: ref },
  );
  const bars = [38, 52, 44, 61, 57, 70, 86];
  return (
    <div
      ref={ref}
      data-testid="hero-dashboard"
      className="mt-4 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:absolute sm:-right-6 sm:-bottom-32 sm:mt-0 sm:w-56 dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Sales today · sample</p>
      <p className="mt-0.5 font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-white">{formatUsd(cents)}</p>
      <p className="text-xs text-green-700 dark:text-green-400">{count} sales</p>
      <div className="mt-2 flex h-12 items-end gap-1">
        {bars.map((h, i) => (
          <span key={i} data-bar className={`flex-1 rounded-t-sm ${i === bars.length - 1 ? "bg-indigo-500" : "bg-indigo-200 dark:bg-indigo-800"}`} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function BarcodeIcon() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0 text-slate-500" fill="currentColor">
      {[0, 2, 3, 5, 8, 9, 11, 14, 15, 17, 19, 20, 22].map((x) => (
        <rect key={x} x={x} y="0" width={x % 3 === 0 ? 1.4 : 0.8} height="16" />
      ))}
    </svg>
  );
}
