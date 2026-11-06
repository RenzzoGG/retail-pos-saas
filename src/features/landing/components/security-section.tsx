"use client";

import { useRef } from "react";
import { MOTION_OK, gsap, useGSAP, useScrollPlugins } from "../gsap";
import { useNearViewport } from "../use-near-viewport";

/**
 * Illustration of store isolation + the animation of the whole "Team &
 * security" section. The section's text is server HTML (page.tsx); this client
 * island finds its parent <section> and animates it:
 *  - Desktop: the section is PINNED while you scroll and the scroll drives
 *    (scrub) a timeline: the roles appear, a request from another store travels
 *    towards this store's data and is blocked by row-level security.
 *  - Phones: no pin (it feels like the page is stuck); the timeline plays once.
 *  - Reduced motion: nothing moves; everything is visible as rendered.
 */
export function SecurityArt() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const plugins = useScrollPlugins(near);

  useGSAP(
    () => {
      if (!plugins) return;
      const section = ref.current?.closest("section");
      if (!section) return;
      const roles = section.querySelectorAll("[data-role]");
      const build = (scrollTrigger: ScrollTrigger.Vars) =>
        gsap
          .timeline({ defaults: { ease: "power2.out" }, scrollTrigger })
          // Informative text: opacity only, so it is never removed from the accessibility tree.
          .from(roles, { opacity: 0, x: -30, stagger: 0.25, duration: 0.6 })
          .from("[data-packet]", { autoAlpha: 0, duration: 0.2 })
          .fromTo("[data-packet]", { xPercent: 0 }, { xPercent: 260, duration: 1.2, ease: "power1.in" })
          .to("[data-wall]", { keyframes: { x: [0, 5, -5, 3, 0] }, duration: 0.4 })
          .to("[data-packet]", { autoAlpha: 0, scale: 0.4, duration: 0.25 }, "<")
          .from("[data-blocked]", { autoAlpha: 0, y: 12, duration: 0.5 });

      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (min-width: 768px)`, () => {
        build({ trigger: section, pin: true, start: "top top", end: "+=140%", scrub: 0.8 });
        // The pin adds scroll space: recalculate triggers created before it.
        plugins.ScrollTrigger.refresh();
      });
      mm.add(`${MOTION_OK} and (max-width: 767px)`, () => {
        build({ trigger: ref.current, start: "top 75%", once: true });
      });
    },
    { scope: ref, dependencies: [plugins] },
  );

  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-white/5 p-5" aria-hidden="true">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="relative rounded-xl bg-white/10 p-3">
          <p className="text-xs font-semibold text-slate-300">Another store</p>
          <span data-packet className="absolute top-1/2 left-3 mt-2 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-slate-900">
            GET sales
          </span>
          <div className="mt-6 h-10 rounded bg-white/10" />
        </div>
        <div data-wall className="flex h-28 w-3 flex-col items-center justify-center rounded-full bg-gradient-to-b from-indigo-400 to-fuchsia-400">
          <span className="text-base">🔒</span>
        </div>
        <div className="rounded-xl bg-white/10 p-3">
          <p className="text-xs font-semibold text-slate-300">Your store</p>
          <div className="mt-2 space-y-1.5">
            <div className="h-2.5 rounded bg-white/30" />
            <div className="h-2.5 w-4/5 rounded bg-white/30" />
            <div className="h-2.5 w-3/5 rounded bg-white/30" />
          </div>
        </div>
      </div>
      <p data-blocked className="mt-5 rounded-lg bg-red-500/15 px-3 py-2 text-center text-sm text-red-200">
        Blocked by row-level security: each store only ever sees its own rows.
      </p>
    </div>
  );
}
