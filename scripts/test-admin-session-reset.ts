/**
 * Tests for the store-admin session reset core — src/lib/auth/admin-session-reset.ts.
 *
 * Requirement: the `#admin` store admin must log out on EVERY page refresh. The
 * storefront is a hash-routed SPA, so "a refresh" is precisely "a top-level
 * document load" — once the SPA is booted, all admin work happens over server
 * actions and RSC fetches, which must NOT log you out mid-task.
 *
 * Server Components can't delete cookies, so the kill happens in middleware. The
 * whole risk therefore lives in one predicate: telling a real document load apart
 * from the SPA's own traffic. Get it wrong in one direction and refreshing keeps
 * you signed in (the bug we're fixing); get it wrong in the other and every save
 * signs you out.
 *
 * The discriminator deliberately does NOT rely on `Sec-Fetch-Dest`: Safari < 16.4
 * omits the whole Sec-Fetch-* family, and treating "header missing" as "document"
 * would sign those users out on every server action. Next's own RSC/Action
 * headers are present on every client, so they're the signal we key on.
 *
 *   npm run test:admin-session-reset
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isDocumentLoad,
  shouldClearStoreAdminSession,
  type ClearDecisionInput,
} from "../src/lib/auth/admin-session-reset";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    });
}

const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

/** A browser hitting F5 on the storefront while holding an admin session. */
const refresh = (over: Partial<ClearDecisionInput> = {}): ClearDecisionInput => ({
  method: "GET",
  accept: HTML_ACCEPT,
  rsc: null,
  nextAction: null,
  secPurpose: null,
  pathname: "/",
  isTenantStorefrontHost: true,
  hasAdminSessionCookie: true,
  ...over,
});

async function main() {
  console.log("\nStore-admin session reset core\n");

  /* ── the behavior being bought: a refresh signs you out ── */

  await check("a top-level document load clears the admin session", () => {
    assert.equal(shouldClearStoreAdminSession(refresh()), true);
  });

  await check("a deep-linked refresh straight to #admin also clears", () => {
    // The hash never reaches the server, so the request looks like any other
    // document load for "/" — it must still clear.
    assert.equal(shouldClearStoreAdminSession(refresh({ pathname: "/" })), true);
  });

  /* ── the counterweight: SPA traffic must NEVER sign you out ── */

  await check("a server action (Next-Action POST) does NOT clear", () => {
    const save = refresh({
      method: "POST",
      accept: "text/x-component",
      nextAction: "7f3a9c1e2b",
    });
    assert.equal(shouldClearStoreAdminSession(save), false);
  });

  await check("an RSC navigation (RSC: 1) does NOT clear", () => {
    const nav = refresh({ accept: "text/x-component", rsc: "1" });
    assert.equal(shouldClearStoreAdminSession(nav), false);
  });

  await check("an RSC request that still advertises HTML does NOT clear", () => {
    // Belt-and-braces: the RSC header wins over a permissive Accept, so a
    // client that sends `*/*` alongside RSC: 1 can't be mistaken for a refresh.
    const nav = refresh({ accept: HTML_ACCEPT, rsc: "1" });
    assert.equal(shouldClearStoreAdminSession(nav), false);
  });

  await check("a JSON fetch (gate heartbeat) does NOT clear", () => {
    const beat = refresh({ accept: "application/json", pathname: "/api/gate/session" });
    assert.equal(shouldClearStoreAdminSession(beat), false);
  });

  await check("a same-origin image/asset request does NOT clear", () => {
    assert.equal(
      shouldClearStoreAdminSession(refresh({ accept: "image/avif,image/webp,*/*" })),
      false,
    );
  });

  await check("a HEAD probe does NOT clear", () => {
    assert.equal(shouldClearStoreAdminSession(refresh({ method: "HEAD" })), false);
  });

  await check("a request with no Accept header does NOT clear", () => {
    // curl/monitors/odd clients: not a browser navigation, so leave the session
    // alone rather than signing the owner out from a background probe.
    assert.equal(shouldClearStoreAdminSession(refresh({ accept: null })), false);
  });

  await check("a speculative prefetch does NOT clear", () => {
    // Chrome/Safari prefetch a document the user may never visit. Killing the
    // session there would log the owner out from a link they merely hovered.
    assert.equal(shouldClearStoreAdminSession(refresh({ secPurpose: "prefetch" })), false);
    assert.equal(
      shouldClearStoreAdminSession(refresh({ secPurpose: "prefetch;anonymous-client-ip" })),
      false,
    );
  });

  /* ── scope: only the tenant storefront, only when there's something to clear ── */

  await check("no Set-Cookie churn when there is no admin session cookie", () => {
    // Every public storefront view is a document load. Emitting Set-Cookie on
    // all of them would make the storefront uncacheable for anonymous shoppers.
    assert.equal(shouldClearStoreAdminSession(refresh({ hasAdminSessionCookie: false })), false);
  });

  await check("the platform admin / apex hosts are untouched", () => {
    assert.equal(shouldClearStoreAdminSession(refresh({ isTenantStorefrontHost: false })), false);
  });

  await check("API routes are untouched even on a tenant host", () => {
    assert.equal(shouldClearStoreAdminSession(refresh({ pathname: "/api/imagekit/auth" })), false);
    assert.equal(shouldClearStoreAdminSession(refresh({ pathname: "/api" })), false);
  });

  await check("the platform tenant login at /admin is untouched", () => {
    // That surface is the separate `tenant_admin_session` cookie — out of scope.
    assert.equal(shouldClearStoreAdminSession(refresh({ pathname: "/admin" })), false);
  });

  /* ── header parsing robustness ── */

  await check("header casing and whitespace don't change the verdict", () => {
    assert.equal(
      isDocumentLoad({
        method: "get",
        accept: "TEXT/HTML",
        rsc: null,
        nextAction: null,
        secPurpose: null,
      }),
      true,
    );
    assert.equal(
      isDocumentLoad({
        method: "GET",
        accept: HTML_ACCEPT,
        rsc: null,
        nextAction: null,
        secPurpose: " PREFETCH ",
      }),
      false,
    );
  });

  await check("isDocumentLoad is the sole gate — it agrees with the decision", () => {
    const doc = refresh();
    assert.equal(isDocumentLoad(doc), true);
    assert.equal(isDocumentLoad({ ...doc, nextAction: "abc" }), false);
  });

  /* ── integration guards: a tested core that was never wired up is still a bug ── */

  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  await check("middleware actually calls the reset on tenant responses", () => {
    const src = read("src/middleware.ts");
    assert.match(src, /admin-session-reset/, "middleware must import the reset module");
    assert.match(
      src,
      /clearStoreAdminSessionOnDocumentLoad\s*\(/,
      "middleware must invoke clearStoreAdminSessionOnDocumentLoad on the response",
    );
  });

  await check("the client no longer trusts a stale sessionStorage auth flag", () => {
    // sessionStorage survives a refresh, so any optimistic read of it would flash
    // the admin UI for a session the server has already killed.
    const src = read("src/storefront/StorefrontApp.tsx");
    assert.doesNotMatch(
      src,
      /sessionStorage\.getItem\(\s*ADMIN_AUTH_KEY/,
      "StorefrontApp must not optimistically trust the sessionStorage admin flag",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
