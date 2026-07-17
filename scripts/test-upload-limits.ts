/**
 * Self-contained test for branding/storefront image upload limits (no DB, no Next):
 *
 *   Uploads travel as multipart/form-data through a Next server action, which
 *   enforces `experimental.serverActions.bodySizeLimit` BEFORE our own size
 *   check ever runs. If a declared per-file max is >= that body limit, files at
 *   the documented size are rejected by the framework with an opaque error —
 *   the user sees a hang, not "File too large".
 *
 *   src/lib/upload/limits.ts is the single source of truth: next.config.ts and
 *   the upload actions must both read from it, and every declared max must fit
 *   under the body limit *with multipart encoding overhead included*.
 *
 *   settleUpload() is the client-side guarantee that a thrown action can never
 *   leave the UI stuck on "Uploading…".
 *
 *   npm run test:upload-limits
 */

import assert from "node:assert";

import {
  SERVER_ACTION_BODY_LIMIT,
  SERVER_ACTION_BODY_LIMIT_BYTES,
  BRANDING_ASSET_MAX_BYTES,
  STOREFRONT_IMAGE_MAX_BYTES,
  encodedSize,
  fitsServerActionBody,
} from "../src/lib/upload/limits";
import { settleUpload, uploadErrorMessage } from "../src/lib/upload/settle";

// ──────────────────────────── tiny assertion harness ────────────────────────
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

async function main() {
  console.log("\nUpload limits — every declared max fits under the server-action body cap\n");

  // ───────────── the regression: limits must leave encoding headroom ─────────────
  await check("multipart encoding overhead is accounted for (encoded > raw)", () => {
    assert.ok(
      encodedSize(1_000_000) > 1_000_000,
      "encodedSize must add multipart boundary/header overhead on top of the file bytes",
    );
  });

  await check("a 2 MB logo fits under the configured body limit once encoded", () => {
    assert.ok(
      fitsServerActionBody(BRANDING_ASSET_MAX_BYTES),
      `a ${BRANDING_ASSET_MAX_BYTES}-byte logo encodes to ${encodedSize(
        BRANDING_ASSET_MAX_BYTES,
      )} bytes, which exceeds the ${SERVER_ACTION_BODY_LIMIT_BYTES}-byte body limit — ` +
        `Next rejects it before the action's own size check runs`,
    );
  });

  await check("the 10 MB storefront-image max is reachable, not dead code", () => {
    assert.ok(
      fitsServerActionBody(STOREFRONT_IMAGE_MAX_BYTES),
      `STOREFRONT_IMAGE_MAX_BYTES (${STOREFRONT_IMAGE_MAX_BYTES}) can never be hit: ` +
        `anything over the ${SERVER_ACTION_BODY_LIMIT_BYTES}-byte body limit dies first`,
    );
  });

  await check("body limit string and byte count agree", () => {
    const m = /^(\d+)mb$/.exec(SERVER_ACTION_BODY_LIMIT);
    assert.ok(m, `SERVER_ACTION_BODY_LIMIT must look like "12mb", got "${SERVER_ACTION_BODY_LIMIT}"`);
    assert.strictEqual(Number(m![1]) * 1024 * 1024, SERVER_ACTION_BODY_LIMIT_BYTES);
  });

  await check("next.config.ts reads the limit from the shared module (no drift)", async () => {
    const { default: config } = await import("../next.config");
    const configured = config.experimental?.serverActions?.bodySizeLimit;
    assert.strictEqual(
      configured,
      SERVER_ACTION_BODY_LIMIT,
      "next.config.ts hardcodes a body limit instead of importing SERVER_ACTION_BODY_LIMIT — " +
        "the two will drift and uploads will fail opaquely",
    );
  });

  // ───────────── the hang: settleUpload must never throw ─────────────
  await check("settleUpload returns the action result on success", async () => {
    const res = await settleUpload(async () => ({ url: "https://ik.imagekit.io/x/logo.png" }));
    assert.deepStrictEqual(res, { url: "https://ik.imagekit.io/x/logo.png" });
  });

  await check("settleUpload converts a thrown action into an error result (never rejects)", async () => {
    const res = await settleUpload<{ url: string }>(async () => {
      throw new Error("Body exceeded 2mb limit");
    });
    assert.ok("error" in res, "a thrown upload must resolve to { error }, not reject");
  });

  await check("settleUpload maps the opaque body-limit throw to a human message", async () => {
    const res = await settleUpload<{ url: string }>(async () => {
      throw new Error("Body exceeded 2mb limit");
    });
    assert.ok("error" in res && /too large/i.test(res.error), `got: ${JSON.stringify(res)}`);
  });

  await check("settleUpload survives a non-Error throw", async () => {
    const res = await settleUpload<{ url: string }>(async () => {
      throw "kaboom";
    });
    assert.ok("error" in res && res.error.length > 0);
  });

  await check("uploadErrorMessage never returns an empty string", () => {
    for (const thrown of [new Error(""), undefined, null, ""]) {
      assert.ok(uploadErrorMessage(thrown).length > 0, `empty message for ${String(thrown)}`);
    }
  });

  // ──────────────────────────── summary ────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
