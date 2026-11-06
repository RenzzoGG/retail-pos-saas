"use client";

import { useRef } from "react";
import { MOTION_OK, gsap, useGSAP, useScrollPlugins } from "../gsap";
import { useNearViewport } from "../use-near-viewport";

/**
 * Small illustrations for the feature sections, built with HTML/CSS (no images)
 * and SAMPLE data. Each one renders its FINAL state on the server, so it is
 * complete without JS or with reduced motion; GSAP animates towards that state
 * only when motion is allowed (gsap.matchMedia).
 */

const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900";

/* 1. Point of sale & scanning: a looping scan that only runs while visible. */
export function ScanArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near); // ScrollTrigger arrives when the art is about to be seen
  useGSAP(
    () => {
      if (!plugins) return;
      gsap.matchMedia().add(MOTION_OK, () => {
        const tl = gsap.timeline({
          repeat: -1,
          repeatDelay: 0.4,
          // play when it enters, pause when it leaves, resume when it comes back
          scrollTrigger: { trigger: ref.current, start: "top 85%", end: "bottom 15%", toggleActions: "play pause resume pause" },
        });
        tl.fromTo("[data-laser]", { yPercent: -50, autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 })
          .to("[data-laser]", { yPercent: 4200, duration: 0.6, ease: "power1.inOut" })
          .to("[data-laser]", { autoAlpha: 0, duration: 0.1 })
          .fromTo("[data-beep]", { autoAlpha: 0, scale: 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.25, ease: "back.out(3)" }, "<")
          .fromTo("[data-count]", { scale: 1.5 }, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.5)" }, "<")
          .to("[data-beep]", { autoAlpha: 0, duration: 0.3 }, "+=0.5");
      });
    },
    { scope: ref, dependencies: [plugins] },
  );
  return (
    <div ref={ref} className={`${card} relative`} aria-hidden="true">
      <div className="relative mx-auto h-24 w-full max-w-64 overflow-hidden rounded-md bg-slate-50 p-3 dark:bg-slate-800">
        <svg viewBox="0 0 100 40" className="h-full w-full text-slate-900 dark:text-slate-100" preserveAspectRatio="none" fill="currentColor">
          {Array.from({ length: 34 }, (_, i) => (
            <rect key={i} x={i * 3} y="0" width={i % 4 === 0 ? 2 : i % 3 === 0 ? 1.4 : 0.8} height="40" />
          ))}
        </svg>
        <span data-laser className="absolute inset-x-2 top-1 h-0.5 bg-red-500 opacity-0 shadow-[0_0_10px_2px_rgba(239,68,68,.7)]" />
        <span data-beep className="absolute top-2 right-2 rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold text-white opacity-0">
          Beep
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
        <span className="text-slate-800 dark:text-slate-100">USB-C Cable 1 m</span>
        <span data-count className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-xs font-bold text-white">
          ×3
        </span>
      </div>
      <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">F2 scan · F4 customer · F8 charge</p>
    </div>
  );
}

/* 2. Inventory: stock bars follow the scroll (scrub); a low-stock badge appears. */
const STOCK = [
  { name: "Wireless Mouse", from: 24, to: 16, max: 30 },
  { name: "Power Bank 20,000 mAh", from: 12, to: 3, max: 30, low: true },
  { name: "Screen Protector", from: 70, to: 58, max: 80 },
];
export function StockArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near); // ScrollTrigger arrives when the art is about to be seen
  useGSAP(
    () => {
      if (!plugins) return;
      gsap.matchMedia().add(MOTION_OK, () => {
        // scrub ties the timeline's progress to the scroll position (0.6 s smoothing).
        const tl = gsap.timeline({ scrollTrigger: { trigger: ref.current, start: "top 80%", end: "bottom 45%", scrub: 0.6 } });
        STOCK.forEach((row, i) => {
          const counter = { value: row.from };
          const label = ref.current?.querySelector<HTMLElement>(`[data-stock="${i}"]`);
          tl.from(`[data-bar="${i}"]`, { scaleX: row.from / row.to, transformOrigin: "left", ease: "none", duration: 1 }, 0).fromTo(
            counter,
            { value: row.from },
            {
              value: row.to,
              ease: "none",
              duration: 1,
              onUpdate: () => {
                if (label) label.textContent = String(Math.round(counter.value));
              },
            },
            0,
          );
        });
        tl.from("[data-low]", { autoAlpha: 0, scale: 0.5, duration: 0.2, ease: "back.out(3)" }, 0.8);
      });
    },
    { scope: ref, dependencies: [plugins] },
  );
  return (
    <div ref={ref} className={card} aria-hidden="true">
      <ul className="space-y-4">
        {STOCK.map((row, i) => (
          <li key={row.name}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-slate-800 dark:text-slate-100">{row.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                {row.low ? (
                  <span data-low className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    Low stock
                  </span>
                ) : null}
                <span data-stock={i} className="w-6 text-right font-mono text-slate-700 tabular-nums dark:text-slate-200">
                  {row.to}
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                data-bar={i}
                className={`h-2 rounded-full ${row.low ? "bg-amber-500" : "bg-indigo-500"}`}
                style={{ width: `${(row.to / row.max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 3. Excel import: preview rows arrive one by one; the bad row shakes. */
const IMPORT_ROWS = [
  { sku: "CBL-HDMI-2M", status: "New", tone: "green" },
  { sku: "CHG-65W-GAN", status: "Update", tone: "blue" },
  { sku: "ACC-HUB-7IN1", status: "New", tone: "green" },
  { sku: "=1+1", status: "Error: invalid SKU", tone: "red" },
  { sku: "AUD-SPK-MINI", status: "New", tone: "green" },
];
const TONE: Record<string, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};
export function ImportArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near); // ScrollTrigger arrives when the art is about to be seen
  useGSAP(
    () => {
      if (!plugins) return;
      gsap.matchMedia().add(MOTION_OK, () => {
        gsap
          .timeline({ scrollTrigger: { trigger: ref.current, start: "top 75%", once: true } })
          .from("[data-file]", { autoAlpha: 0, x: -30, rotate: -6, duration: 0.5, ease: "power3.out" })
          .from("[data-row]", { autoAlpha: 0, x: -24, duration: 0.35, stagger: 0.12, ease: "power2.out" }, "-=0.1")
          // keyframes: several steps in one tween (a "shake")
          .to("[data-row-error]", { keyframes: { x: [0, -6, 6, -4, 4, 0] }, duration: 0.45, ease: "none" });
      });
    },
    { scope: ref, dependencies: [plugins] },
  );
  return (
    <div ref={ref} className={card} aria-hidden="true">
      <div data-file className="mb-3 inline-flex items-center gap-2 rounded-md bg-green-700 px-2.5 py-1 text-xs font-semibold text-white">
        products.xlsx · 600 rows
      </div>
      <ul className="space-y-1.5 text-sm">
        {IMPORT_ROWS.map((r) => (
          <li
            key={r.sku}
            data-row
            {...(r.tone === "red" ? { "data-row-error": true } : {})}
            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-1.5 dark:border-slate-700"
          >
            <span className="truncate font-mono text-xs text-slate-800 dark:text-slate-100">{r.sku}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.tone]}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 4. 80 mm receipt: it "prints" with the scroll (clip-path scrub), then a RETURNED stamp lands. */
export function ReceiptArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near); // ScrollTrigger arrives when the art is about to be seen
  useGSAP(
    () => {
      if (!plugins) return;
      gsap.matchMedia().add(MOTION_OK, () => {
        gsap.from("[data-paper]", {
          clipPath: "inset(0% 0% 100% 0%)",
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top 85%", end: "center 50%", scrub: 0.5 },
        });
        gsap.from("[data-stamp]", {
          autoAlpha: 0,
          scale: 2.4,
          rotate: -35,
          duration: 0.5,
          ease: "back.out(1.8)",
          scrollTrigger: { trigger: ref.current, start: "center 55%", toggleActions: "play none none reverse" },
        });
      });
    },
    { scope: ref, dependencies: [plugins] },
  );
  const line = (l: string, r: string) => (
    <div className="flex justify-between gap-2">
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
  return (
    <div ref={ref} className="relative flex justify-center" aria-hidden="true">
      <div
        data-paper
        className="relative w-60 bg-white px-4 py-5 font-mono text-[11px] leading-relaxed text-slate-800 shadow-xl [clip-path:inset(0%_0%_0%_0%)] dark:bg-slate-100"
      >
        <p className="text-center font-bold">STOCKTILL DEMO STORE</p>
        <p className="text-center">Sale #1043 · sample</p>
        <p className="my-1 border-t border-dashed border-slate-400" />
        {line("2 x USB-C Cable", "$19.98")}
        {line("1 x 20 W Charger", "$19.99")}
        {line("1 x Phone Case", "$15.99")}
        <p className="my-1 border-t border-dashed border-slate-400" />
        {line("Tax 8.25% (incl.)", "$4.26")}
        <div className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>$55.96</span>
        </div>
        {line("Cash", "$60.00")}
        {line("Change", "$4.04")}
        <p className="mt-2 text-center">Thank you!</p>
        <span
          data-stamp
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded border-4 border-red-600 px-2 py-1 text-base font-black tracking-widest text-red-600"
        >
          RETURNED
        </span>
      </div>
    </div>
  );
}

/* 5. Reports: columns grow one after another and the KPI counts up. */
const COLUMNS = [42, 55, 38, 61, 73, 58, 80, 66, 91, 77, 85, 96];
export function ReportsArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near); // ScrollTrigger arrives when the art is about to be seen
  useGSAP(
    () => {
      if (!plugins) return;
      gsap.matchMedia().add(MOTION_OK, () => {
        const kpi = ref.current?.querySelector<HTMLElement>("[data-kpi]");
        const counter = { value: 0 };
        gsap
          .timeline({ scrollTrigger: { trigger: ref.current, start: "top 75%", once: true } })
          .from("[data-col]", { scaleY: 0, transformOrigin: "bottom", duration: 0.5, stagger: 0.05, ease: "power3.out" })
          .to(
            counter,
            {
              value: 4812.5,
              duration: 1.2,
              ease: "power2.out",
              onUpdate: () => {
                if (kpi) kpi.textContent = `$${counter.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              },
            },
            0,
          );
      });
    },
    { scope: ref, dependencies: [plugins] },
  );
  return (
    <div ref={ref} className={card} aria-hidden="true">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Gross profit · sample</p>
          <p data-kpi className="font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            $4,812.50
          </p>
        </div>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-100">▲ 12%</span>
      </div>
      <div className="mt-4 flex h-28 items-end gap-1.5">
        {COLUMNS.map((h, i) => (
          <span key={i} data-col className="flex-1 rounded-t" style={{ height: `${h}%`, background: "var(--viz-series-1)" }} />
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <span className="rounded-md bg-green-700 px-2.5 py-1 text-xs font-semibold text-white">Export to Excel</span>
      </div>
    </div>
  );
}
