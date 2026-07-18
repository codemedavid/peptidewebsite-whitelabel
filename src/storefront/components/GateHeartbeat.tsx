"use client";

// Visitor-gate heartbeat. Mounted by the storefront layout ONLY for a
// gated-but-unlocked visitor. The storefront is a hash-routed client app, so
// after the first render an idle visitor never re-hits middleware or the layout;
// this polls /api/gate/session on activity and, when the server confirms the
// session is no longer valid (code rotated, gate changed), reloads so the layout
// re-renders the access wall. The security decision lives in the unit-tested pure
// core (lib/auth/gate-heartbeat) — this component is just the fetch + events.

import { useEffect, useRef } from "react";
import {
  interpretHeartbeat,
  shouldReloadForGate,
  type HeartbeatProbe,
} from "@/lib/auth/gate-heartbeat";

const ENDPOINT = "/api/gate/session";
// Throttle: coalesce bursts of activity into at most one poll per window. Well
// under the endpoint's intended budget even with an active user.
const MIN_INTERVAL_MS = 30_000;
// Safety net for a focused-but-idle tab: re-check on a slow timer so a rotation
// eventually reaches a visitor who isn't generating pointer/key events.
const IDLE_POLL_MS = 60_000;

async function probeGate(signal: AbortSignal): Promise<HeartbeatProbe | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      bodyText: await res.text(),
    };
  } catch {
    // Aborted or network error → let interpretHeartbeat(null) decide (inconclusive).
    return null;
  }
}

export function GateHeartbeat() {
  const lastRun = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;

    const tick = async () => {
      if (disposed || inFlight.current) return;
      const now = Date.now();
      if (now - lastRun.current < MIN_INTERVAL_MS) return;
      lastRun.current = now;
      inFlight.current = true;
      try {
        const outcome = interpretHeartbeat(await probeGate(controller.signal));
        if (!disposed && shouldReloadForGate(outcome)) {
          window.location.reload();
        }
      } finally {
        inFlight.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onActivity = () => void tick();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onActivity);
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    const idle = window.setInterval(() => {
      if (document.visibilityState === "visible") void tick();
    }, IDLE_POLL_MS);

    // One check on mount catches a session that lapsed while the tab was hidden.
    void tick();

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(idle);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);

  return null;
}
