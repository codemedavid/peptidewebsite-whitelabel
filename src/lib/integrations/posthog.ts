// PostHog capture over plain HTTPS (no SDK, no batching) — one fetch per event.
//
// We POST to the project's /capture/ endpoint with the tenant's OWN project API
// key, so every tenant's events land in their OWN PostHog project. Person identity
// rides along as `$set` inside properties, which is what PostHog Messaging targets
// when it emails the customer. A single stateless POST (vs posthog-node's batched
// client) is the right fit for serverless `after()` work: nothing to flush, nothing
// to leak across requests.

import type { CapturePayload } from "@/lib/analytics/events";

export const POSTHOG_DEFAULT_HOST = process.env.POSTHOG_DEFAULT_HOST || "https://us.i.posthog.com";

/** Normalize a host: trim, strip trailing slash, default to US cloud. */
export function normalizeHost(host?: string | null): string {
  const h = (host ?? "").trim().replace(/\/+$/, "");
  return h || POSTHOG_DEFAULT_HOST;
}

export interface PostHogTarget {
  projectApiKey: string;
  host?: string;
}

/**
 * Send one event to a tenant's PostHog project. Throws on a network error or a
 * non-2xx response, so callers (capture layer, health check) can decide whether
 * to swallow or surface it. `timestamp` is an ISO-8601 string the caller can pass
 * for accuracy; PostHog stamps server time otherwise.
 */
export async function postHogCapture(
  target: PostHogTarget,
  payload: CapturePayload,
  timestamp?: string,
): Promise<void> {
  const properties: Record<string, unknown> = { ...payload.properties };
  if (payload.personProperties) properties.$set = payload.personProperties;

  const res = await fetch(`${normalizeHost(target.host)}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: target.projectApiKey,
      event: payload.event,
      distinct_id: payload.distinctId,
      properties,
      ...(timestamp ? { timestamp } : {}),
    }),
    // Never let a slow/hung PostHog ingest stall the request that spawned it.
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`PostHog capture failed: HTTP ${res.status}`);
  }
}

/**
 * Liveness probe for "Test connection" in the admin. A project API key is
 * ingest-only (it cannot read), so a SUCCESSFUL capture is the health signal.
 * Sends a throwaway event under a fixed distinctId.
 */
export async function postHogHealthCheck(target: PostHogTarget): Promise<boolean> {
  try {
    await postHogCapture(target, {
      event: "order_placed", // any valid event; this is a connectivity probe
      distinctId: "integration-health-check",
      properties: { $process_person_profile: false, source: "admin_test_connection" },
    });
    return true;
  } catch {
    return false;
  }
}
