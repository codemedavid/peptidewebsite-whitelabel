/**
 * Gate for the Pepweb app → website store-admin bridge
 * (docs: src/lib/mobile/admin-bridge.ts, handoff-token.ts, app-actor-scope.ts).
 * No DB and no network — the allowlist is imported for real through the
 * mobile-test loader (next/* and server-only stubbed):
 *
 *   - handoff codec:   roundtrip, expiry, tampering, wrong secret, junk input
 *   - handoff session: the liveness rule the redeemer applies
 *   - allowlist:       every name maps to a function; sign-in, shopper and
 *                      platform-operator actions are NEVER reachable; own-property
 *                      lookup only; storefront-admin exports can't silently drift
 *   - actor scope:     runAsAppActor is visible only inside its own call chain
 *
 *   npm run test:mobile-admin-bridge
 */
import assert from "node:assert";

import { encodeHandoffToken, decodeHandoffToken, HANDOFF_TTL_SECONDS } from "../src/lib/mobile/handoff-token";
import { checkHandoffSession } from "../src/lib/mobile/handoff-rules";
import { runAsAppActor, currentAppActorScope } from "../src/lib/auth/app-actor-scope";
import {
  BRIDGED_ACTIONS,
  FORM_ACTIONS,
  MAX_BRIDGE_ARGS,
  lookupAction,
  runBridgedAction,
} from "../src/lib/mobile/admin-bridge";
import * as storefrontAdmin from "../src/actions/storefront-admin";
import type { MobileContext } from "../src/lib/mobile/auth";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

const SECRET = "test-secret-for-handoff-0123456789";
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

async function main() {
  // ── handoff codec ──────────────────────────────────────────────────────────
  section("handoff token");
  await test("roundtrip names the session + tenant", () => {
    const { token, expiresAt } = encodeHandoffToken(SECRET, "sess_1", "tenant_1", NOW);
    assert.equal(expiresAt, Math.floor(NOW / 1000) * 1000 + HANDOFF_TTL_SECONDS * 1000);
    assert.deepEqual(decodeHandoffToken(SECRET, token, NOW), {
      sessionId: "sess_1",
      tenantId: "tenant_1",
      expiresAt,
    });
  });
  await test("expires after the TTL", () => {
    const { token } = encodeHandoffToken(SECRET, "sess_1", "tenant_1", NOW);
    assert.ok(decodeHandoffToken(SECRET, token, NOW + (HANDOFF_TTL_SECONDS - 1) * 1000));
    assert.equal(decodeHandoffToken(SECRET, token, NOW + HANDOFF_TTL_SECONDS * 1000), null);
    assert.equal(decodeHandoffToken(SECRET, token, NOW + 3600_000), null);
  });
  await test("a tampered payload or signature is rejected", () => {
    const { token } = encodeHandoffToken(SECRET, "sess_1", "tenant_1", NOW);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "sess_1", t: "tenant_OTHER", e: NOW / 1000 + 60 })).toString(
      "base64url",
    );
    assert.equal(decodeHandoffToken(SECRET, `${forged}.${sig}`, NOW), null, "swapped payload");
    const flipped = sig!.slice(0, -1) + (sig!.endsWith("A") ? "B" : "A");
    assert.equal(decodeHandoffToken(SECRET, `${payload}.${flipped}`, NOW), null, "flipped signature");
  });
  await test("a different secret never verifies", () => {
    const { token } = encodeHandoffToken(SECRET, "sess_1", "tenant_1", NOW);
    assert.equal(decodeHandoffToken("another-secret", token, NOW), null);
  });
  await test("junk input is rejected without throwing", () => {
    for (const junk of [null, undefined, 42, {}, "", ".", "a", "a.b.c", "abc.", ".abc", "x".repeat(2000)]) {
      assert.equal(decodeHandoffToken(SECRET, junk, NOW), null, String(junk).slice(0, 20));
    }
  });
  await test("a validly-signed but malformed payload is rejected", () => {
    // Sign arbitrary payloads the way the codec does, via encode on odd ids.
    const { token } = encodeHandoffToken(SECRET, "", "tenant_1", NOW);
    assert.equal(decodeHandoffToken(SECRET, token, NOW), null, "empty session id");
  });

  // ── handoff session liveness ───────────────────────────────────────────────
  section("handoff session rule");
  const now = new Date(NOW);
  await test("live session passes", () => {
    assert.deepEqual(checkHandoffSession({ revokedAt: null, refreshExpiresAt: new Date(NOW + 1000) }, now), { ok: true });
  });
  await test("revoked session fails even inside its window", () => {
    assert.deepEqual(
      checkHandoffSession({ revokedAt: new Date(NOW - 1), refreshExpiresAt: new Date(NOW + 1000) }, now),
      { ok: false, reason: "revoked" },
    );
  });
  await test("session past its refresh window fails", () => {
    assert.deepEqual(checkHandoffSession({ revokedAt: null, refreshExpiresAt: new Date(NOW) }, now), {
      ok: false,
      reason: "expired",
    });
  });

  // ── allowlist ──────────────────────────────────────────────────────────────
  section("allowlist");
  await test("every entry is a function", () => {
    for (const [name, fn] of Object.entries({ ...BRIDGED_ACTIONS, ...FORM_ACTIONS })) {
      assert.equal(typeof fn, "function", name);
    }
  });
  const NEVER = [
    // sign-in / session
    "signInStoreAdminAction",
    "signOutStorefrontAdminAction",
    "hasStorefrontAdminSessionAction",
    // shopper-facing
    "placeStorefrontOrderAction",
    "trackStorefrontOrderAction",
    "uploadPaymentProofAction",
    "getStorefrontProductsAction",
    "verifyResellerCodeAction",
    "resellerSignOutAction",
    "verifyAccessCodeAction",
    "logoutGateAction",
    "redeemAppHandoffAction",
    // platform operator
    "uploadBrandingAssetAction",
    "uploadStorefrontImageAsAdminAction",
    "removeBrandingAssetAction",
    "saveContactChannelsAction",
    "saveRequirePaymentProofAction",
    "saveNoticeModalGrantAction",
    "saveAdminFeeAction",
    "saveAdminPasswordAction",
    "saveGroupBuySettingsAction",
    "confirmSubscriptionPaymentAction",
    "rejectSubscriptionPaymentAction",
  ];
  await test("sign-in, shopper and platform-operator actions are never reachable", () => {
    for (const name of NEVER) {
      assert.equal(lookupAction(BRIDGED_ACTIONS, name), null, `call: ${name}`);
      assert.equal(lookupAction(FORM_ACTIONS, name), null, `upload: ${name}`);
    }
  });
  await test("only own properties resolve (no prototype names)", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      assert.equal(lookupAction(BRIDGED_ACTIONS, name), null, name);
      assert.equal(lookupAction(FORM_ACTIONS, name), null, name);
    }
    assert.equal(lookupAction(BRIDGED_ACTIONS, 42), null);
    assert.equal(lookupAction(BRIDGED_ACTIONS, undefined), null);
  });
  await test("FormData actions are only reachable through /admin/upload", () => {
    for (const name of Object.keys(FORM_ACTIONS)) assert.equal(lookupAction(BRIDGED_ACTIONS, name), null, name);
    assert.deepEqual(Object.keys(FORM_ACTIONS).sort(), ["uploadProductImageAction", "uploadStorefrontImageAction"]);
  });
  await test("every storefront-admin action is bridged unless deliberately excluded", () => {
    const excluded = new Set([
      "signOutStorefrontAdminAction",
      "hasStorefrontAdminSessionAction",
      "verifyResellerCodeAction",
      "resellerSignOutAction",
    ]);
    const missing = Object.entries(storefrontAdmin)
      .filter(([name, v]) => typeof v === "function" && !excluded.has(name))
      .map(([name]) => name)
      .filter((name) => !lookupAction(BRIDGED_ACTIONS, name));
    assert.deepEqual(missing, [], "a new storefront-admin action needs a bridge decision");
  });
  await test("the live group-buy strip is editable from the app's Group buys screen", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    assert.ok(lookupAction(BRIDGED_ACTIONS, "saveGroupBuyLiveBannerAction"), "saveGroupBuyLiveBannerAction not bridged");
    const settings = readFileSync("mobile/src/features/admin/group-buys/StoreSettings.tsx", "utf8");
    assert.ok(settings.includes('"saveGroupBuyLiveBannerAction"'), "Group buys settings never save the strip");
  });
  await test("customer-account admin actions are bridged (disable / re-enable in the app)", () => {
    for (const name of ["listStoreCustomersAction", "setStoreCustomerStatusAction", "resetStoreCustomerPasswordAction"]) {
      assert.ok(lookupAction(BRIDGED_ACTIONS, name), `${name} not bridged`);
    }
  });
  await test("the app's Trash and Customer accounts screens use only bridged actions", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const read = (f: string) => readFileSync(`mobile/src/app/(app)/${f}`, "utf8");
    const trash = read("manage/order-trash.tsx");
    for (const fn of ["listStorefrontOrdersAction", "restoreStorefrontOrdersAction", "purgeStorefrontOrdersAction"]) {
      assert.ok(trash.includes(`"${fn}"`), `trash screen doesn't call ${fn}`);
      assert.ok(lookupAction(BRIDGED_ACTIONS, fn), fn);
    }
    const accounts = read("manage/customer-accounts.tsx");
    assert.ok(accounts.includes('"setStoreCustomerStatusAction"'), "accounts screen can't disable/re-enable");
    assert.ok(accounts.includes('"resetStoreCustomerPasswordAction"'), "accounts screen can't reset a password");
    const layout = read("_layout.tsx");
    for (const r of ["manage/order-trash", "manage/customer-accounts"]) assert.ok(layout.includes(`name="${r}"`), `${r} not registered`);
    assert.ok(read("(tabs)/orders.tsx").includes('"/manage/order-trash"'), "Orders tab has no way into the Trash");
    assert.ok(read("customers.tsx").includes('"/manage/customer-accounts"'), "Customers has no way into accounts");
  });
  await test("the app's Manage Products can arrange the shop order (↑/↓, same list as the website)", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const hook = readFileSync("mobile/src/features/admin/catalog/arrange.ts", "utf8");
    assert.ok(lookupAction(BRIDGED_ACTIONS, "saveProductOrderAction"), "saveProductOrderAction not bridged");
    assert.ok(hook.includes('"saveProductOrderAction"'), "the arrangement hook never saves the order");
    assert.ok(hook.includes("moveProduct("), "the arrangement hook has no ↑/↓ move");
    // Arrows sit on every row of BOTH product screens (Products tab + Manage Products).
    for (const f of ["(tabs)/products.tsx", "manage/products.tsx"]) {
      const screen = readFileSync(`mobile/src/app/(app)/${f}`, "utf8");
      assert.ok(screen.includes("useProductArrangement()"), `${f} doesn't use the shop order`);
      assert.ok(/order=\{arrows \?/.test(screen), `${f} rows have no ↑/↓`);
    }
  });
  await test("long-pressing a product offers Delete (Products tab + Manage Products)", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const hook = readFileSync("mobile/src/features/admin/catalog/delete.ts", "utf8");
    assert.ok(hook.includes('"deleteProductsAction"') && lookupAction(BRIDGED_ACTIONS, "deleteProductsAction"), "delete not bridged");
    assert.ok(hook.includes('style: "destructive"'), "delete has no confirm");
    const tab = readFileSync("mobile/src/app/(app)/(tabs)/products.tsx", "utf8");
    assert.ok(/onLongPress=\{\(\) => del\.confirmDelete\(/.test(tab), "Products tab rows have no long-press delete");
    assert.ok(readFileSync("mobile/src/features/products/ProductItem.tsx", "utf8").includes("onLongPress={disabled ? undefined : onLongPress}"));
    const manage = readFileSync("mobile/src/app/(app)/manage/products.tsx", "utf8");
    assert.ok(manage.includes("onLongPress={busy ? undefined : onLongPress}"), "Manage Products rows have no long-press");
  });
  await test("the app's moveProduct matches the website's", () => {
    const web = require("../src/lib/storefront/product-order") as typeof import("../src/lib/storefront/product-order");
    // Untyped on purpose: the app's "@/" alias doesn't resolve in the web tsconfig.
    const app = require("../mobile/src/features/admin/catalog/model") as { moveProduct: typeof web.moveProduct };
    const order = ["a", "b", "c", "d"];
    for (const id of [...order, "zz"]) {
      for (const delta of [-5, -1, 0, 1, 5]) {
        assert.deepEqual(app.moveProduct(order, id, delta), web.moveProduct(order, id, delta), `${id} ${delta}`);
      }
    }
    assert.deepEqual(order, ["a", "b", "c", "d"], "input mutated");
  });
  await test("the tables are frozen", () => {
    assert.ok(Object.isFrozen(BRIDGED_ACTIONS));
    assert.ok(Object.isFrozen(FORM_ACTIONS));
  });

  const ctx = {
    tenantId: "tenant_1",
    slug: "demo",
    session: { id: "sess_1", tenantId: "tenant_1", subject: { kind: "owner" }, credentialStamp: "x" },
  } as unknown as MobileContext;
  await test("unknown fn → not_found (nothing runs)", async () => {
    assert.deepEqual(await runBridgedAction(ctx, "placeStorefrontOrderAction", []), { ok: false, reason: "not_found" });
    assert.deepEqual(await runBridgedAction(ctx, "nope", []), { ok: false, reason: "not_found" });
  });
  await test("args must be an array of at most MAX_BRIDGE_ARGS", async () => {
    const tooMany = Array.from({ length: MAX_BRIDGE_ARGS + 1 }, () => 1);
    assert.deepEqual(await runBridgedAction(ctx, "saveFaqAction", tooMany), { ok: false, reason: "invalid_args" });
    assert.deepEqual(await runBridgedAction(ctx, "saveFaqAction", { 0: 1 }), { ok: false, reason: "invalid_args" });
    assert.deepEqual(await runBridgedAction(ctx, "saveFaqAction", "x"), { ok: false, reason: "invalid_args" });
  });

  // ── actor scope ────────────────────────────────────────────────────────────
  section("app actor scope");
  await test("no scope outside runAsAppActor", () => {
    assert.equal(currentAppActorScope(), null);
  });
  await test("scope is visible across awaits inside, and gone after", async () => {
    const scope = { tenantId: "t1", slug: "one", subject: { kind: "owner" as const } };
    const seen = await runAsAppActor(scope, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentAppActorScope();
    });
    assert.deepEqual(seen, scope);
    assert.equal(currentAppActorScope(), null);
  });
  await test("concurrent scopes never leak into each other", async () => {
    const run = (tenantId: string, delay: number) =>
      runAsAppActor({ tenantId, slug: tenantId, subject: { kind: "staff", id: `s-${tenantId}` } }, async () => {
        await new Promise((r) => setTimeout(r, delay));
        return currentAppActorScope()?.tenantId;
      });
    const [a, b, c] = await Promise.all([run("A", 15), run("B", 1), run("C", 8)]);
    assert.deepEqual([a, b, c], ["A", "B", "C"]);
    assert.equal(currentAppActorScope(), null);
  });
  await test("a scope does not survive a thrown action", async () => {
    await assert.rejects(
      runAsAppActor({ tenantId: "t", slug: "t", subject: { kind: "owner" } }, async () => {
        throw new Error("boom");
      }),
    );
    assert.equal(currentAppActorScope(), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

void main();
