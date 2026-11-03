"use client";

// Inside the live-preview <iframe>: the tenant's real StorefrontApp, kept in
// step with the branding editor next door.
//
//   parent → frame  sf-preview:draft        the unsaved config → setTweak
//                   sf-preview:goto         open a page (hash route)
//                   sf-preview:select-mode  "click to edit" on / off
//   frame → parent  sf-preview:ready        mounted, send me the draft
//                   sf-preview:route        the page now showing
//                   sf-preview:select       the region the operator clicked
//
// Draft edits are applied with setTweak (no remount, so the page and scroll
// position survive every keystroke); only a LAYOUT change remounts, because
// the layout decides the storefront's whole chrome. Same-origin messages only
// (readPreviewMessage).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Brand, Product } from "@/storefront/types";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import { useStore } from "@/storefront/store";
import { googleFontsUrl } from "@/lib/theme/tokens";
import { mergePreviewDraft, readPreviewMessage, type PreviewMessage } from "@/lib/admin/preview-draft";

function post(msg: PreviewMessage) {
  window.parent?.postMessage(msg, window.location.origin);
}

/** Editable regions, most specific first. The id of an Intl & Local section
 *  (il-*) IS its region; everything else maps to a named area. */
const REGIONS: { selector: string; region: (el: Element) => string }[] = [
  { selector: "[id^='il-']:not([id^='il-info'])", region: (el) => el.id },
  { selector: ".il-topbar", region: () => "topbar" },
  { selector: ".il-fab", region: () => "fab" },
  { selector: ".il-header, .site-header, .sf-root > header", region: () => "header" },
  { selector: ".il-footer, .site-footer, .sf-root footer", region: () => "footer" },
  { selector: ".hero, .sc-hero, .bq-hero", region: () => "hero" },
  { selector: ".catalog, .categories, [id='catalog']", region: () => "catalog" },
];

function regionOf(target: EventTarget | null): { el: Element; region: string } | null {
  if (!(target instanceof Element)) return null;
  for (const r of REGIONS) {
    const el = target.closest(r.selector);
    if (el) return { el, region: r.region(el) };
  }
  return null;
}

/** Lives inside the StoreProvider: applies drafts, loads fonts, runs select mode. */
function PreviewBridge({ base, onLayout }: { base: Brand; onLayout: (brand: Brand) => void }) {
  const { brand, setTweak } = useStore();
  const [selectMode, setSelectMode] = useState(false);
  const layoutRef = useRef(brand.homeLayout);
  layoutRef.current = brand.homeLayout;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = readPreviewMessage(e, window.location.origin);
      if (!msg) return;
      if (msg.type === "sf-preview:draft") {
        const next = mergePreviewDraft(base, msg.draft, msg.extras);
        if (next.homeLayout !== layoutRef.current) onLayout(next);
        else setTweak(next);
      }
      if (msg.type === "sf-preview:goto") window.location.hash = msg.hash;
      if (msg.type === "sf-preview:select-mode") setSelectMode(msg.on);
    };
    window.addEventListener("message", onMessage);
    const onHash = () => post({ type: "sf-preview:route", hash: window.location.hash.replace(/^#/, "") });
    window.addEventListener("hashchange", onHash);
    post({ type: "sf-preview:ready" });
    onHash();
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("hashchange", onHash);
    };
  }, [base, onLayout, setTweak]);

  // Click to edit: hovering outlines the region, a click names it to the editor
  // instead of following the link.
  useEffect(() => {
    if (!selectMode) return;
    let hovered: Element | null = null;
    const over = (e: PointerEvent) => {
      const hit = regionOf(e.target);
      if (hit?.el === hovered) return;
      hovered?.classList.remove("sfp-hover");
      hovered = hit?.el ?? null;
      hovered?.classList.add("sfp-hover");
    };
    const click = (e: MouseEvent) => {
      const hit = regionOf(e.target);
      e.preventDefault();
      e.stopPropagation();
      if (hit) post({ type: "sf-preview:select", region: hit.region });
    };
    document.documentElement.classList.add("sfp-select");
    document.addEventListener("pointerover", over, true);
    document.addEventListener("click", click, true);
    return () => {
      hovered?.classList.remove("sfp-hover");
      document.documentElement.classList.remove("sfp-select");
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("click", click, true);
    };
  }, [selectMode]);

  const fonts = [brand.headingFont, brand.bodyFont, brand.buttonFont, brand.priceFont].filter(Boolean) as string[];
  return (
    <>
      {fonts.length > 0 && <link rel="stylesheet" href={googleFontsUrl(...fonts)} />}
      <style>{`
        .sfp-select, .sfp-select * { cursor: crosshair !important; }
        .sfp-hover { outline: 3px solid #7c3aed !important; outline-offset: -3px; box-shadow: 0 0 0 9999px rgba(124, 58, 237, 0.06) inset !important; }
      `}</style>
    </>
  );
}

export function PreviewFrame({ base, products, tenantKey }: { base: Brand; products: Product[]; tenantKey: string }) {
  // The Brand the storefront MOUNTS with; replaced (and the app remounted)
  // only when the draft switches layout. Every other edit goes through setTweak.
  const [mounted, setMounted] = useState<Brand>(() => mergePreviewDraft(base, {}));
  const onLayout = useCallback((brand: Brand) => setMounted(brand), []);
  return (
    <StorefrontApp key={mounted.homeLayout ?? "classic"} brand={mounted} products={products} tenantKey={tenantKey}>
      <PreviewBridge base={base} onLayout={onLayout} />
    </StorefrontApp>
  );
}
