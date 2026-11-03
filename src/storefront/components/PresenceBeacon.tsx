"use client";

// "Live now" heartbeat for the store owner's Live screen in the app. Mounted by
// the storefront layout only for stores whose plan has Sales Analytics. While
// the tab is visible it checks in every 30s and right after the shopper moves
// (opens a product, the cart, checkout); when the tab hides it says goodbye so
// they drop off at once. Anonymous: a random per-browser id, no personal data.
// Best effort — every failure is ignored; it must never affect shopping.

import { useEffect } from "react";
import { HEARTBEAT_MS, webStage } from "@/lib/presence/live";
import { parseProductHash } from "@/lib/storefront/product-link";
import { getPresence, subscribePresence } from "@/storefront/presence";

const ENDPOINT = "/api/presence";
const VISITOR_KEY = "pw.visitor";
// Coalesce a burst of changes (cart add + drawer open) into one beat.
const CHANGE_DEBOUNCE_MS = 1_500;
// Product quick-views set the hash with history.replaceState, which fires no
// event — so the hash is sampled on this cheap timer instead.
const HASH_SAMPLE_MS = 2_000;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function visitorId(): string {
  try {
    const saved = window.localStorage.getItem(VISITOR_KEY);
    if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
    const fresh = randomId();
    window.localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / blocked storage: one id for this page view.
    return randomId();
  }
}

function payload(id: string, leave: boolean): string {
  const p = getPresence();
  const productRef = parseProductHash(window.location.hash);
  return JSON.stringify({
    visitorId: id,
    stage: webStage({ cartOpen: p.cartOpen, checkoutStep: p.checkoutStep, productOpen: !!productRef }),
    productRef,
    cartItems: p.cartItems,
    cartValue: p.cartValue,
    currency: p.currency,
    leave,
  });
}

export function PresenceBeacon() {
  useEffect(() => {
    const id = visitorId();
    let timer: ReturnType<typeof setInterval> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(ENDPOINT, {
        method: "POST",
        body: payload(id, false),
        headers: { "content-type": "application/json" },
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => undefined);
    };
    const leave = () => {
      try {
        navigator.sendBeacon?.(ENDPOINT, payload(id, true));
      } catch {
        /* best effort */
      }
    };
    const start = () => {
      if (timer) clearInterval(timer);
      beat();
      timer = setInterval(beat, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else {
        stop();
        leave();
      }
    };
    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(beat, CHANGE_DEBOUNCE_MS);
    };

    let lastHash = window.location.hash;
    const hashSampler = setInterval(() => {
      if (window.location.hash === lastHash) return;
      lastHash = window.location.hash;
      onChange();
    }, HASH_SAMPLE_MS);

    if (document.visibilityState === "visible") start();
    const unsubscribe = subscribePresence(onChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    return () => {
      stop();
      if (debounce) clearTimeout(debounce);
      clearInterval(hashSampler);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  return null;
}
