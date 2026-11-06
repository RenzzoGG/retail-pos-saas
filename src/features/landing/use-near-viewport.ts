"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * True once the element is close to the viewport (and stays true).
 *
 * Why: creating a ScrollTrigger or splitting a heading with SplitText MEASURES
 * the layout. Doing it for every section during page load produced long tasks
 * (Lighthouse mobile TBT ~1.3 s). With this hook each section sets up its
 * animations only when it is about to scroll into view, so the load only pays
 * for the hero. `margin` is how far below the viewport to start (default: one
 * extra viewport), so the "from" state is applied before the section is seen.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "0px 0px 100% 0px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
