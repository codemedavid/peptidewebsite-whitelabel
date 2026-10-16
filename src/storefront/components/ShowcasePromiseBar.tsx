"use client";

// The SHOWCASE layout's promise bar — the thin strip ABOVE the header that
// repeats the owner's promises on every screen ("Fast & secure shipping ·
// Authentic products · …"). Chrome, not home content: StorefrontApp renders it
// before <Header> so it persists across every route of the layout.
//
// Its lines are the owner's own assurances (branding.config.boutique), so a
// store that has typed none simply has no bar. Each line's pictogram is read
// from its own words by assuranceIcon().
//
// Desktop shows every promise in one row. A phone is too narrow for that, so
// there the promises share one centred slot and rotate (`is-active` marks the
// one shown; showcase.css does the stacking and the fade). Shoppers who ask for
// reduced motion get no rotation — the CSS shows all of them in a small grid.

import { useEffect, useState, type CSSProperties } from "react";
import type { BoutiqueAssurance } from "@/lib/storefront/boutique-home";
import { assuranceIcon } from "@/lib/storefront/showcase-home";
import { ShowcaseIcon } from "./ShowcaseIcon";

/** How long each promise stays up on a phone. */
const ROTATE_MS = 4000;
/** Must match the phone breakpoint in showcase.css. */
const PHONE_QUERY = "(max-width: 819px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePromiseRotation(count: number): number {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (count < 2 || typeof window.matchMedia !== "function") return;
    const phone = window.matchMedia(PHONE_QUERY);
    const calm = window.matchMedia(REDUCED_MOTION_QUERY);
    let timer: number | undefined;

    const sync = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (phone.matches && !calm.matches) {
        timer = window.setInterval(() => setActive((i) => (i + 1) % count), ROTATE_MS);
      }
    };

    sync();
    phone.addEventListener("change", sync);
    calm.addEventListener("change", sync);
    return () => {
      window.clearInterval(timer);
      phone.removeEventListener("change", sync);
      calm.removeEventListener("change", sync);
    };
  }, [count]);

  return count > 0 ? active % count : 0;
}

type Props = {
  assurances: BoutiqueAssurance[];
  /** The owner's colour overrides, already sanitised by promiseBarVars. */
  colorVars?: Record<string, string>;
};

export function ShowcasePromiseBar({ assurances, colorVars }: Props) {
  const active = usePromiseRotation(assurances.length);
  if (assurances.length === 0) return null;

  return (
    <aside className="sc-promise" aria-label="Store promises" style={colorVars as CSSProperties}>
      <ul className="container sc-promise__row">
        {assurances.map((item, i) => (
          <li key={item.id} className={`sc-promise__item${i === active ? " is-active" : ""}`}>
            <ShowcaseIcon icon={assuranceIcon(item.label, item.note)} size={16} />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
