"use client";

// "Send this product" — the one control that turns a catalog into something an
// owner can work from a chat window.
//
// Two behaviours behind one button, chosen by what the device can do:
//   - navigator.share  → the OS share sheet. This is the whole point on mobile:
//                        one tap from the card into Messenger/Viber, no paste.
//   - clipboard        → copy the URL, confirm inline. The desktop path.
// If both refuse (in-app webviews deny the clipboard API and expose no share
// target), the URL is put on screen selectable rather than failing silently.
//
// The URL is built from window.location.origin, so it is already correct for a
// custom domain, *.pepweb.store, or slug.lvh.me:3100 in dev — see
// lib/storefront/product-link.ts.

import { useEffect, useRef, useState } from "react";
import type { Product } from "../types";
import { productShareUrl } from "@/lib/storefront/product-link";
import { copyText } from "@/lib/storefront/clipboard";

/** How long the "Link copied" confirmation stays up. */
const CONFIRM_MS = 2000;

type ShareState = "idle" | "copied" | "manual";

export function ShareProductButton({
  product,
  storeName,
  variant = "card",
}: {
  product: Product;
  /** Used as the share sheet's title, so the target app shows the store, not a
   *  bare URL. Optional — the product name alone is a fine fallback. */
  storeName?: string;
  /** `card` is the compact icon that rides the product card; `detail` is the
   *  labelled button in the quick-view modal, which has room for words. */
  variant?: "card" | "detail";
}) {
  const [state, setState] = useState<ShareState>("idle");
  // The resolved URL, only needed for the manual fallback panel.
  const [url, setUrl] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending confirmation reset if the card unmounts (filtering the
  // catalog does exactly that) — otherwise setState fires on a dead component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const confirm = (next: ShareState) => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    // The manual panel is dismissed by the user, not by a timer — they need
    // time to select the text.
    if (next === "copied") {
      timer.current = setTimeout(() => setState("idle"), CONFIRM_MS);
    }
  };

  const onShare = async (e: React.MouseEvent) => {
    // The card's media and name open the detail modal. Without this, sharing
    // from the grid would also pop the modal over the confirmation.
    e.preventDefault();
    e.stopPropagation();

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const shareUrl = productShareUrl(origin, product);
    setUrl(shareUrl);

    // Native share sheet first where it exists — it is strictly better than the
    // clipboard on the phones owners actually run their stores from.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: storeName ? `${product.name} · ${storeName}` : product.name,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // AbortError = the user dismissed the sheet on purpose. Falling through
        // to "copied" there would claim we did something they cancelled.
        if (err instanceof Error && err.name === "AbortError") return;
        /* anything else: fall through to the clipboard */
      }
    }

    confirm((await copyText(shareUrl)) ? "copied" : "manual");
  };

  const label = state === "copied" ? "Link copied" : "Copy product link";

  return (
    <span className="sf-share" data-variant={variant}>
      <button
        type="button"
        className="sf-share__btn"
        onClick={onShare}
        data-copied={state === "copied" ? "" : undefined}
        aria-label={label}
        title={label}
      >
        <ShareIcon copied={state === "copied"} />
        {variant === "detail" && (
          <span className="sf-share__label">
            {state === "copied" ? "Link copied" : "Share"}
          </span>
        )}
      </button>

      {/* Announced to screen readers without stealing focus from the button. */}
      <span className="sf-share__live" role="status" aria-live="polite">
        {state === "copied" ? "Product link copied to clipboard" : ""}
      </span>

      {state === "manual" && (
        // Both copy paths refused. Put the link on screen so the owner can still
        // select it by hand — the one thing no browser can block.
        <span className="sf-share__manual" onClick={(e) => e.stopPropagation()}>
          <input
            className="sf-share__manual-input"
            value={url}
            readOnly
            aria-label="Product link — select and copy"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="sf-share__manual-close"
            onClick={() => setState("idle")}
            aria-label="Dismiss link"
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}

/** Link glyph, swapping to a check on success so the state reads at a glance. */
function ShareIcon({ copied }: { copied: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden focusable="false">
      {copied ? (
        <path
          d="M20 6 9 17l-5-5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.4 4.5"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <path
            d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
