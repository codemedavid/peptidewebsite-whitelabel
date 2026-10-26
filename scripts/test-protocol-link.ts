/**
 * Self-contained gate for per-PROTOCOL share links.
 *
 * The Protocols page was one accordion at #protocols, so an owner could only
 * send the whole guide. Every protocol now has its own address:
 *
 *   https://<tenant-host>/protocols/<key>   ← server route, emits per-protocol OG tags
 *   #protocols/<key>                        ← the same target inside the hash SPA
 *
 * Runs the REAL pure helpers in src/lib/storefront/protocol-link.ts (no DB, no
 * React runtime), plus structural checks that the feature is actually wired:
 * the SPA router, the page's open/scroll + share control, the server route and
 * the storefront layout.
 *
 *   npm run test:protocol-link
 */

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findProtocolIndexByLinkKey,
  parseProtocolHash,
  protocolHash,
  protocolLinkKeys,
  protocolPath,
  protocolShareUrl,
  protocolSlug,
} from "../src/lib/storefront/protocol-link";
import { parseProductHash } from "../src/lib/storefront/product-link";

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

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// ─────────────────────────────── slugs + keys ───────────────────────────────
console.log("\nSlugs and keys");

check("a name slugs to a lowercase, dash-separated, URL-safe key", () => {
  assert.equal(protocolSlug("GHK-Cu 50mg"), "ghk-cu-50mg");
  assert.equal(protocolSlug("  MicaBlend 2.0 — Tirzepatide (30mg) "), "micablend-2-0-tirzepatide-30mg");
  assert.equal(protocolSlug("Péptido Ñ"), "peptido-n");
});

check("strength numbers survive, so two strengths get two links", () => {
  assert.notEqual(protocolSlug("GHK-Cu 50mg"), protocolSlug("GHK-Cu 100mg"));
});

check("an unnamed or symbol-only protocol still gets an address", () => {
  assert.equal(protocolSlug(""), "protocol");
  assert.equal(protocolSlug(null), "protocol");
  assert.equal(protocolSlug("!!!"), "protocol");
});

check("very long names are capped and never end in a dash", () => {
  const slug = protocolSlug(`${"a".repeat(79)} bcd`);
  assert.ok(slug.length <= 80, `slug is ${slug.length} chars`);
  assert.ok(!slug.endsWith("-"), slug);
});

check("duplicate names get -2, -3 and never collide with a literal 'x 2'", () => {
  const keys = protocolLinkKeys([
    { name: "BPC-157" },
    { name: "bpc 157" },
    { name: "BPC-157 2" },
    { name: "BPC-157" },
  ]);
  assert.deepEqual(keys, ["bpc-157", "bpc-157-2", "bpc-157-2-2", "bpc-157-3"]);
  assert.equal(new Set(keys).size, keys.length);
});

check("keys are index-aligned with the source list", () => {
  const list = [{ name: "A" }, { name: "B" }, { name: "C" }];
  assert.deepEqual(protocolLinkKeys(list), ["a", "b", "c"]);
});

// ───────────────────────── renderings + round-trip ──────────────────────────
console.log("\nPath, hash and URL");

check("path, hash and share URL render one key", () => {
  assert.equal(protocolPath("ghk-cu-50mg"), "/protocols/ghk-cu-50mg");
  assert.equal(protocolHash("ghk-cu-50mg"), "#protocols/ghk-cu-50mg");
  assert.equal(
    protocolShareUrl("https://kglow.pepweb.store/", "ghk-cu-50mg"),
    "https://kglow.pepweb.store/protocols/ghk-cu-50mg",
  );
});

check("an empty origin degrades to the relative path, never 'undefined/...'", () => {
  assert.equal(protocolShareUrl("", "x"), "/protocols/x");
  assert.equal(protocolShareUrl(undefined, "x"), "/protocols/x");
});

check("the hash round-trips through the parser", () => {
  for (const key of ["ghk-cu-50mg", "bpc-157-2"]) {
    assert.equal(parseProtocolHash(protocolHash(key)), key);
    assert.equal(parseProtocolHash(protocolHash(key).slice(1)), key);
  }
});

check("the parser leaves every other route alone", () => {
  for (const h of ["", "#", "#protocols", "#protocols/", "#catalog", "#admin", "#p/ghk", "#articles/x"]) {
    assert.equal(parseProtocolHash(h), null, h);
  }
});

check("a product link and a protocol link can never be mistaken for each other", () => {
  assert.equal(parseProductHash(protocolHash("ghk")), null);
  assert.equal(parseProtocolHash("#p/ghk"), null);
});

check("a mangled percent-escape does not throw", () => {
  assert.equal(parseProtocolHash("#protocols/abc%E2%8"), "abc%E2%8");
});

// ──────────────────────────────── resolution ────────────────────────────────
console.log("\nResolving a key");

const LIST = [{ name: "BPC-157" }, { name: "GHK-Cu 50mg" }, { name: "BPC-157" }];

check("a key resolves to its protocol's index", () => {
  assert.equal(findProtocolIndexByLinkKey(LIST, "ghk-cu-50mg"), 1);
  assert.equal(findProtocolIndexByLinkKey(LIST, "bpc-157"), 0);
  assert.equal(findProtocolIndexByLinkKey(LIST, "bpc-157-2"), 2);
});

check("a hand-typed or case-mangled key still resolves", () => {
  assert.equal(findProtocolIndexByLinkKey(LIST, "GHK-Cu-50mg"), 1);
  assert.equal(findProtocolIndexByLinkKey(LIST, "GHK-Cu 50mg"), 1);
});

check("an unknown, empty or missing key is -1 (the page shows the whole guide)", () => {
  assert.equal(findProtocolIndexByLinkKey(LIST, "renamed"), -1);
  assert.equal(findProtocolIndexByLinkKey(LIST, ""), -1);
  assert.equal(findProtocolIndexByLinkKey(LIST, null), -1);
  assert.equal(findProtocolIndexByLinkKey([], "x"), -1);
});

// ───────────────────────────────── wiring ───────────────────────────────────
console.log("\nWiring");

check("the SPA router sends #protocols/<key> to the Protocols page with the key", () => {
  const app = src("src/storefront/StorefrontApp.tsx");
  assert.ok(/parseProtocolHash\(h\)\) return "protocols"/.test(app), "pageFromHash ignores #protocols/<key>");
  assert.ok(/openKey=\{protocolKey\}/.test(app), "ProtocolsPage is not handed the protocol key");
  assert.ok(/initialProtocolKey \? "protocols" : "home"/.test(app), "server-route key does not select the page on first render");
});

check("the Protocols page opens the linked protocol and renders a share control per row", () => {
  const page = src("src/storefront/pages/ProtocolsPage.tsx");
  assert.ok(/findProtocolIndexByLinkKey/.test(page), "page never resolves the key");
  assert.ok(/protocolLinkKeys\(all\)/.test(page), "keys are not computed from the SOURCE list");
  assert.ok(/<ShareLinkButton/.test(page) && /protocolShareUrl/.test(page), "no per-protocol share button");
  assert.ok(/scrollIntoView/.test(page), "the linked protocol is never scrolled into view");
});

check("the /protocols/[slug] route exists, gates on the page, and emits openGraph", () => {
  const file = "src/app/(tenant)/(storefront)/protocols/[slug]/page.tsx";
  assert.ok(existsSync(join(process.cwd(), file)), `${file} is missing`);
  const route = src(file);
  assert.ok(/openGraph/.test(route), "no per-protocol openGraph — chat previews show the bare store");
  assert.ok(/FEATURES\.STORE_PROTOCOLS/.test(route) && /resolveEntitledPage/.test(route), "route ignores the Protocols page gate");
  assert.ok(/initialProtocol=/.test(route), "route does not hand the key to the storefront");
});

check("the storefront layout treats /protocols/ as SPA-shaped (no legacy chrome)", () => {
  const layout = src("src/app/(tenant)/(storefront)/layout.tsx");
  assert.ok(/pathname\.startsWith\("\/protocols\/"\)/.test(layout), "shared link renders inside the legacy header");
});

// ─────────────────────────────────── summary ────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
