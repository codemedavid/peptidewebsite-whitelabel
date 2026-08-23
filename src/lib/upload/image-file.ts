/**
 * Whether a file a customer picked can be uploaded as proof of payment.
 *
 * `File.type` is a hint, not a fact. The browser fills it from the OS, and
 * several common Android paths — the Files/Documents picker, Messenger and
 * Instagram in-app webviews, some Samsung gallery builds — hand back a
 * perfectly good JPEG with `type === ""` or `"application/octet-stream"`.
 * Gating on `type.startsWith("image/")` alone therefore refuses real receipts
 * and leaves the customer stuck at checkout with no way forward.
 *
 * So: trust a declared image type when there is one, and otherwise fall back to
 * the filename extension. The bytes still go to ImageKit, which rejects
 * anything that isn't really an image — this guard exists to give a fast, clear
 * answer in the browser, not to be the last line of defence.
 *
 * Shared by the checkout handler (client) and `uploadPaymentProofAction`
 * (server) so the two can never disagree about what is uploadable.
 */

export type ProofFileVerdict = { ok: true } | { ok: false; reason: string };

/** Extensions we accept when the reported MIME type is missing or unhelpful. */
const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff",
]);

/**
 * Documents customers genuinely do try to send — GCash, GoTyme and BPI all
 * email PDF receipts. Naming them lets us say "screenshot it instead" rather
 * than the opaque "Unsupported type: application/pdf".
 */
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "pages", "heicdoc"]);

const SCREENSHOT_HINT =
  "We can only read image receipts — please upload a screenshot of your payment instead.";

/** Lowercased extension of `name`, or "" when it has none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Decide whether `name`/`type` describe an uploadable proof-of-payment image.
 * On refusal, `reason` is customer-facing copy that says what to do next.
 */
export function classifyProofFile(name: string, type: string): ProofFileVerdict {
  const mime = (type || "").trim().toLowerCase();
  const ext = extensionOf((name || "").trim());

  // A declared image type is the happy path and settles it on its own.
  if (mime.startsWith("image/")) return { ok: true };

  // A declared non-image type that we recognise: refuse it by name, so the
  // customer is told what to do rather than reading back their own MIME type.
  if (mime === "application/pdf" || DOCUMENT_EXTENSIONS.has(ext)) {
    return { ok: false, reason: SCREENSHOT_HINT };
  }
  if (mime.startsWith("video/")) {
    return { ok: false, reason: SCREENSHOT_HINT };
  }

  // No usable type (empty, or the generic byte-stream fallback): the extension
  // is the only signal left, and it is the one that rescues real screenshots
  // from pickers that decline to name them.
  if (IMAGE_EXTENSIONS.has(ext)) return { ok: true };

  return {
    ok: false,
    reason: mime.startsWith("application/") || mime.startsWith("text/")
      ? SCREENSHOT_HINT
      : "That file doesn't look like an image — please upload a screenshot of your payment.",
  };
}
