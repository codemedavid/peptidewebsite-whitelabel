/**
 * Payment proofs open IN the website, cheaply.
 *   - the store (Members tab) and the member (join page) see the proof in the
 *     page's lightbox — never a new ImageKit tab;
 *   - the signed link is a viewer-sized render (w-1000, no upscale, f-auto),
 *     not the multi-MB original upload;
 *   - the link's expiry is snapped to a window, so repeat views return the SAME
 *     url and the browser serves the image from its cache;
 *   - the client holds the link for less time than it stays valid.
 *
 *   npm run test:paid-access-proof-view
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { alignedExpirySeconds, PROOF_VIEW_TRANSFORM } from "../src/lib/imagekit/signed-url";
import { cachedProofUrl, PROOF_URL_HOLD_MS, type ProofUrlResult } from "../src/modules/paid-access/ui/proof-url-cache";

// Fake keys: signing is pure HMAC, no network.
process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY ||= "public_test";
process.env.IMAGEKIT_PRIVATE_KEY ||= "private_test";
process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT ||= "https://ik.imagekit.io/test";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e instanceof Error ? e.message : String(e)}`);
  }
}

const TTL = 600;
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

async function main() {
  console.log("expiry alignment");
  await check("every call inside one window lands on the same expiry", () => {
    const base = 1_800_000_001_000; // 1s past a window boundary (1.8e9 s is a multiple of 600)
    const ends = [0, 1_000, 299_000, 599_000].map((dt) => Math.floor((base + dt) / 1000) + alignedExpirySeconds(TTL, base + dt));
    assert.equal(new Set(ends).size, 1, `got ${ends.join(",")}`);
  });
  await check("a link is always valid for at least the ttl, and under twice it", () => {
    for (let dt = 0; dt < TTL * 1000; dt += 7_919) {
      const s = alignedExpirySeconds(TTL, 1_800_000_000_000 + dt);
      assert.ok(s >= TTL && s < 2 * TTL, `${s}s at +${dt}ms`);
    }
  });

  console.log("signed receipt url");
  const { receiptUrl } = await import("../src/modules/paid-access/server/payments");
  await check("signs a viewer-sized render, not the original", () => {
    const u = receiptUrl("/tenant/acme/paid-access-receipts/r.png");
    assert.match(u, /\/tr:[^/]*w-1000/, u);
    assert.match(u, /c-at_max/, "never upscales a small screenshot");
    assert.match(u, /f-auto/, "AVIF/WebP where the browser takes it");
    assert.match(u, /ik-s=/, "still signed");
    assert.equal(PROOF_VIEW_TRANSFORM.width, 1000);
  });
  await check("two views a moment apart get the identical (cacheable) url", () => {
    const a = receiptUrl("/tenant/acme/paid-access-receipts/r.png");
    const b = receiptUrl("/tenant/acme/paid-access-receipts/r.png");
    assert.equal(a, b);
    const t = Number(new URL(a).searchParams.get("ik-t"));
    assert.equal(t % TTL, 0, `ik-t ${t} is on a window boundary`);
  });
  await check("inline dev/test receipts pass through untouched", () => {
    assert.equal(receiptUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  });

  console.log("client link cache");
  await check("a reopened proof reuses the held link — no second action", async () => {
    let calls = 0;
    const load = async (): Promise<ProofUrlResult> => ({ ok: true, url: `https://ik.imagekit.io/x?n=${++calls}` });
    const t0 = 1_000_000;
    const a = await cachedProofUrl("t:1", load, t0);
    const b = await cachedProofUrl("t:1", load, t0 + PROOF_URL_HOLD_MS - 1);
    assert.equal(calls, 1);
    assert.deepEqual(a, b);
    await cachedProofUrl("t:1", load, t0 + PROOF_URL_HOLD_MS);
    assert.equal(calls, 2, "refetches once the hold is up");
  });
  await check("a failure is never held", async () => {
    let calls = 0;
    const load = async (): Promise<ProofUrlResult> => (++calls === 1 ? { ok: false, message: "nope" } : { ok: true, url: "u" });
    assert.equal((await cachedProofUrl("t:2", load, 0)).ok, false);
    assert.equal((await cachedProofUrl("t:2", load, 1)).ok, true);
    assert.equal(calls, 2);
  });
  await check("the hold is shorter than the server's minimum validity", () => {
    assert.ok(PROOF_URL_HOLD_MS < TTL * 1000);
  });

  console.log("proof opens in the page");
  for (const file of ["src/modules/paid-access/ui/MemberCard.tsx", "src/modules/paid-access/ui/join-parts.tsx"]) {
    await check(`${file.split("/").pop()} shows the lightbox, never a new ImageKit tab`, () => {
      const s = src(file);
      assert.ok(!s.includes("window.open"), "still calls window.open");
      assert.ok(s.includes("<ProofLightbox"), "renders ProofLightbox");
      assert.ok(s.includes("cachedProofUrl("), "goes through the link cache");
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
