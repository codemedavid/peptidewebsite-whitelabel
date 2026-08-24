// Storefront image optimization — RED/GREEN gate (npm run test:image-optimization).
//
// Symptom: the customer-facing storefront was slow and images took seconds to
// appear. Cause: every storefront image is a raw <img src={imagekitUrl}> with
// NO ImageKit transformation, so ImageKit serves the ORIGINAL upload — a
// 2000x2000 phone photo painted into a 300px product-card slot. A 20-product
// catalog shipped tens of MB of image bytes. next.config.ts already declares
// avif/webp + a remotePattern for ik.imagekit.io, but nothing used next/image,
// so that config was dead weight.
//
// Fix: a pure URL layer (src/lib/media/image-url.ts) that appends ImageKit's
// `tr=` transformation to ImageKit-hosted URLs only — resized to the slot,
// quality-capped, and `f-auto` so the edge negotiates AVIF/WebP per browser.
// Non-ImageKit sources (data:, blob:, relative, foreign hosts) MUST pass
// through untouched: admin previews and legacy/external art still have to render.
//
// Journeys:
//  1. As a shopper on a phone, I want product images sized for my screen, so the
//     catalog paints in a moment instead of downloading desktop-sized originals.
//  2. As a shopper, I want the hero to appear immediately and below-the-fold art
//     to load lazily, so the first screen is not blocked by images I can't see.
//  3. As a store owner previewing an upload, I want my local preview to still
//     render, so optimization never breaks the admin.
//  4. As a developer, I want the transform to be idempotent and query-safe, so
//     re-wrapping a URL can't corrupt it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isImageKitUrl,
  imageUrl,
  imageSrcSet,
  CARD_SIZES,
  CARD_WIDTHS,
} from "../src/lib/media/image-url";

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

const IK = "https://ik.imagekit.io/x/tenant/acme/vial.png";

console.log("isImageKitUrl — only ImageKit-hosted URLs are transformable");
check("ImageKit URL is transformable", isImageKitUrl(IK) === true);
check("foreign https host is not", isImageKitUrl("https://cdn.example.com/a.png") === false);
check("data: URI is not", isImageKitUrl("data:image/png;base64,AAAA") === false);
check("blob: URI is not", isImageKitUrl("blob:http://localhost/abc") === false);
check("relative path is not", isImageKitUrl("/logo.png") === false);
check("empty string is not", isImageKitUrl("") === false);

console.log("imageUrl — resizes ImageKit sources to the slot they render into");
const carded = imageUrl(IK, { width: 600 });
check("appends a tr= transformation", carded.includes("tr="), carded);
check("carries the requested width", /(^|[?&,])w-600(,|$|&)/.test(carded), carded);
check("negotiates a modern format (f-auto)", carded.includes("f-auto"), carded);
check("caps quality rather than shipping source quality", /q-\d+/.test(carded), carded);
check("keeps the original path", carded.startsWith(IK), carded);

console.log("imageUrl — never corrupts a source it does not own");
check("foreign host passes through", imageUrl("https://cdn.example.com/a.png", { width: 600 }) === "https://cdn.example.com/a.png");
check("data: passes through", imageUrl("data:image/png;base64,AAAA", { width: 600 }) === "data:image/png;base64,AAAA");
check("blob: passes through", imageUrl("blob:http://localhost/abc", { width: 600 }) === "blob:http://localhost/abc");
check("relative passes through", imageUrl("/logo.png", { width: 600 }) === "/logo.png");
check("empty passes through", imageUrl("", { width: 600 }) === "");
check("undefined-ish never becomes a string", imageUrl(undefined as unknown as string, { width: 600 }) === undefined as unknown as string || imageUrl(undefined as unknown as string, { width: 600 }) === "");

console.log("imageUrl — query-safe and idempotent");
const withQuery = imageUrl("https://ik.imagekit.io/x/a.png?v=2", { width: 400 });
check("preserves an existing query param", withQuery.includes("v=2"), withQuery);
check("does not emit a second '?'", (withQuery.match(/\?/g) ?? []).length === 1, withQuery);
const twice = imageUrl(imageUrl(IK, { width: 600 }), { width: 600 });
check("re-wrapping does not stack transforms", (twice.match(/tr=/g) ?? []).length === 1, twice);

console.log("imageSrcSet — responsive candidates for the browser to choose from");
const set = imageSrcSet(IK, [320, 640]);
check("emits one candidate per width", set.split(",").length === 2, set);
check("candidate carries its width descriptor", set.includes(" 320w") && set.includes(" 640w"), set);
check("each candidate is transformed", (set.match(/tr=/g) ?? []).length === 2, set);
check("foreign host yields no srcset", imageSrcSet("https://cdn.example.com/a.png", [320, 640]) === "");
check("CARD_WIDTHS is an ascending ladder", CARD_WIDTHS.every((w, i) => i === 0 || w > CARD_WIDTHS[i - 1]), CARD_WIDTHS);
check("CARD_SIZES is a sizes attribute", typeof CARD_SIZES === "string" && CARD_SIZES.includes("vw"), CARD_SIZES);

console.log("wiring — the storefront actually renders through the layer");
const catalog = read("src/storefront/components/Catalog.tsx");
check("Catalog imports the image layer", /from "@\/lib\/media\/image-url"/.test(catalog));
check("Catalog product image is transformed", /imageUrl\(/.test(catalog), false);
check("Catalog product image lazy-loads", /loading="lazy"/.test(catalog));
check("Catalog product image decodes async", /decoding="async"/.test(catalog));
check("Catalog product image is responsive", /srcSet=/.test(catalog));

const hero = read("src/storefront/components/Hero.tsx");
check("Hero imports the image layer", /from "@\/lib\/media\/image-url"/.test(hero));
check("Hero media is transformed", /imageUrl\(/.test(hero));
check("Hero media stays eager (LCP element)", /loading="eager"/.test(hero));
check("Hero media keeps fetchPriority high", /fetchPriority="high"/.test(hero));

const header = read("src/storefront/components/Header.tsx");
check("Header logo is transformed", /imageUrl\(/.test(header));
const footer = read("src/storefront/components/Footer.tsx");
check("Footer logo is transformed", /imageUrl\(/.test(footer));
check("Footer logo lazy-loads (below the fold)", /loading="lazy"/.test(footer));

console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
