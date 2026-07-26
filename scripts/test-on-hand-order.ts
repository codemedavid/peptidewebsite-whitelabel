// Self-contained gate for the ON-HAND shelf ordering rule
// (src/lib/storefront/on-hand-order.ts). No DB, no React — verifies that a store
// on the "per-vial-first" order surfaces its single-vial listings above the
// multi-vial kits, and that every other tenant keeps today's catalog order.
//
//   npm run test:onhand-order

import {
  isMultiVialListing,
  normalizeOnHandOrder,
  onHandRank,
  orderOnHandProducts,
} from "../src/lib/storefront/on-hand-order";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("on-hand shelf ordering\n");

// ── normalizeOnHandOrder — untrusted branding.config value ───────────────────
check('"per-vial-first" is honoured', normalizeOnHandOrder("per-vial-first") === "per-vial-first");
check('"catalog" stays catalog order', normalizeOnHandOrder("catalog") === "catalog");
check("undefined falls back to catalog order", normalizeOnHandOrder(undefined) === "catalog");
check("unknown junk falls back to catalog order", normalizeOnHandOrder("vials?!") === "catalog");
check("non-string junk falls back to catalog order", normalizeOnHandOrder({ x: 1 }) === "catalog");

// ── isMultiVialListing — what counts as a "per 10 vials" listing ─────────────
check("a × 10 vials variation is a multi-vial kit",
  isMultiVialListing({ name: "Tirzepatide", variations: [{ name: "15mg × 10 vials", price: 3200 }] }));
check("a plain 'x10 vials' variation is a multi-vial kit",
  isMultiVialListing({ name: "KPV", variations: [{ name: "10mg x10 vials", price: 1595 }] }));
check("'10 vials' in the product NAME is a multi-vial kit",
  isMultiVialListing({ name: "Tirzepatide 15mg × 10 vials" }));

check("a per-vial product with no variations is NOT a kit",
  !isMultiVialListing({ name: "Tirzepatide 30mg" }));
check("bacteriostatic water volumes (ml) are NOT a kit",
  !isMultiVialListing({
    name: "Bacteriostatic Water",
    variations: [{ name: "3ml", price: 488 }, { name: "10ml", price: 732 }],
  }));
check("mg-size variations alone are NOT a kit",
  !isMultiVialListing({ name: "GHK-CU", variations: [{ name: "50mg", price: 600 }] }));
// A listing that spells out "1 vial" is still sold per vial — never demote it.
check("'× 1 vial' is NOT a multi-vial kit",
  !isMultiVialListing({ name: "KPV", variations: [{ name: "10mg × 1 vial", price: 700 }] }));

// ── onHandRank — the three tiers, per-vial first ─────────────────────────────
check("single per-vial listing ranks 0", onHandRank({ name: "Tirzepatide 30mg" }) === 0);
check("sized (non-vial) listing ranks 1",
  onHandRank({ name: "Bacteriostatic Water", variations: [{ name: "5ml", price: 510 }] }) === 1);
check("multi-vial kit ranks 2 (last)",
  onHandRank({ name: "KPV", variations: [{ name: "10mg × 10 vials", price: 1595 }] }) === 2);

// ── orderOnHandProducts — K Glow's real on-hand shelf ────────────────────────
// Catalog order (createdAt asc): the 2026-07-24 seeded kits land BEFORE the
// owner's 2026-07-26 per-vial listings, which is exactly the complaint.
const KGLOW = [
  { id: "5am", name: "5-Amino-1MQ", variations: [{ name: "5mg × 10 vials", price: 2800 }] },
  { id: "aod", name: "AOD-9604", variations: [{ name: "5mg × 10 vials", price: 5100 }] },
  { id: "bac", name: "Bacteriostatic Water", variations: [{ name: "3ml", price: 488 }, { name: "5ml", price: 510 }] },
  { id: "ghk-oh", name: "GHK-CU", variations: [{ name: "50mg × 10 vials", price: 2000 }] },
  { id: "kpv-oh", name: "KPV", variations: [{ name: "10mg × 10 vials", price: 1595 }] },
  { id: "tirz-oh", name: "Tirzepatide", variations: [{ name: "15mg × 10 vials", price: 3200 }] },
  { id: "ghk50", name: "Ghkcu 50mg" },
  { id: "kpv", name: "KPV" },
  { id: "tirz15", name: "Tirzepatide 15mg" },
  { id: "tirz30", name: "Tirzepatide 30mg" },
];

const catalogOrder = orderOnHandProducts(KGLOW, "catalog");
check("catalog order leaves the shelf untouched",
  catalogOrder.map((p) => p.id).join(",") === KGLOW.map((p) => p.id).join(","));
check("catalog order still returns a NEW array (no aliasing)", catalogOrder !== KGLOW);

const perVialFirst = orderOnHandProducts(KGLOW, "per-vial-first");
check("per-vial listings lead the shelf",
  perVialFirst.slice(0, 4).map((p) => p.id).join(",") === "ghk50,kpv,tirz15,tirz30",
  perVialFirst.slice(0, 4).map((p) => p.id).join(","));
check("the 10-vial kits sit under the per-vial listings",
  perVialFirst.slice(-5).every((p) => isMultiVialListing(p)));
check("bacteriostatic water sits between them (sized, not a kit)",
  perVialFirst[4]?.id === "bac", perVialFirst[4]?.id);

// Stable within a tier: relative catalog order is preserved, so the owner's
// admin ordering still means something inside each group.
check("catalog order is preserved inside the per-vial tier",
  perVialFirst.filter((p) => onHandRank(p) === 0).map((p) => p.id).join(",") ===
    KGLOW.filter((p) => onHandRank(p) === 0).map((p) => p.id).join(","));
check("catalog order is preserved inside the kit tier",
  perVialFirst.filter((p) => onHandRank(p) === 2).map((p) => p.id).join(",") ===
    KGLOW.filter((p) => onHandRank(p) === 2).map((p) => p.id).join(","));

// Nothing may be dropped or duplicated — this is a re-order, not a filter.
check("every product survives the re-order", perVialFirst.length === KGLOW.length);
check("no product is duplicated", new Set(perVialFirst.map((p) => p.id)).size === KGLOW.length);
check("the input array is never mutated", KGLOW[0].id === "5am" && KGLOW[9].id === "tirz30");

check("an empty shelf is safe", orderOnHandProducts([], "per-vial-first").length === 0);

// ── Composition with the catalog sort dropdown ───────────────────────────────
// The classic catalog sorts first (Name / Price / Best Sellers) and then applies
// the tier order, so packaging outranks the shopper's choice while their choice
// still orders each tier. Name order is what the catalog defaults to.
const byName = [...KGLOW].sort((a, b) => a.name.localeCompare(b.name));
const tiered = orderOnHandProducts(byName, "per-vial-first");
check("per-vial tier still leads after a name sort",
  tiered.slice(0, 4).every((p) => onHandRank(p) === 0), tiered.slice(0, 4).map((p) => p.name).join(","));
check("name order is kept inside the per-vial tier",
  tiered.filter((p) => onHandRank(p) === 0).map((p) => p.name).join(",") ===
    "Ghkcu 50mg,KPV,Tirzepatide 15mg,Tirzepatide 30mg");
check("name order is kept inside the kit tier",
  tiered.filter((p) => onHandRank(p) === 2).map((p) => p.name).join(",") ===
    "5-Amino-1MQ,AOD-9604,GHK-CU,KPV,Tirzepatide");

console.log(failures === 0 ? "\nPASS — on-hand shelf ordering verified" : `\nFAIL — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
