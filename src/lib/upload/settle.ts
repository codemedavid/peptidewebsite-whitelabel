/**
 * Client-side guarantee that an upload always settles into a renderable result.
 *
 * A server action that throws (most commonly: Next rejecting the request body
 * for exceeding `bodySizeLimit`) rejects the caller's promise. An `onChange`
 * handler that awaits the action without a try/catch never reaches its
 * `setBusy(false)`, so the form sits on "Uploading…" forever with no error.
 *
 * `settleUpload` converts any throw into the same `{ error }` shape the actions
 * already return on the failure path, so callers have exactly one branch.
 */

export type UploadFailure = { error: string };

/**
 * Next's body-limit rejection surfaces as an opaque framework error that means
 * nothing to a store operator; translate it into the actionable version.
 */
const BODY_LIMIT_THROW = /body exceeded|request entity too large|payload too large|\b413\b/i;

/** Human-readable message for anything an upload action can throw. */
export function uploadErrorMessage(thrown: unknown): string {
  const raw = (thrown instanceof Error ? thrown.message : String(thrown ?? "")).trim();
  if (BODY_LIMIT_THROW.test(raw)) return "File too large — try a smaller image.";
  return raw || "Upload failed. Please try again.";
}

/** Run an upload action, resolving to `{ error }` instead of rejecting. */
export async function settleUpload<T extends object>(
  work: () => Promise<T | UploadFailure>,
): Promise<T | UploadFailure> {
  try {
    return await work();
  } catch (e) {
    return { error: uploadErrorMessage(e) };
  }
}
