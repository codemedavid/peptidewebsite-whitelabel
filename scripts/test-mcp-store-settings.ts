// MCP store settings — RED/GREEN gate (npm run test:mcp-store-settings).
//
// The connector could create a store and dress it, but the parts that let a
// store actually SELL — the owner's sign-in, categories, payment methods,
// couriers, shipping, contact channels, FAQ/lab reports/reviews, the open/closed
// switch and the access gate — still meant an operator clicking through two
// admin consoles. These tools close that gap. The rules pinned here:
//
//   AN AGENT CANNOT SEE THE STORE, SO NOTHING IS DROPPED SILENTLY. The website
//   normalizers drop a courier with no id, a shipping row with no code, a promo
//   with no id. A person never hits that (the editor fills ids in); an agent
//   always does. The prep layer fills ids in the same way, and refuses — it does
//   not drop — anything it cannot make valid.
//
//   EDITING A LIST MUST NOT BREAK WHAT POINTS AT IT. Products store a category
//   ID and shipping rows store a courier ID. A rewrite of either list that
//   minted fresh ids would orphan every product or location. A row sent without
//   an id reuses the id of the existing row with the same name.
//
//   SECRETS NEVER LEAVE. The read tool projects branding.config through an
//   allow-list; password and access-code hashes are reported as "is set", never
//   as values.
//
//   THE ESCAPE HATCH IS CONFIG-ONLY. run_store_admin_action reaches the website's
//   store-admin actions, but never the ones that read customer PII or destroy
//   data.

import assert from "node:assert";
import {
  assignIds,
  carryPromoUsage,
  removedRows,
  normalizeFooterPatch,
  patchContactChannels,
  prepareCategories,
  prepareCouriers,
  preparePaymentMethods,
  preparePromoCodes,
  prepareShippingLocations,
  projectStoreSettings,
  STORE_ACTION_ALLOWLIST,
  isAllowedStoreAction,
} from "../src/lib/mcp/store-settings-core";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log("MCP store settings core");

  // ── ids ────────────────────────────────────────────────────────────────
  await check("fills a missing id from the row's name, unique within the list", () => {
    const out = assignIds([{ name: "J&T Express" }, { name: "J&T Express" }, { id: "lbc", name: "LBC" }], "name", []);
    assert.deepEqual(
      out.map((r) => r.id),
      ["j-t-express", "j-t-express-2", "lbc"],
    );
  });

  await check("reuses the existing id of a same-named row so links survive a rewrite", () => {
    const out = assignIds([{ label: "Weight Loss" }], "label", [{ id: "cat-7", label: "weight loss" }]);
    assert.equal(out[0].id, "cat-7");
  });

  await check("never mutates the rows it is given", () => {
    const rows = [{ name: "Ninja Van" }];
    assignIds(rows, "name", []);
    assert.deepEqual(rows, [{ name: "Ninja Van" }]);
  });

  // ── categories ─────────────────────────────────────────────────────────
  await check("categories: id from label, the synthetic 'all' tab refused", () => {
    const ok = prepareCategories([{ label: "Peptides" }, { label: "Bac Water", image: "https://ik.imagekit.io/x/a.png" }], []);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.deepEqual(ok.rows.map((r) => r.id), ["peptides", "bac-water"]);
    assert.equal(ok.rows[1].image, "https://ik.imagekit.io/x/a.png");

    const bad = prepareCategories([{ id: "all", label: "All" }], []);
    assert.equal(bad.ok, false);
  });

  await check("categories: a blank label is refused, not dropped", () => {
    const out = prepareCategories([{ label: "  " }], []);
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.error, /label/i);
  });

  // ── payment methods ────────────────────────────────────────────────────
  await check("payment methods: ids + order filled, a method needs a name", () => {
    const out = preparePaymentMethods([{ name: "GCash", account: "Jene D.", number: "0917" }, { name: "BDO" }], []);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.rows.map((r) => [r.id, r.order]), [["gcash", 1], ["bdo", 2]]);
    assert.equal(preparePaymentMethods([{ account: "x" }], []).ok, false);
  });

  // ── couriers + shipping ────────────────────────────────────────────────
  await check("couriers: ids filled, a bad booking link refused", () => {
    const ok = prepareCouriers([{ name: "Lalamove", noLocation: true }], []);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.rows[0].id, "lalamove");
    const bad = prepareCouriers([{ name: "X", bookingUrl: "javascript:alert(1)" }], []);
    assert.equal(bad.ok, false);
  });

  await check("shipping: a location may name its courier by NAME and gets its id", () => {
    const couriers = [{ id: "jnt", name: "J&T Express" }];
    const out = prepareShippingLocations([{ name: "Metro Manila", courier: "j&t express", price: 120 }], couriers, []);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.rows[0].courierId, "jnt");
    assert.equal(out.rows[0].code, "metro-manila");
    assert.equal(out.rows[0].price, 120);
  });

  await check("shipping: an unknown courier is refused with the known names", () => {
    const out = prepareShippingLocations([{ name: "Cebu", courier: "DHL" }], [{ id: "lbc", name: "LBC" }], []);
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.error, /LBC/);
  });

  // ── promo codes ────────────────────────────────────────────────────────
  await check("promo codes: id from the code, a codeless row refused", () => {
    const out = preparePromoCodes([{ code: "welcome10", type: "percent", value: 10 }], []);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.rows[0].id, "welcome10");
    assert.equal(preparePromoCodes([{ type: "fixed", value: 50 }], []).ok, false);
  });

  await check("promo codes: a rewrite keeps each code's usage count (limits stay enforced)", () => {
    const out = carryPromoUsage([{ id: "welcome10", code: "WELCOME10" }, { id: "new", code: "NEW" }], [
      { id: "welcome10", code: "WELCOME10", used: 37 },
    ]);
    assert.equal(out[0].used, 37);
    assert.equal(out[1].used, undefined);
    const explicit = carryPromoUsage([{ id: "welcome10", used: 0 }], [{ id: "welcome10", used: 37 }]);
    assert.equal(explicit[0].used, 0, "an explicit reset is honored");
  });

  // ── contact channels ───────────────────────────────────────────────────
  await check("contact channels: a patch changes only the channels it names", () => {
    const current = [
      { type: "whatsapp", destination: "639171234567", enabled: true },
      { type: "telegram", destination: "mystore", enabled: true },
    ];
    const out = patchContactChannels(current, [{ type: "telegram", enabled: false }]);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const byType = Object.fromEntries(out.channels.map((c) => [c.type, c]));
    assert.equal(byType.whatsapp.enabled, true);
    assert.equal(byType.telegram.enabled, false);
    assert.equal(byType.telegram.destination, "mystore");
  });

  await check("contact channels: enabling one with no destination is refused", () => {
    const out = patchContactChannels([], [{ type: "messenger", enabled: true }]);
    assert.equal(out.ok, false);
  });

  await check("contact channels: an unknown channel type is refused", () => {
    const out = patchContactChannels([], [{ type: "sms", destination: "1", enabled: true }]);
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.error, /whatsapp/);
  });

  // ── footer ─────────────────────────────────────────────────────────────
  await check("footer: socials keep only real http(s) links; unknown platforms refused", () => {
    const ok = normalizeFooterPatch({
      socials: [{ platform: "instagram", url: "instagram.com/mystore" }],
      copyright: "© 2026 My Store",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    const socials = ok.patch.footerSocials as Array<{ icon: string; href: string; show: boolean }>;
    assert.equal(socials[0].icon, "instagram");
    assert.match(socials[0].href, /^https:\/\//);
    assert.equal(ok.patch.footerCopyright, "© 2026 My Store");

    const bad = normalizeFooterPatch({ socials: [{ platform: "myspace", url: "https://x.y" }] });
    assert.equal(bad.ok, false);
    const unsafe = normalizeFooterPatch({ socials: [{ platform: "facebook", url: "javascript:alert(1)" }] });
    assert.equal(unsafe.ok, false);
  });

  await check("footer: column links refuse javascript: and other active schemes", () => {
    const bad = normalizeFooterPatch({ columns: [{ title: "Help", links: [{ label: "Terms", href: "javascript:alert(1)" }] }] });
    assert.equal(bad.ok, false);
    const good = normalizeFooterPatch({
      columns: [{ title: "Help", links: [
        { label: "Track", href: "#track" },
        { label: "About", href: "/about" },
        { label: "Mail", href: "mailto:hi@x.com" },
        { label: "Site", href: "https://x.com" },
      ] }],
    });
    assert.equal(good.ok, true);
  });

  // ── removals + duplicates ──────────────────────────────────────────────
  await check("a list that leaves out an existing row reports it as removed", () => {
    const removed = removedRows([{ id: "peptides" }], [{ id: "peptides", label: "Peptides" }, { id: "kits", label: "Kits" }]);
    assert.deepEqual(removed.map((r) => r.id), ["kits"]);
  });

  await check("duplicate explicit ids are refused instead of silently collapsed", () => {
    const out = prepareCouriers([{ id: "jnt", name: "J&T" }, { id: "jnt", name: "J&T Express" }], []);
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.error, /jnt/);
  });

  await check("payment methods: a non-http(s) QR image is refused", () => {
    const out = preparePaymentMethods([{ name: "GCash", qrImage: "javascript:alert(1)" }], []);
    assert.equal(out.ok, false);
  });

  // ── read projection ────────────────────────────────────────────────────
  await check("settings read never leaks a hash or a reseller credential", () => {
    const view = projectStoreSettings(
      {
        adminPasswordHash: "scrypt$abc$def",
        resellerAccess: { codeHash: "scrypt$1$2" },
        paymentMethods: [{ id: "gcash", name: "GCash" }],
        accessGate: { enabled: true, heading: "Members only" },
      },
      { storeAdminEmail: "owner@x.com", hasPassword: true, hasAccessCode: true },
    );
    const text = JSON.stringify(view);
    assert.ok(!text.includes("scrypt$"), "no hash may appear in the read");
    assert.equal((view.adminLogin as { passwordSet: boolean }).passwordSet, true);
    assert.equal((view.accessGate as { codeSet: boolean }).codeSet, true);
    assert.deepEqual(view.paymentMethods, [{ id: "gcash", name: "GCash" }]);
  });

  // ── escape hatch ───────────────────────────────────────────────────────
  await check("escape hatch: config actions allowed, PII and destructive ones not", () => {
    assert.ok(isAllowedStoreAction("saveCheckoutRulesAction"));
    assert.ok(isAllowedStoreAction("saveGroupBuyAction"));
    for (const forbidden of [
      "listStorefrontOrdersAction",
      "purgeStorefrontOrdersAction",
      "exportStoreDataAction",
      "listStoreCustomersAction",
      "deleteProductsAction",
      "createStaffAction",
      "constructor",
      "__proto__",
    ]) {
      assert.equal(isAllowedStoreAction(forbidden), false, `${forbidden} must be refused`);
    }
    assert.ok(Object.keys(STORE_ACTION_ALLOWLIST).length > 10);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
