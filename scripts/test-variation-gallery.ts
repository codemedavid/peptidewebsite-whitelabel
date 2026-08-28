/**
 * Self-contained test for PER-VARIATION IMAGES and the swipeable product-card
 * gallery they drive.
 *
 * WHY (mstomato, 2026-08-28): that tenant's variations are COLORWAYS — "Silk
 * Barbie", "Trans. Ocean", "Roseberry" — so a name-only pill tells a customer
 * nothing about what they are buying. The seller can now attach a photo to each
 * variation; the card turns those photos into a swipeable gallery, and swiping
 * to a photo SELECTS that variation (price reveals, Add to Cart binds to it).
 *
 * The rules that carry the risk:
 *
 *   1. A product whose variations have no photos yields at most ONE slide, so
 *      the card renders exactly as it does today — no track, no dots, no
 *      swipe handlers. This is the non-regression gate for every other tenant.
 *
 *   2. `optionIndex` is an index into buildProductOptions(), NOT into
 *      product.variations. Those differ by one whenever a distinct base price
 *      makes buildProductOptions prepend "Standard". Get it wrong and swiping to
 *      the Roseberry photo sells the customer Rosegold.
 *
 *   3. Slide 0 is the BASE image and carries `optionIndex: null`. The card
 *      mounts on slide 0, so the long-standing "no price until you pick" rule
 *      (scripts/test-variation-price-reveal.ts) survives: landing on the gallery
 *      must not auto-select an option.
 *
 *   4. Only http(s) URLs become slides — same rule as the brand default photo
 *      (normalizeDefaultProductImage), keeping `javascript:` and `data:` out of
 *      an <img src> fed from tenant-editable JSON.
 *
 * Layers covered:
 *   1. The pure model: src/lib/storefront/product-gallery.ts
 *   2. Persistence:    cleanVariations round-trips `image` (product-mapping.ts)
 *   3. Structural guards on src/storefront/components/Catalog.tsx and the admin
 *      editor so the feature is actually wired, not just modelled.
 *
 *   npm run test:variation-gallery
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildProductGallery,
  hasGallery,
  type GallerySlide,
} from "../src/lib/storefront/product-gallery";
import { dbProductToStorefront, productToDbWrite } from "../src/lib/storefront/product-mapping";

// ──────────────────────────── tiny assertion harness ────────────────────────
let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const IMG = (n: string) => `https://img.example/${n}.jpg`;

/** Minimal gallery source — mirrors what the card passes in. */
const product = (over: Partial<Parameters<typeof buildProductGallery>[0]> = {}) => ({
  name: "Single Vial Case – 3 mL",
  image: null as string | null,
  price: 0,
  variations: [] as { name: string; price: number; image?: string }[],
  ...over,
});

const optionIndices = (slides: GallerySlide[]) => slides.map((s) => s.optionIndex);

console.log("\nPer-variation images — swipe the card to change colorway\n");

// ─────────────────── nothing changes for products without them ───────────────
console.log("products with no variation photos are untouched");

check("no images anywhere → no slides at all (card keeps its SVG placeholder)", () => {
  const slides = buildProductGallery(product());
  assert.deepEqual(slides, []);
  assert.equal(hasGallery(slides), false);
});

check("81 variations but none photographed → ONE slide, no gallery", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: Array.from({ length: 81 }, (_, i) => ({ name: `Color ${i}`, price: 600 })),
    }),
  );
  assert.equal(slides.length, 1, "un-photographed variations must not become blank slides");
  assert.equal(hasGallery(slides), false, "the card must not sprout a swipe track");
});

check("a single base photo is one slide and is not a gallery", () => {
  const slides = buildProductGallery(product({ image: IMG("case") }));
  assert.equal(slides.length, 1);
  assert.equal(slides[0].optionIndex, null);
  assert.equal(slides[0].src, IMG("case"));
  assert.equal(hasGallery(slides), false);
});

// ────────────────────────────── the base slide ───────────────────────────────
console.log("\nslide 0 is the base image and selects nothing");

check("the brand default photo stands in when the product has none", () => {
  const slides = buildProductGallery(product({ variations: [] }), IMG("brand-default"));
  assert.equal(slides.length, 1);
  assert.equal(slides[0].src, IMG("brand-default"));
  assert.equal(slides[0].optionIndex, null);
});

check("the product's own photo outranks the brand default", () => {
  const slides = buildProductGallery(product({ image: IMG("own") }), IMG("brand-default"));
  assert.equal(slides[0].src, IMG("own"));
});

check("slide 0 carries optionIndex null so mounting never auto-picks an option", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: [{ name: "Roseberry", price: 600, image: IMG("roseberry") }],
    }),
  );
  assert.equal(slides[0].optionIndex, null, "landing on the gallery would reveal a price unasked");
});

check("with no base photo, the first slide still reports the option it really shows", () => {
  const slides = buildProductGallery(
    product({
      price: 500,
      variations: [{ name: "Roseberry", price: 600, image: IMG("roseberry") }],
    }),
  );
  assert.equal(slides.length, 1);
  assert.equal(slides[0].optionIndex, 1, "must point at the option, not at the base");
});

// ───────────── optionIndex is a buildProductOptions index, not a raw one ─────
console.log("\noptionIndex maps through buildProductOptions (the Standard offset)");

check("a distinct base price prepends Standard, so variations start at index 1", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: [
        { name: "Rosegold", price: 600, image: IMG("rosegold") },
        { name: "Roseberry", price: 600, image: IMG("roseberry") },
      ],
    }),
  );
  assert.equal(slides.length, 3, "base + two colorways");
  assert.deepEqual(optionIndices(slides), [null, 1, 2], "off-by-one sells the wrong colorway");
  assert.equal(slides[1].label, "Rosegold");
  assert.equal(slides[2].label, "Roseberry");
});

check("no Standard option (a variation carries the base price) → variations start at 0", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 600,
      variations: [
        { name: "Rosegold", price: 600, image: IMG("rosegold") }, // == base price
        { name: "Roseberry", price: 700, image: IMG("roseberry") },
      ],
    }),
  );
  assert.deepEqual(optionIndices(slides), [null, 0, 1]);
});

check("un-photographed variations are skipped WITHOUT shifting the indices after them", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: [
        { name: "Rosegold", price: 600 }, // no photo
        { name: "Roseberry", price: 600, image: IMG("roseberry") },
        { name: "Sakura", price: 600 }, // no photo
        { name: "Teal", price: 600, image: IMG("teal") },
      ],
    }),
  );
  assert.equal(slides.length, 3, "base + the two photographed colorways");
  // Roseberry is variations[1] → option index 2; Teal is variations[3] → 4.
  assert.deepEqual(optionIndices(slides), [null, 2, 4], "gaps must not be compacted away");
  assert.equal(slides[1].label, "Roseberry");
  assert.equal(slides[2].label, "Teal");
});

check("the full 81-colorway case maps its last slide correctly", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: Array.from({ length: 81 }, (_, i) => ({
        name: `Color ${i}`,
        price: 600,
        image: IMG(`c${i}`),
      })),
    }),
  );
  assert.equal(slides.length, 82, "base + 81 colorways");
  assert.equal(hasGallery(slides), true);
  const last = slides[slides.length - 1];
  assert.equal(last.label, "Color 80");
  assert.equal(last.optionIndex, 81, "Standard occupies index 0, so Color 80 is option 81");
});

// ──────────────────────────── untrusted URL safety ───────────────────────────
console.log("\nonly hosted http(s) photos become slides");

for (const bad of [
  "javascript:alert(1)",
  "data:image/png;base64,iVBORw0KGgo=",
  "  ",
  "/relative/path.jpg",
]) {
  check(`rejects ${JSON.stringify(bad.trim() || "(blank)")}`, () => {
    const slides = buildProductGallery(
      product({
        image: IMG("case"),
        price: 500,
        variations: [{ name: "Bad", price: 600, image: bad }],
      }),
    );
    assert.equal(slides.length, 1, "an unsafe URL reached an <img src>");
  });
}

check("a non-string image is ignored rather than crashing", () => {
  const slides = buildProductGallery(
    product({
      image: IMG("case"),
      price: 500,
      variations: [{ name: "Odd", price: 600, image: 42 as unknown as string }],
    }),
  );
  assert.equal(slides.length, 1);
});

check("http and https both pass", () => {
  const slides = buildProductGallery(
    product({
      price: 500,
      variations: [
        { name: "A", price: 600, image: "http://img.example/a.jpg" },
        { name: "B", price: 600, image: "https://img.example/b.jpg" },
      ],
    }),
  );
  assert.equal(slides.length, 2);
});

// ───────────────────────── hasGallery is the render gate ─────────────────────
console.log("\nhasGallery");

check("0 or 1 slide is not a gallery; 2+ is", () => {
  assert.equal(hasGallery([]), false);
  assert.equal(hasGallery(buildProductGallery(product({ image: IMG("a") }))), false);
  assert.equal(
    hasGallery(
      buildProductGallery(
        product({
          image: IMG("a"),
          price: 500,
          variations: [{ name: "B", price: 600, image: IMG("b") }],
        }),
      ),
    ),
    true,
  );
});

// ─────────────────────── the image survives a DB round-trip ──────────────────
console.log("\npersistence — metadata.variations[].image round-trips");

check("a variation photo survives storefront → DB → storefront", () => {
  const write = productToDbWrite(
    {
      id: "p1",
      name: "Single Vial Case",
      description: "",
      price: 500,
      currency: "₱",
      stock: 10,
      available: true,
      variations: [{ name: "Roseberry", price: 600, image: IMG("roseberry") }],
    } as unknown as Parameters<typeof productToDbWrite>[0],
    "PHP",
    "₱",
  );
  assert.equal(
    write.metadata.variations?.[0]?.image,
    IMG("roseberry"),
    "the photo was dropped on save",
  );

  const back = dbProductToStorefront(
    {
      id: "p1",
      sku: "s",
      name: "Single Vial Case",
      description: null,
      priceCents: 50000,
      currency: "PHP",
      slug: "s",
      images: [],
      stock: 10,
      status: "active",
      active: true,
      metadata: write.metadata,
    },
    "₱",
  );
  assert.equal(back.variations?.[0]?.image, IMG("roseberry"), "the photo was dropped on read");
});

check("an unsafe variation photo is never persisted", () => {
  const write = productToDbWrite(
    {
      id: "p1",
      name: "X",
      description: "",
      price: 500,
      currency: "₱",
      stock: 1,
      available: true,
      variations: [{ name: "Bad", price: 600, image: "javascript:alert(1)" }],
    } as unknown as Parameters<typeof productToDbWrite>[0],
    "PHP",
    "₱",
  );
  assert.equal(write.metadata.variations?.[0]?.image, undefined);
});

check("a variation with no photo persists no empty image key", () => {
  const write = productToDbWrite(
    {
      id: "p1",
      name: "X",
      description: "",
      price: 500,
      currency: "₱",
      stock: 1,
      available: true,
      variations: [{ name: "Plain", price: 600 }],
    } as unknown as Parameters<typeof productToDbWrite>[0],
    "PHP",
    "₱",
  );
  assert.ok(
    !("image" in (write.metadata.variations?.[0] ?? {})),
    "an absent photo must stay absent, not become ''",
  );
});

// ──────────────────────────── the card is wired up ───────────────────────────
console.log("\nCatalog.tsx wiring");

const catalog = readFileSync(
  join(__dirname, "..", "src", "storefront", "components", "Catalog.tsx"),
  "utf8",
);

check("the card builds a gallery instead of a single hard-coded <img>", () => {
  assert.match(catalog, /buildProductGallery/, "the gallery model is never used");
});

check("swiping is native scroll-snap, not a JS gesture library", () => {
  assert.match(
    catalog,
    /product-card__gallery/,
    "no gallery track class — nothing to scroll-snap",
  );
});

check("slide visibility drives selection via IntersectionObserver, not scroll handlers", () => {
  assert.match(
    catalog,
    /IntersectionObserver/,
    "swiping cannot select a variation without observing the slides",
  );
  assert.doesNotMatch(
    catalog,
    /addEventListener\(\s*["']scroll["']/,
    "a raw scroll listener churns the main thread on every frame",
  );
});

check("reduced motion is honoured when the picker scrolls the gallery", () => {
  assert.match(
    catalog,
    /prefers-reduced-motion/,
    "pill clicks would smooth-scroll for users who asked for no motion",
  );
});

check("the gallery is only rendered when there is more than one slide", () => {
  assert.match(catalog, /hasGallery/, "a one-photo product would still get dots and arrows");
});

// ──────────────────────────── the admin is wired up ──────────────────────────
console.log("\nAdminAddProduct.tsx wiring");

const admin = readFileSync(
  join(__dirname, "..", "src", "storefront", "admin", "AdminAddProduct.tsx"),
  "utf8",
);

check("each variation row can upload its own photo", () => {
  assert.match(
    admin,
    /uploadProductImageAction/,
    "the editor has no upload path for a variation photo",
  );
  assert.match(
    admin,
    /uploadVariationImage/,
    "no per-variation upload handler exists",
  );
  assert.match(
    admin,
    /assignVariationImages/,
    "no bulk assign path — 81 colorways one file picker at a time is unusable",
  );
});

check("the save path forwards the variation photo", () => {
  const at = admin.indexOf("variations: variations");
  assert.ok(at > 0, "the save path no longer maps variations — update this guard");
  assert.match(
    admin.slice(at, at + 1200),
    /\{ \.\.\.withStock, image \}/,
    "the editor collects a photo but never sends it to the server",
  );
});

// ─────────────────────────────── summary ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
