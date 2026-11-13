"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { pickActiveSection } from "@/lib/storefront/category-sections";

/** No scroll event for this long = a smooth scroll has settled. */
const SCROLL_SETTLE_MS = 150;
/** Never hold the click lock longer than this, whatever the browser does. */
const MAX_LOCK_MS = 2500;
/** Bottom of the "reading zone": sections are tracked between the sticky bar
 *  and 60% down the viewport, so a short section can still become active. */
const ZONE_BOTTOM_MARGIN = "-40%";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Height of the store's sticky header (0 when the owner hid it), kept live. */
function useHeaderHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".sf-root .site-header");
    if (!header) {
      setHeight(0);
      return;
    }
    const measure = () => setHeight(Math.round(header.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return height;
}

/**
 * Tracks which category section the shopper is reading (IntersectionObserver —
 * no per-frame scroll handler) and scrolls to a section on demand.
 *
 * While a tab-click's smooth scroll is in flight the observer is ignored, so
 * the highlight goes straight to the clicked tab instead of flickering through
 * every section it passes. The lock releases once scrolling settles, then the
 * real position is re-read — unless the page bottomed out before the target
 * could reach the bar (a short last section), where the clicked tab stays lit.
 */
export function useCategoryScrollSpy({
  ids,
  sectionEls,
  navRef,
}: {
  ids: readonly string[];
  sectionEls: MutableRefObject<Map<string, HTMLElement>>;
  navRef: RefObject<HTMLElement | null>;
}): { active: string | null; headerHeight: number | null; scrollToSection: (id: string) => void } {
  const headerHeight = useHeaderHeight();
  const [navHeight, setNavHeight] = useState(0);
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const locked = useRef(false);
  const releaseCleanup = useRef<(() => void) | null>(null);
  const offset = (headerHeight ?? 0) + navHeight;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const key = ids.join("\u0000");

  // The bar's own height (it wraps differently per theme / font / width).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => setNavHeight(Math.round(nav.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    // Headings scrolled to by focus / the browser land below the bar too.
    nav.parentElement?.style.setProperty("--catsec-offset", `${offsetRef.current}px`);
    return () => ro.disconnect();
  }, [navRef]);

  useEffect(() => {
    navRef.current?.parentElement?.style.setProperty("--catsec-offset", `${offset}px`);
  }, [navRef, offset]);

  // A search can remove the active section — fall back to the first one.
  useEffect(() => {
    setActive((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (ids.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.catsecId;
          if (id) visible.set(id, e.isIntersecting);
        }
        if (locked.current) return;
        const first = ids.find((id) => visible.get(id));
        if (first) setActive((prev) => (prev === first ? prev : first));
      },
      { rootMargin: `-${offset + 1}px 0px ${ZONE_BOTTOM_MARGIN} 0px`, threshold: 0 },
    );
    for (const id of ids) {
      const el = sectionEls.current.get(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset, sectionEls]);

  useEffect(() => () => releaseCleanup.current?.(), []);

  const syncFromLayout = useCallback(() => {
    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) return;
    const tops = ids.map((id) => ({
      id,
      top: sectionEls.current.get(id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    }));
    const next = pickActiveSection(tops, offsetRef.current);
    if (next) setActive(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sectionEls]);

  const scrollToSection = useCallback(
    (id: string) => {
      const el = sectionEls.current.get(id);
      if (!el) return;
      releaseCleanup.current?.();
      locked.current = true;
      setActive(id);

      let settle = 0;
      const release = () => {
        cleanup();
        locked.current = false;
        syncFromLayout();
      };
      const onScroll = () => {
        window.clearTimeout(settle);
        settle = window.setTimeout(release, SCROLL_SETTLE_MS);
      };
      const cap = window.setTimeout(release, MAX_LOCK_MS);
      const cleanup = () => {
        window.clearTimeout(settle);
        window.clearTimeout(cap);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("scrollend", release);
        releaseCleanup.current = null;
      };
      releaseCleanup.current = cleanup;
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("scrollend", release, { once: true });
      settle = window.setTimeout(release, SCROLL_SETTLE_MS); // already in place = no scroll events

      const top = el.getBoundingClientRect().top + window.scrollY - offsetRef.current;
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
      // Keyboard / screen-reader users land on the section they asked for.
      el.querySelector<HTMLElement>("[data-catsec-heading]")?.focus({ preventScroll: true });
    },
    [sectionEls, syncFromLayout],
  );

  return { active, headerHeight, scrollToSection };
}
