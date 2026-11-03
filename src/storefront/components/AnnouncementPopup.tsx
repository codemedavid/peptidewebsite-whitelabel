"use client";

// Storefront Announcement Pop-up — the owner's own news / new-drop / promo pop-up
// (store admin → Announcement Pop-up). Rules live in the pure core
// (lib/storefront/announcement-popup); this file only renders and remembers.
//
// The card is themed entirely from the tenant's --brand-* tokens (see
// announcement-popup.css), so every store's palette and fonts flow in with no
// stored colours. <AnnouncementPopupCard> is shared with the editor's live
// preview, so what the owner previews is exactly what shoppers see.
//
// "Once" pop-ups remember the closed version in localStorage; "every visit"
// pop-ups remember only the tab session. Storage can throw (private mode,
// blocked site data) — every access is guarded and the pop-up still works.

import { useEffect, useRef, useState } from "react";
import type { Brand, Product } from "../types";
import {
  KIND_META,
  localDateKey,
  parseSeenVersions,
  rememberSeen,
  shouldShowPopup,
  type StoredPopup,
} from "@/lib/storefront/announcement-popup";
import { productHash } from "@/lib/storefront/product-link";
import { imageUrl } from "@/lib/media/image-url";

const SEEN_KEY = "sf_popup_seen_v1";
const VISIT_KEY = "sf_popup_visit_v1";
const CARD_IMAGE_WIDTH = 720;
const COPIED_RESET_MS = 1800;

function readSeen(): string[] {
  try {
    return parseSeenVersions(window.localStorage.getItem(SEEN_KEY));
  } catch {
    return [];
  }
}

function shownThisVisit(version: string): boolean {
  try {
    return window.sessionStorage.getItem(VISIT_KEY) === version;
  } catch {
    return false;
  }
}

function markClosed(version: string): void {
  try {
    window.sessionStorage.setItem(VISIT_KEY, version);
  } catch {
    // Storage blocked — the pop-up simply returns on the next visit.
  }
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(rememberSeen(readSeen(), version)));
  } catch {
    // Same: worst case a "once" pop-up shows again.
  }
}

type CardProps = {
  popup: StoredPopup;
  /** Product photo used when the owner linked a product but uploaded no image. */
  fallbackImage?: string | null;
  onPrimary: () => void;
  onClose: () => void;
  primaryRef?: React.Ref<HTMLButtonElement>;
};

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard refused (insecure context / permissions): the code stays
      // visible and selectable, which is all the shopper needs.
    }
  };

  return (
    <button type="button" className="sf-popup__code" onClick={copy} aria-label={`Copy code ${code}`}>
      <span className="sf-popup__code-label">Use code</span>
      <span className="sf-popup__code-value">{code}</span>
      <span className="sf-popup__code-action" aria-live="polite">{copied ? "Copied!" : "Copy"}</span>
    </button>
  );
}

export function AnnouncementPopupCard({ popup, fallbackImage, onPrimary, onClose, primaryRef }: CardProps) {
  const meta = KIND_META[popup.kind];
  const src = popup.image?.url ?? fallbackImage ?? "";
  const aspect = popup.image?.aspect ?? 1;
  const layout = src ? popup.layout : "stacked";
  const buttonLabel = popup.buttonLabel || meta.defaultButton;

  return (
    <div
      className={`sf-popup sf-popup--${layout}${src ? " has-image" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sf-popup-title"
      style={{ "--sf-popup-aspect": String(aspect) } as React.CSSProperties}
    >
      <button type="button" className="sf-popup__close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      {src && (
        <div className="sf-popup__media">
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageKit sizing via imageUrl() */}
          <img src={imageUrl(src, { width: CARD_IMAGE_WIDTH })} alt="" decoding="async" />
        </div>
      )}

      <div className="sf-popup__body">
        <span className={`sf-popup__badge sf-popup__badge--${popup.kind}`}>{meta.badge}</span>
        {popup.title && (
          <h2 className="sf-popup__title" id="sf-popup-title">
            {popup.title}
          </h2>
        )}
        {popup.message && <p className="sf-popup__message">{popup.message}</p>}
        {popup.code && <CodeChip code={popup.code} />}

        <div className="sf-popup__actions">
          <button ref={primaryRef} type="button" className="sf-popup__primary" onClick={onPrimary}>
            {buttonLabel}
          </button>
          {popup.action !== "close" && (
            <button type="button" className="sf-popup__later" onClick={onClose}>
              Maybe later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type PopupProps = {
  brand: Brand;
  products: Product[];
  /** Held while another dialog (the Notice Modal) is still open. */
  blocked: boolean;
  onRoute: (route: string) => void;
};

/**
 * The live pop-up mounted in the storefront shell. Never renders during SSR
 * (mounted flag), waits for the owner's delay and for any notice to close, then
 * shows once per the frequency rule. Esc / × / "Maybe later" close it.
 */
export function AnnouncementPopup({ brand, products, blocked, onRoute }: PopupProps) {
  const popup = brand.announcementPopup;
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Decide once per page load, after the owner's delay.
  useEffect(() => {
    if (!popup || blocked || ready) return;
    const eligible = shouldShowPopup(
      popup,
      { seenVersions: readSeen(), shownThisVisit: shownThisVisit(popup.version) },
      localDateKey(new Date()),
    );
    if (!eligible) return;
    const t = window.setTimeout(() => {
      setReady(true);
      setOpen(true);
    }, popup.delaySeconds * 1000);
    return () => window.clearTimeout(t);
  }, [popup, blocked, ready]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // close is stable for the open lifetime; re-binding on every render is noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !popup) return null;

  const product = popup.action === "product" ? products.find((p) => p.id === popup.productId) : undefined;

  function close() {
    if (popup) markClosed(popup.version);
    setOpen(false);
  }

  function primary() {
    if (!popup) return;
    close();
    if (popup.action === "page") onRoute(popup.linkPage);
    else if (popup.action === "link") window.open(popup.linkUrl, "_blank", "noopener,noreferrer");
    else if (popup.action === "product") {
      // A product removed since the pop-up was saved falls back to the shop.
      if (product) window.location.hash = productHash(product);
      else onRoute("catalog");
    }
  }

  return (
    <div
      className="sf-popup-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <AnnouncementPopupCard
        popup={popup}
        fallbackImage={product?.image}
        onPrimary={primary}
        onClose={close}
        primaryRef={primaryRef}
      />
    </div>
  );
}
