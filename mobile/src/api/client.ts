import type { ApiErrorCode, ApiResponse } from "@contract";
import { File } from "expo-file-system";
import { API_BASE_URL } from "@/config";

/**
 * The one HTTP door to /api/mobile/v1. Adds the bearer token, refreshes it once
 * (single-flight, owned by the session) on "unauthenticated", signs out only
 * when the session is really gone, and turns every failure into an ApiError
 * whose `message` is safe to show a store owner.
 */

export type ClientErrorCode = ApiErrorCode | "network" | "timeout" | "aborted";

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    /** Extra fields from the server error (e.g. `current` on a 409). */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type RefreshOutcome = "ok" | "rejected" | "offline";

export type AuthBridge = {
  accessToken: () => string | null;
  /** When the current access token expires (epoch ms), or null when unknown. */
  accessExpiresAt: () => number | null;
  /**
   * Refresh the token pair. "rejected" = the session is gone (sign out);
   * "offline" = the server couldn't be reached (keep the session).
   * `usedToken` lets the session skip a rotation another request already did.
   */
  refresh: (usedToken: string | null) => Promise<RefreshOutcome>;
  /** The session can't continue (revoked, store unavailable…) — sign out. */
  signOut: (message: string) => void;
};

let bridge: AuthBridge | null = null;
export function connectAuth(b: AuthBridge | null): void {
  bridge = b;
}

const TIMEOUT_MS = 20_000;
/** Refresh this long before the access token's stated expiry (clock skew, transit). */
const EXPIRY_SKEW_MS = 30_000;
const SIGN_OUT_CODES = new Set<ClientErrorCode>(["session_revoked", "store_unavailable"]);
/**
 * fetch() only says "it failed": no signal, a DNS block, a TLS error and (on
 * the web build) a CORS block all look identical from here. The real server
 * being down shows up as a 5xx instead (see parse), so don't blame it here.
 */
const OFFLINE = new ApiError("network", "Couldn't connect. Check your internet connection and try again.", 0);
/** Gateway answers (proxy/tunnel up, app behind it down) — HTML, not our JSON. */
const GATEWAY_STATUSES = new Set([502, 503, 504, 530]);

type Options = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  token?: string;
  /** Safe to send twice (GETs always are). */
  retryable?: boolean;
  /** Multipart upload instead of JSON (see apiUpload). */
  form?: FormData;
  timeoutMs?: number;
  /** Cancels the request (e.g. an upload when its screen closes). */
  signal?: AbortSignal;
};

/**
 * A request that fails instantly usually went out on a pooled keep-alive
 * connection the server had already closed (Node drops idle ones after ~5s).
 * The OS retries GETs on a fresh connection by itself but never POSTs, so an
 * owner who pauses on a screen — e.g. picking a store — got "Can't reach your
 * store". One immediate retry on a new connection covers it.
 */
async function send(path: string, opts: Options, token: string | null): Promise<Response> {
  const retryable = opts.retryable ?? (opts.method ?? "GET") === "GET";
  try {
    return await sendOnce(path, opts, token);
  } catch (e) {
    if (!retryable || !(e instanceof ApiError) || e.code !== "network") throw e;
    return sendOnce(path, opts, token);
  }
}

async function sendOnce(path: string, opts: Options, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  const cancel = () => controller.abort();
  if (opts.signal?.aborted) controller.abort();
  opts.signal?.addEventListener("abort", cancel);
  try {
    return await fetch(`${API_BASE_URL}/api/mobile/v1${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        // Multipart: the runtime sets Content-Type with the boundary itself.
        ...(opts.body !== undefined && !opts.form ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: controller.signal,
    });
  } catch (cause) {
    if (opts.signal?.aborted) throw new ApiError("aborted", "Cancelled.", 0);
    if (controller.signal.aborted) {
      throw new ApiError("timeout", "The server is taking too long to answer. Please try again.", 0);
    }
    if (__DEV__) console.warn(`[api] ${opts.method ?? "GET"} ${API_BASE_URL}/api/mobile/v1${path} failed:`, cause);
    throw OFFLINE;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", cancel);
  }
}

async function parse<T>(res: Response): Promise<T> {
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    // fall through to the generic error below
  }
  if (json?.ok) return json.data;
  const err = json && !json.ok ? json.error : null;
  if (!err && GATEWAY_STATUSES.has(res.status)) {
    throw new ApiError("server_error", "The store server is unavailable right now. Please try again in a moment.", res.status);
  }
  if (!err) throw new ApiError("server_error", `Something went wrong (error ${res.status}). Please try again.`, res.status);
  const { code, message, ...details } = err as { code: ApiErrorCode; message: string } & Record<string, unknown>;
  throw new ApiError(code, message, res.status, details);
}

/**
 * The access token to send. One that has already expired (the app was in the
 * background past its 15 minutes) is refreshed FIRST: sending it would only
 * earn a 401, then a refresh, then a resend — three slow round trips on every
 * screen the app wakes up on, instead of two. A refresh that fails here falls
 * through to the normal 401 path below, which decides offline vs signed out.
 */
async function currentToken(): Promise<string | null> {
  const token = bridge?.accessToken() ?? null;
  const expiresAt = bridge?.accessExpiresAt() ?? null;
  if (!bridge || !token || expiresAt === null || expiresAt - EXPIRY_SKEW_MS > Date.now()) return token;
  return (await bridge.refresh(token)) === "ok" ? bridge.accessToken() : token;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  const token = opts.token ?? (useAuth ? await currentToken() : null);
  try {
    return await parse<T>(await send(path, opts, token));
  } catch (e) {
    if (!(e instanceof ApiError) || !useAuth || !bridge) throw e;
    if (e.code === "unauthenticated") {
      const outcome = await bridge.refresh(token);
      if (outcome === "ok") return parse<T>(await send(path, opts, bridge.accessToken()));
      if (outcome === "offline") throw OFFLINE;
      bridge.signOut("Your session ended. Please sign in again.");
      throw e;
    }
    if (SIGN_OUT_CODES.has(e.code)) bridge.signOut(e.message);
    throw e;
  }
}

const UPLOAD_TIMEOUT_MS = 120_000;

/** A local file for a multipart field (React Native's FormData file shape). */
export type UploadFile = { uri: string; name: string; type: string };

/**
 * POST one file as multipart/form-data through the same auth + refresh path
 * as `api`. Never retried automatically (a POST), with a longer timeout.
 */
export async function apiUpload<T>(path: string, field: string, file: UploadFile, signal?: AbortSignal): Promise<T> {
  // Expo's global fetch (expo/fetch) can't send React Native's { uri } file
  // part — it throws before the request leaves the phone, which surfaced as
  // "Can't reach the server". It serializes a part with name/type + bytes().
  let bytes: Uint8Array;
  try {
    bytes = await new File(file.uri).bytes();
  } catch {
    throw new ApiError("invalid_input", "Couldn't read that photo. Please try another one.", 0);
  }
  const form = new FormData();
  form.append(field, { name: file.name, type: file.type, bytes: async () => bytes } as unknown as Blob);
  return api<T>(path, { method: "POST", form, timeoutMs: UPLOAD_TIMEOUT_MS, signal });
}

/**
 * POST one file as multipart/form-data straight to another host (a media
 * host's signed upload — no session headers), with `fields` alongside it.
 * Large videos go this way because an API request can't carry them.
 */
export async function uploadDirect<T>(endpoint: string, fields: Record<string, string>, file: UploadFile, signal?: AbortSignal): Promise<T> {
  let bytes: Uint8Array;
  try {
    bytes = await new File(file.uri).bytes();
  } catch {
    throw new ApiError("invalid_input", "Couldn't read that video. Please try another one.", 0);
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", { name: file.name, type: file.type, bytes: async () => bytes } as unknown as Blob);
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), UPLOAD_TIMEOUT_MS * 3);
  signal?.addEventListener("abort", () => timer.abort());
  try {
    const res = await fetch(endpoint, { method: "POST", body: form, signal: timer.signal });
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok || !json) throw new ApiError("invalid_input", json?.message ? `Upload failed: ${json.message}` : "The video didn't upload. Try again.", res.status);
    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new ApiError("aborted", "Cancelled.", 0);
    throw new ApiError("network", "The video didn't upload. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timeout);
  }
}
