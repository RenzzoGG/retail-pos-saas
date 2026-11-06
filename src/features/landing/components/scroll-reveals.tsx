"use client";

import { useEffect, useState } from "react";
import { MOTION_OK, gsap, useGSAP, useScrollPlugins } from "../gsap";

/**
 * ONE invisible island that animates every server-rendered block marked with
 * [data-reveal-group] (the text itself never becomes a client component, so
 * React doesn't have to hydrate it: that alone removed a ~0.5 s long task on
 * mobile).
 *
 * Inside each group:
 *  - [data-split]: a heading split into LINES with SplitText; each line rises
 *    from behind a mask. SplitText keeps it accessible (aria-label on the
 *    heading, aria-hidden on the line wrappers), and autoSplit re-splits when
 *    fonts load or the width changes, re-creating the animation returned from
 *    onSplit with the same progress.
 *  - [data-reveal]: fades up one after another (stagger). opacity only — never
 *    visibility: hidden — so screen readers can always read the text.
 *
 * Lazy setup: the plugins are downloaded when the browser is idle, and an
 * IntersectionObserver sets up a group only when it is about one viewport away.
 * Creating ScrollTriggers and splitting text measures the layout; doing it for
 * the whole page at load time caused long tasks.
 *
 * Cleanup: animations created LATER (in the observer callback) must still belong
 * to the matchMedia context so they are reverted on unmount or when the motion
 * preference changes. `context.add("reveal", fn)` registers a method whose
 * animations are recorded in that context whenever it is called.
 */
export function ScrollReveals() {
  // Load ScrollTrigger + SplitText when the browser is idle after the first paint.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const done = () => setIdle(true);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(done, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(done, 1200);
    return () => clearTimeout(id);
  }, []);
  const plugins = useScrollPlugins(idle);

  useGSAP(() => {
    if (!plugins) return;
    const { SplitText } = plugins;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, (context) => {
      context.add("reveal", (group: HTMLElement) => {
        for (const heading of group.querySelectorAll<HTMLElement>("[data-split]")) {
          SplitText.create(heading, {
            type: "lines",
            mask: "lines",
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.lines, {
                yPercent: 110,
                duration: 0.8,
                stagger: 0.08,
                ease: "power4.out",
                scrollTrigger: { trigger: heading, start: "top 88%", once: true },
              }),
          });
        }
        const items = group.querySelectorAll("[data-reveal]");
        if (items.length > 0) {
          gsap.from(items, {
            opacity: 0,
            y: 28,
            duration: 0.7,
            stagger: 0.12,
            ease: "power3.out",
            scrollTrigger: { trigger: group, start: "top 82%", once: true },
          });
        }
      });

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            // Calling the registered method: its animations join the context.
            (context as unknown as { reveal: (el: Element) => void }).reveal(entry.target);
          }
        },
        { rootMargin: "0px 0px 100% 0px" },
      );
      for (const group of document.querySelectorAll("[data-reveal-group]")) observer.observe(group);
      return () => observer.disconnect();
    });
  }, [plugins]);
  return null;
}
