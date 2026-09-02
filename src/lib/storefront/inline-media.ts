// Inline media must never ride the storefront payload.
//
// `branding.config` is ONE JSON column, and the storefront spreads it wholesale
// into the client `brand` object — so every byte in it is sent to every visitor
// twice: once in the SSR'd HTML, and again in the RSC flight payload that
// hydrates it. Nothing stopped an owner from storing an image there as a
// `data:image/...;base64,` URI, and one tenant had three: a 51,887-char logo
// repeated four times plus two payment QR codes, 359,310 chars in all — 54.5% of
// a 659 KB page. Base64 JPEG is already-compressed binary, so gzip claws none of
// it back; it is pure egress on every single page view.
//
// The rule is SIZE, not encoding. A tiny inline SVG icon is legitimate config
// and costs nothing; a 60 KB data URI is an image that belongs on the CDN
// whatever its mime type says. That is also why a large NON-base64 data URI
// counts: plain-text SVG is just as expensive on the wire.
//
// Pure and immutable, so the same rule can be applied at the tenant-context read
// (the choke point every storefront surface loads branding through), asserted in
// tests, and run against the live database as a migration gate — without any of
// them needing a request, a tenant or a DB.

/** Above this many characters, a `data:` URI is treated as media and dropped.
 *  4 KB: an order of magnitude below any real photo, and roomy enough for the
 *  small inline SVG icons that legitimately live in config. */
export const INLINE_MEDIA_MAX_BYTES = 4096;

/** One oversized `data:` URI found in a blob. */
export type InlineMediaHit = {
  /** Dotted path from the root; array indices are path segments. "" = the root
   *  itself was the URI. */
  path: string;
  /** Length of the URI in characters — what it actually costs on the wire. */
  bytes: number;
  /** The declared mime type ("image/jpeg"), or "" when the URI omits it. */
  mime: string;
};

/** The `data:` scheme, case-insensitively, ignoring leading whitespace. */
const DATA_URI = /^\s*data:/i;

/** Read the mime from `data:<mime>[;param],…`. Empty when the URI omits it. */
function mimeOf(uri: string): string {
  const match = /^\s*data:([^;,]*)/i.exec(uri);
  return (match?.[1] ?? "").trim();
}

/**
 * Is this value an inline media blob big enough to be worth stripping?
 *
 * False for every non-string, every hosted URL, and every small data URI. The
 * threshold is overridable so a caller (or a test) can tighten it without
 * reaching for the internals.
 */
export function isInlineMedia(value: unknown, maxBytes = INLINE_MEDIA_MAX_BYTES): boolean {
  if (typeof value !== "string") return false;
  if (!DATA_URI.test(value)) return false;
  return value.trim().length > maxBytes;
}

/**
 * Every oversized `data:` URI in a JSON-shaped blob, with the path that reaches
 * it. Walks plain objects and arrays; any other value is a leaf. Degenerate
 * input (null, a number, undefined) yields no hits rather than throwing — this
 * runs on untrusted stored config, and a crash here would take out the read path
 * it is meant to protect.
 */
export function findInlineMedia(
  root: unknown,
  maxBytes = INLINE_MEDIA_MAX_BYTES,
): InlineMediaHit[] {
  const hits: InlineMediaHit[] = [];

  const walk = (node: unknown, path: string): void => {
    if (isInlineMedia(node, maxBytes)) {
      const uri = (node as string).trim();
      hits.push({ path, bytes: uri.length, mime: mimeOf(uri) });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, path ? `${path}.${i}` : String(i)));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(root, "");
  return hits;
}

/** Total characters of inline media in a blob — the egress a page pays. */
export function inlineMediaBytes(root: unknown, maxBytes = INLINE_MEDIA_MAX_BYTES): number {
  return findInlineMedia(root, maxBytes).reduce((sum, hit) => sum + hit.bytes, 0);
}

/**
 * A copy of the blob with every oversized `data:` URI blanked to "", plus the
 * list of what was removed.
 *
 * Blanked rather than deleted: the key keeps its place, so a consumer reading
 * `brand.logoUrl` gets an empty string and falls back exactly as it would for a
 * tenant that never set one — whereas a missing key can change how config is
 * merged. The input is never mutated (the stored config object is shared and
 * cached), and a subtree with nothing to strip is returned by reference, so a
 * clean blob costs no copying.
 */
export function stripInlineMedia<T>(
  root: T,
  maxBytes = INLINE_MEDIA_MAX_BYTES,
): { value: T; stripped: InlineMediaHit[] } {
  const stripped = findInlineMedia(root, maxBytes);
  if (stripped.length === 0) return { value: root, stripped };

  const scrub = (node: unknown): unknown => {
    if (isInlineMedia(node, maxBytes)) return "";
    if (Array.isArray(node)) return node.map(scrub);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        out[key] = scrub(child);
      }
      return out;
    }
    return node;
  };

  return { value: scrub(root) as T, stripped };
}
