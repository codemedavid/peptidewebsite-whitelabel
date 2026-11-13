"use client";

import { memo, useEffect, useRef, type MutableRefObject } from "react";
import { useCategoryScrollSpy } from "./useCategoryScrollSpy";

type NavSection = { id: string; label: string };

/**
 * The sticky, horizontally swipeable category bar of the sections catalog.
 * Owns the active-category state on its own, so a scroll that moves the
 * highlight re-renders only this bar — never the product grids.
 *
 * Buttons, not anchors: the storefront is hash-routed, so an href="#…" would be
 * read as a page navigation.
 */
export const CategoryNav = memo(function CategoryNav({
  sections,
  sectionEls,
}: {
  sections: readonly NavSection[];
  sectionEls: MutableRefObject<Map<string, HTMLElement>>;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const { active, headerHeight, scrollToSection } = useCategoryScrollSpy({
    ids: sections.map((s) => s.id),
    sectionEls,
    navRef,
  });

  // Keep the active tab in view inside the bar — scrolling the bar only, never
  // the page (scrollIntoView would fight the page's own smooth scroll).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = active ? tabRefs.current.get(active) : undefined;
    if (!scroller || !tab) return;
    const left = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [active]);

  if (sections.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="catsec-nav"
      aria-label="Product categories"
      style={headerHeight === null ? undefined : { top: headerHeight }}
    >
      <div className="container">
        <div className="catsec-nav__scroll" ref={scrollerRef}>
          {sections.map((s) => (
            <button
              key={s.id}
              ref={(el) => {
                if (el) tabRefs.current.set(s.id, el);
                else tabRefs.current.delete(s.id);
              }}
              type="button"
              className={`chip catsec-nav__tab${active === s.id ? " is-active" : ""}`}
              aria-current={active === s.id ? "true" : undefined}
              onClick={() => scrollToSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
});
