import { api, apiUpload, type UploadFile } from "@/api/client";

/**
 * The app's door to the WEBSITE's store-admin actions (server:
 * src/app/api/mobile/v1/admin/). The server authenticates this phone, then runs
 * the website's own server action as this user — same validation, same staff
 * permissions, same trial locks. The app never re-implements a save rule.
 *
 * `fn` must be on the server allowlist (src/lib/mobile/admin-bridge.ts). Results
 * come back exactly as the website action returns them, e.g. `{ ok: true }` or
 * `{ error: "…" }` — use `unwrap` to turn `{ error }` into a thrown Error.
 */

/** Everything the website admin reads from its `brand` prop, built server-side. */
export type AdminBrand = Record<string, unknown>;

export type AdminMenuItem = {
  view: string;
  label: string;
  hint: string;
  group: "daily" | "weekly" | "occasional";
  locked: boolean;
  isNew: boolean;
};

export type AdminMenuResponse = {
  groups: { id: string; label: string; items: AdminMenuItem[] }[];
};

export const adminBridge = {
  /** The same Brand projection the website admin renders from. */
  brand: () => api<{ brand: AdminBrand }>("/admin/brand"),
  /** The website admin menu for THIS user (visibility + grants + locks applied). */
  menu: () => api<AdminMenuResponse>("/admin/menu"),
  /** Run one allowlisted website action with positional args. */
  call: <T = unknown>(fn: string, ...args: unknown[]) =>
    api<T>("/admin/call", { method: "POST", body: { fn, args }, retryable: false }),
  /** Run an allowlisted FormData action (image uploads). The file goes in `field`. */
  upload: <T = unknown>(fn: string, field: string, file: UploadFile, signal?: AbortSignal) =>
    apiUpload<T>(`/admin/upload/${encodeURIComponent(fn)}?field=${encodeURIComponent(field)}`, field, file, signal),
};

/** Website actions answer `{ error }` on a rule failure — surface it as a thrown Error. */
export function unwrap<T>(result: T): Exclude<T, { error: string }> {
  if (result && typeof result === "object" && "error" in result && typeof (result as { error: unknown }).error === "string") {
    throw new Error((result as { error: string }).error);
  }
  return result as Exclude<T, { error: string }>;
}
