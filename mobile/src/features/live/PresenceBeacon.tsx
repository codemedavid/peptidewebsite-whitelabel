import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { presenceApi } from "@/api/endpoints";
import { useShop } from "@/features/shop/ShopProvider";
import { HEARTBEAT_MS, stageFromPath } from "./stage";

// Coalesce a burst of moves (add to cart → open cart) into one beat.
const CHANGE_DEBOUNCE_MS = 1_500;

/**
 * The customer app's "live now" heartbeat: while the app is in front, it tells
 * the store where this shopper is (browsing, a product, the cart, checkout) —
 * every 30s and right after they move — and says goodbye when the app goes to
 * the background. Renders nothing; every failure is ignored.
 */
export function PresenceBeacon() {
  const pathname = usePathname();
  const { mode, lines } = useShop();
  const enabled = mode === "customer";
  const { stage, productRef } = stageFromPath(pathname);
  const cartItems = lines.reduce((n, l) => n + l.qty, 0);

  const latest = useRef({ stage, productRef, cartItems });
  latest.current = { stage, productRef, cartItems };
  const send = useRef((leave: boolean) => {
    void presenceApi.beat({ ...latest.current, leave }).catch(() => undefined);
  }).current;

  // A move: beat shortly after it settles.
  useEffect(() => {
    if (!enabled || AppState.currentState !== "active") return;
    const id = setTimeout(() => send(false), CHANGE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [enabled, stage, productRef, cartItems, send]);

  // The steady heartbeat, only while the app is in front.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => send(false), HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        send(false);
        start();
      } else {
        stop();
        send(true);
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [enabled, send]);

  return null;
}
