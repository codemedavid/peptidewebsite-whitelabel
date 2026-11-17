"use client";

// "Get our app" bar on the store's website (rules: lib/storefront/app-promo.ts).
// A small card that slides up from the bottom a moment after the page settles,
// wearing the store's own colours and logo, and links to the store's app page
// (<store>/app — the right store button for the visitor's phone, a QR on a
// computer). Dismissing it hides it for DISMISS_DAYS on this browser.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Smartphone, X } from "lucide-react";

const SHOW_AFTER_MS = 1200;
const DISMISS_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The store's own palette (the same Brand the storefront paints with), so the bar never looks generic. */
export type AppPromoColors = { surface: string; text: string; button: string; button2: string; buttonText: string };

type Props = {
  storeName: string;
  colors: AppPromoColors;
  /** Already sized (imageUrl); null → a phone glyph on the brand colour. */
  logoUrl: string | null;
  /** Separates one store's dismissal from another's on a shared domain. */
  storeKey: string;
};

const keyFor = (store: string) => `pepweb.appPromo.dismissed.${store}`;

function isDismissed(store: string): boolean {
  try {
    const until = Number(localStorage.getItem(keyFor(store)));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function AppPromoBar({ storeName, colors, logoUrl, storeKey }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isDismissed(storeKey)) return;
    const id = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [storeKey]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(keyFor(storeKey), String(Date.now() + DISMISS_DAYS * DAY_MS));
    } catch {
      // Private mode: it just comes back next visit.
    }
  };

  return (
    <aside
      aria-label={`${storeName} app`}
      aria-hidden={!visible}
      className={[
        "fixed inset-x-3 z-[60] mx-auto max-w-md motion-safe:transition-[transform,opacity] motion-safe:duration-300 motion-safe:ease-out",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
      ].join(" ")}
      style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <div
        className="flex items-center gap-3 rounded-2xl border p-3 pr-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.28)]"
        style={{ backgroundColor: colors.surface, color: colors.text, borderColor: `color-mix(in srgb, ${colors.text} 12%, transparent)` }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl object-contain" />
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: colors.button, color: colors.buttonText }}>
            <Smartphone aria-hidden size={22} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-tight">{`${storeName} has an app`}</p>
          <p className="mt-0.5 text-xs leading-snug opacity-70">Order faster and follow your delivery.</p>
        </div>
        <Link
          href="/app"
          tabIndex={visible ? 0 : -1}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ backgroundImage: `linear-gradient(135deg, ${colors.button}, ${colors.button2})`, color: colors.buttonText, outlineColor: colors.button }}
        >
          Get the app
        </Link>
        <button
          type="button"
          onClick={dismiss}
          tabIndex={visible ? 0 : -1}
          aria-label="Hide for now"
          className="inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2"
        >
          <X aria-hidden size={18} />
        </button>
      </div>
    </aside>
  );
}
