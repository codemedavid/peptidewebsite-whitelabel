import "server-only";

/**
 * Jev (TypeSafe's decision model) through OpenRouter's Decisions API — the one
 * AI entry point for the platform's automations. Jev doesn't write text: it
 * answers typed questions about a `state` with probabilities.
 *
 *   noul   yes/no → probability of yes (0..1)
 *   choice one of the criteria keys → choice + per-option probabilities
 *
 * Needs OPENROUTER_API_KEY. Never throws: no key, a timeout, a non-2xx or a
 * malformed reply all come back as null so callers can fail open.
 * https://openrouter.ai/docs/guides/community/jev-tutorial
 */

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "typesafe/jev-1.13";
const TIMEOUT_MS = 4000;

/**
 * Instructions and criteria may be plain text or structured JSON — TypeSafe's
 * documented way to give Jev rules and labelled examples (docs.typesafe.ai/primitives/advanced).
 */
export type JevText = string | Record<string, unknown>;

export type JevQuestion =
  | { type: "noul"; instructions: JevText; criteria: { true: JevText; false: JevText } }
  | { type: "choice"; instructions: JevText; criteria: Record<string, JevText> };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export type JevRequest = { state: string | Record<string, unknown>; questions: Record<string, JevQuestion> };

export function jevConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Whether Jev can actually answer — a key being set isn't enough (a revoked
 * key or an empty balance fails every check, and the bot fails open silently).
 *   missing      no OPENROUTER_API_KEY on the server
 *   rejected     OpenRouter refused the key (401/403)
 *   no_credits   the account is out of credit (402, or a spent limit)
 *   unreachable  OpenRouter didn't answer
 */
export type JevHealth = "ok" | "missing" | "rejected" | "no_credits" | "unreachable";

const HEALTH_TTL_MS = 5 * 60_000;
let health: { key: string; value: JevHealth; at: number } | null = null;

function noteHealth(key: string, value: JevHealth): void {
  health = { key, value, at: Date.now() };
}

function healthFromStatus(status: number): JevHealth | null {
  if (status === 401 || status === 403) return "rejected";
  if (status === 402) return "no_credits";
  return null;
}

/** OpenRouter's key endpoint (same host as the decisions endpoint, so tests can fake both). */
function keyEndpoint(): string {
  return new URL("/api/v1/key", endpoint()).toString();
}

/** Checked against OpenRouter at most every 5 minutes; every Jev call also updates it. */
export async function jevHealth(): Promise<JevHealth> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return "missing";
  if (health && health.key === key && Date.now() - health.at < HEALTH_TTL_MS) return health.value;
  try {
    const res = await fetch(keyEndpoint(), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const fromStatus = healthFromStatus(res.status);
    if (fromStatus) {
      noteHealth(key, fromStatus);
    } else if (!res.ok) {
      noteHealth(key, "unreachable");
    } else {
      const body = (await res.json().catch(() => null)) as { data?: { limit_remaining?: number | null } } | null;
      const remaining = body?.data?.limit_remaining;
      noteHealth(key, typeof remaining === "number" && remaining <= 0 ? "no_credits" : "ok");
    }
  } catch {
    noteHealth(key, "unreachable");
  }
  return health!.value;
}

/** Tests point this at a local fake; production always calls OpenRouter. */
function endpoint(): string {
  const override = process.env.JEV_ENDPOINT_OVERRIDE;
  return process.env.NODE_ENV !== "production" && override ? override : ENDPOINT;
}

function parseAnswer(v: unknown): JevAnswer | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (a.type === "noul" && typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1) return { type: "noul", noul: a.noul };
  if (a.type === "choice" && typeof a.choice === "string") {
    const probabilities = a.probabilities && typeof a.probabilities === "object" ? (a.probabilities as Record<string, number>) : {};
    return { type: "choice", choice: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : 0, probabilities };
  }
  return null;
}

/** Ask Jev. Null when Jev isn't configured or didn't answer every question. */
export async function jevDecide(req: JevRequest): Promise<Record<string, JevAnswer> | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(endpoint(), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.JEV_MODEL || DEFAULT_MODEL, state: req.state, questions: req.questions }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[jev] decision failed", res.status);
      const fromStatus = healthFromStatus(res.status);
      if (fromStatus) noteHealth(key, fromStatus);
      return null;
    }
    noteHealth(key, "ok");
    const body = (await res.json()) as { answers?: Record<string, unknown> };
    const out: Record<string, JevAnswer> = {};
    for (const name of Object.keys(req.questions)) {
      const answer = parseAnswer(body.answers?.[name]);
      if (!answer) return null;
      out[name] = answer;
    }
    return out;
  } catch (e) {
    console.warn("[jev] decision unavailable", (e as Error).name);
    return null;
  }
}
