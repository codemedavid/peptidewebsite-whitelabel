/**
 * Pure decision core for the visitor-gate heartbeat. No fetch, no DOM, no
 * "server-only" — just the rule that turns one poll of the gate endpoint into an
 * action. Kept separate from the client component (GateHeartbeat.tsx) so the
 * security-critical part is unit-tested in isolation (scripts/test-gate-heartbeat.ts).
 *
 * Why a heartbeat exists: the storefront is a hash-routed client app, so after
 * the first server render an idle visitor never hits middleware or the layout
 * again — a rotated access code (or a disabled gate) wouldn't take effect for
 * them until a hard refresh. The client polls /api/gate/session on activity and
 * boots the visitor when the server confirms the session is no longer valid.
 *
 * The one rule that matters (the original port got this wrong): a 2xx HTML
 * *shell* — what a misrouted request, an auth redirect, or an offline SW returns
 * — must NEVER be read as "authenticated". Treating `response.ok` as proof of a
 * live session lets a broken deploy silently keep gated visitors in. So authed
 * requires an explicit `{ authenticated: true }` JSON literal from our own
 * endpoint; a confirmed `{ authenticated: false }` is the only thing that boots;
 * every ambiguous case is inconclusive (do nothing, retry next tick — no false
 * logouts on a transient blip).
 */

export type HeartbeatOutcome = "authed" | "invalidated" | "inconclusive";

export interface HeartbeatProbe {
  /** HTTP status; null when the fetch itself threw (network error, abort). */
  status: number | null;
  /** The response's Content-Type header (any casing); null if absent/errored. */
  contentType: string | null;
  /** Raw response body text; "" if none/errored. */
  bodyText: string;
}

/**
 * Decide what one heartbeat poll means. Pass `null` when the fetch rejected.
 * The result is advisory-safe: only "invalidated" should cause a reload.
 */
export function interpretHeartbeat(probe: HeartbeatProbe | null): HeartbeatOutcome {
  // Fetch threw / no response → can't conclude anything. Don't boot.
  if (!probe || probe.status === null) return "inconclusive";

  // SPA-fallback guard: the ONLY positive/negative signals come from a genuine
  // JSON body served by our endpoint. Anything not declared application/json
  // (an HTML shell is text/html) is treated as "couldn't verify", never authed.
  const contentType = (probe.contentType ?? "").toLowerCase();
  if (!contentType.includes("application/json")) return "inconclusive";

  let parsed: unknown;
  try {
    parsed = JSON.parse(probe.bodyText);
  } catch {
    // JSON content-type but a body we can't parse (truncated stream, proxy
    // error page mislabeled) → inconclusive.
    return "inconclusive";
  }

  if (typeof parsed !== "object" || parsed === null || !("authenticated" in parsed)) {
    return "inconclusive";
  }

  // Strict boolean check — a truthy string/number is NOT a valid signal.
  const authed = (parsed as { authenticated: unknown }).authenticated;
  if (authed === true) return "authed";
  if (authed === false) return "invalidated";
  return "inconclusive";
}

/**
 * The client boots the visitor to the gate ONLY on a confirmed invalidation.
 * "inconclusive" (transient errors, HTML shells) never logs anyone out, so a
 * flaky network can't lock a valid visitor out of a store they can still reach.
 */
export function shouldReloadForGate(outcome: HeartbeatOutcome): boolean {
  return outcome === "invalidated";
}
