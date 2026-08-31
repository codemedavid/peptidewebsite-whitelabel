// Inline media never rides the storefront payload — RED/GREEN gate
// (npm run test:inline-media).
//
// WHY THIS EXISTS
// ---------------
// `branding.config` is one JSON column that is spread wholesale into the client
// `brand` object (see (storefront)/page.tsx), so every byte in it is sent to
// every visitor, twice — once in the SSR'd HTML and once again in the RSC flight
// payload that hydrates it. Nothing stopped an image from being stored there as
// a `data:image/...;base64,` URI, and one tenant had three:
//
//   peppertones home page: 659,417 B uncompressed / 284,784 B gzipped,
//   of which 359,310 chars (54.5%) were 3 inline JPEGs — a 51,887-char logo
//   repeated 4× plus two payment QR codes. The next-largest store's page was
//   50,906 B gzipped. Base64 JPEG is already-compressed binary, so gzip cannot
//   claw any of it back: it is ~270 KB of pure egress on every single page view.
//
// The fix is two-layered, and this gate covers both:
//
//   1. A pure size rule (src/lib/storefront/inline-media.ts) that can find and
//      strip oversized `data:` URIs anywhere in a JSON blob.
//   2. That rule applied at the tenant-context read (src/lib/tenant/context.ts),
//      the single choke point every storefront surface loads branding through —
//      so no tenant can ship inline image bytes to a browser regardless of which
//      of the ~20 branding writers put them there.
//
// Journeys:
//  1. As a shopper on mobile data, I want the store page to be a page and not a
//     hidden image download, so it opens quickly and cheaply.
//  2. As the platform owner, I want a store's config blob to never carry raw
//     image bytes, so one misconfigured tenant cannot burn the bandwidth budget.
//  3. As a store owner, I want small inline assets (a tiny SVG icon) to keep
//     working, so the guard trims waste and not legitimate config.
//
// Pure by default. Pass --db to additionally assert the LIVE database carries no
// oversized inline media (the migration gate; needs DATABASE_URL + network).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INLINE_MEDIA_MAX_BYTES,
  isInlineMedia,
  findInlineMedia,
  inlineMediaBytes,
  stripInlineMedia,
} from "../src/lib/storefront/inline-media";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/** A `data:` URI of exactly `bytes` total length. */
const dataUri = (bytes: number, mime = "image/jpeg") => {
  const head = `data:${mime};base64,`;
  return head + "A".repeat(Math.max(0, bytes - head.length));
};

const BIG = dataUri(60_000);
const SMALL = dataUri(300, "image/svg+xml");

console.log("threshold — a real image is over it, a tiny inline icon is under it");
{
  check("INLINE_MEDIA_MAX_BYTES is a positive number", typeof INLINE_MEDIA_MAX_BYTES === "number" && INLINE_MEDIA_MAX_BYTES > 0, INLINE_MEDIA_MAX_BYTES);
  check("threshold is small enough to catch a photo", INLINE_MEDIA_MAX_BYTES < 10_000, INLINE_MEDIA_MAX_BYTES);
  check("threshold leaves room for a tiny icon", INLINE_MEDIA_MAX_BYTES >= 1024, INLINE_MEDIA_MAX_BYTES);
}

console.log("isInlineMedia — size is the rule, not the encoding");
{
  check("60 KB base64 jpeg → inline media", isInlineMedia(BIG) === true);
  check("300 B svg data URI → not inline media", isInlineMedia(SMALL) === false);
  check("https URL → never inline media", isInlineMedia("https://ik.imagekit.io/x/logo.png") === false);
  check("empty string → false", isInlineMedia("") === false);
  check("non-string → false", isInlineMedia(12345) === false);
  check("leading whitespace still detected", isInlineMedia(`  ${BIG}`) === true);
  check("uppercase DATA: scheme detected", isInlineMedia(BIG.replace(/^data:/, "DATA:")) === true);
  // A large NON-base64 data URI is just as expensive on the wire.
  check("large plain-text svg data URI → inline media", isInlineMedia("data:image/svg+xml," + "x".repeat(9000)) === true);
  check("explicit maxBytes override respected", isInlineMedia(SMALL, 100) === true);
}

console.log("findInlineMedia — reports every hit with its path, size and mime");
{
  const config = {
    name: "Peppertones",
    logoUrl: BIG,
    smallIcon: SMALL,
    hosted: "https://ik.imagekit.io/x/logo.png",
    paymentMethods: [
      { name: "GCash", qrImage: dataUri(70_000) },
      { name: "Maya", qrImage: "https://ik.imagekit.io/x/qr.png" },
    ],
    nested: { deep: { photo: dataUri(80_000, "image/png") } },
  };

  const hits = findInlineMedia(config);
  check("finds exactly the 3 oversized URIs", hits.length === 3, hits.map((h) => h.path));
  const paths = hits.map((h) => h.path).sort();
  check("paths are dotted, arrays indexed", JSON.stringify(paths) === JSON.stringify(["logoUrl", "nested.deep.photo", "paymentMethods.0.qrImage"]), paths);
  const logo = hits.find((h) => h.path === "logoUrl");
  check("hit carries its byte size", logo?.bytes === BIG.length, logo?.bytes);
  check("hit carries its mime type", logo?.mime === "image/jpeg", logo?.mime);
  check("png mime read from the URI", hits.find((h) => h.path === "nested.deep.photo")?.mime === "image/png");
  check("small icon is not reported", !hits.some((h) => h.path === "smallIcon"));
  check("hosted URL is not reported", !hits.some((h) => h.path === "hosted"));

  check("inlineMediaBytes sums every hit", inlineMediaBytes(config) === hits.reduce((a, h) => a + h.bytes, 0), inlineMediaBytes(config));
  check("clean config → 0 bytes", inlineMediaBytes({ a: 1, b: "https://x/y.png", c: [SMALL] }) === 0);
}

console.log("findInlineMedia — degenerate inputs never throw");
{
  check("null → []", findInlineMedia(null).length === 0);
  check("undefined → []", findInlineMedia(undefined).length === 0);
  check("number → []", findInlineMedia(42).length === 0);
  check("bare string that IS media → one hit at the root path", findInlineMedia(BIG).length === 1 && findInlineMedia(BIG)[0].path === "");
  check("array root indexes from the top", JSON.stringify(findInlineMedia([BIG]).map((h) => h.path)) === JSON.stringify(["0"]));
}

console.log("stripInlineMedia — blanks the bytes, keeps the shape, never mutates");
{
  const config = {
    name: "Peppertones",
    logoUrl: BIG,
    smallIcon: SMALL,
    showHero: true,
    paymentMethods: [
      { name: "GCash", number: "0917", qrImage: dataUri(70_000) },
      { name: "Maya", number: "0918", qrImage: "https://ik.imagekit.io/x/qr.png" },
    ],
  };
  const before = JSON.stringify(config);
  const { value, stripped } = stripInlineMedia(config);

  check("reports what it removed", stripped.length === 2, stripped.map((h) => h.path));
  check("input is NOT mutated", JSON.stringify(config) === before);
  check("oversized logo blanked", value.logoUrl === "");
  check("oversized qr blanked", value.paymentMethods[0].qrImage === "");
  check("hosted qr untouched", value.paymentMethods[1].qrImage === "https://ik.imagekit.io/x/qr.png");
  check("small icon untouched", value.smallIcon === SMALL);
  check("unrelated scalars untouched", value.name === "Peppertones" && value.showHero === true);
  check("array shape preserved", Array.isArray(value.paymentMethods) && value.paymentMethods.length === 2);
  check("result carries no inline media left", inlineMediaBytes(value) === 0);
  check("clean input returns an equal value and no hits", (() => {
    const clean = { a: 1, b: [{ c: "https://x/y.png" }] };
    const out = stripInlineMedia(clean);
    return out.stripped.length === 0 && JSON.stringify(out.value) === JSON.stringify(clean);
  })());
  check("null passes straight through", stripInlineMedia(null).value === null);
}

console.log("wiring — the tenant-context read is where branding is disarmed");
{
  const ctx = read("src/lib/tenant/context.ts");
  check("context imports the guard", /from "@\/lib\/storefront\/inline-media"/.test(ctx), ctx.match(/import[^;]*inline-media[^;]*/)?.[0]);
  check("context strips inline media", /stripInlineMedia\(/.test(ctx));
  // The strip must happen INSIDE the cached loader, so the cost is paid once per
  // TTL and the Next data-cache entry itself stays small.
  const loader = ctx.match(/const loadTenant[\s\S]*?\n  \)\(\);/)?.[0] ?? "";
  check("strip runs inside the cached loadTenant", /stripInlineMedia\(/.test(loader), loader.slice(0, 200));
}

// ── Live-data gate (opt-in) ─────────────────────────────────────────────────
// The pure rule above stops NEW inline media from reaching a browser, but the
// bytes are still sitting in Postgres, where they are read on every cache miss.
// `--db` asserts the migration actually landed.
async function dbGate() {
  console.log("live data — no tenant stores oversized inline media");
  const { PrismaClient } = await import("@prisma/client");
  await import("dotenv/config");
  const db = new PrismaClient();
  try {
    const rows = await db.branding.findMany({
      select: { tenantId: true, config: true, logoUrl: true },
    });
    const offenders = rows
      .map((r) => ({
        tenantId: r.tenantId,
        hits: [...findInlineMedia(r.config), ...findInlineMedia(r.logoUrl)],
      }))
      .filter((r) => r.hits.length > 0);
    check(
      "no branding row carries oversized inline media",
      offenders.length === 0,
      offenders.map((o) => `${o.tenantId}: ${o.hits.map((h) => `${h.path}(${h.bytes}B)`).join(", ")}`),
    );
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  if (process.argv.includes("--db")) await dbGate();
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll inline-media checks passed");
}
main();
