"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { ScrollTrigger as ScrollTriggerType } from "gsap/ScrollTrigger";
import type { SplitText as SplitTextType } from "gsap/SplitText";
import { useEffect, useState } from "react";

/**
 * GSAP for the landing only.
 *  - The CORE (gsap + useGSAP) loads with the page: the hero needs it at once.
 *  - ScrollTrigger and SplitText are loaded on demand with a dynamic import()
 *    (their own chunk), only when a section needs them. Evaluating them during
 *    page load cost ~100–150 ms of main thread on a throttled phone.
 */
if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP);
}

/** Only this condition creates animations; with "reduce" nothing moves. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED).matches;
}

export type ScrollPlugins = { ScrollTrigger: typeof ScrollTriggerType; SplitText: typeof SplitTextType };

let plugins: Promise<ScrollPlugins> | null = null;

/** Loads and registers ScrollTrigger + SplitText once (the promise is shared). */
export function loadScrollPlugins(): Promise<ScrollPlugins> {
  plugins ??= Promise.all([import("gsap/ScrollTrigger"), import("gsap/SplitText")]).then(([st, split]) => {
    gsap.registerPlugin(st.ScrollTrigger, split.SplitText);
    return { ScrollTrigger: st.ScrollTrigger, SplitText: split.SplitText };
  });
  return plugins;
}

/**
 * The scroll plugins once `enabled` is true and they finished loading (null
 * until then). Skipped entirely with reduced motion: nothing is downloaded.
 */
export function useScrollPlugins(enabled: boolean): ScrollPlugins | null {
  const [loaded, setLoaded] = useState<ScrollPlugins | null>(null);
  useEffect(() => {
    if (!enabled || loaded || prefersReducedMotion()) return;
    let active = true;
    loadScrollPlugins().then((p) => {
      if (active) setLoaded(p);
    });
    return () => {
      active = false;
    };
  }, [enabled, loaded]);
  return loaded;
}

export { gsap, useGSAP };
