/**
 * Tenant setup smoke tests for the operator/MCP-ready provisioning path.
 *
 * These intentionally avoid a live DB/ImageKit connection. The executable write
 * path is in src/lib/tenant/setup.ts; here we verify the pure hero copy contract
 * and the structural asset hooks that make a one-call setup possible.
 *
 *   npx tsx scripts/test-tenant-setup.ts
 */

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeHeroContent } from "../src/lib/storefront/hero-content";
import { POST } from "../src/app/api/mcp/route";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

console.log("normalizeHeroContent");

check("trims and maps the six stored hero copy fields", () => {
  assert.deepEqual(normalizeHeroContent({
    heroChipLabel: "  New  ",
    heroLine1: "  Brand  ",
    heroLine2: "  Shop  ",
    heroSub: "  Fast checkout  ",
    heroCta1: "  Buy  ",
    heroCta2: "  Learn  ",
  }), {
    heroChipLabel: "New",
    heroLine1: "Brand",
    heroLine2: "Shop",
    heroSub: "Fast checkout",
    heroCta1: "Buy",
    heroCta2: "Learn",
  });
});

check("headline/CTA fields cap at 120 characters", () => {
  assert.equal(normalizeHeroContent({ heroLine1: "x".repeat(200) }).heroLine1.length, 120);
  assert.equal(normalizeHeroContent({ heroCta1: "x".repeat(200) }).heroCta1.length, 120);
});

check("heroSub gets the longer 400 character cap", () => {
  assert.equal(normalizeHeroContent({ heroSub: "x".repeat(500) }).heroSub.length, 400);
});

console.log("tenant setup structure");
const setup = read("src/lib/tenant/setup.ts");
const action = read("src/actions/tenant-setup.ts");
const storeAdmin = read("src/actions/storefront-admin.ts");
const mcpRoute = read("src/app/api/mcp/route.ts");

check("setup exposes a single createTenantWithSetup write path", () => {
  assert.ok(setup.includes("export async function createTenantWithSetup"));
});

check("setup handles logo, favicon, default product image, and hero image assets", () => {
  for (const token of [
    'uploadBrandingAsset(tenant.id, "logo"',
    'uploadBrandingAsset(tenant.id, "favicon"',
    'uploadBrandingAsset(tenant.id, "defaultProductImage"',
    "resolveHeroImage(tenant.id",
  ]) {
    assert.ok(setup.includes(token), `missing ${token}`);
  }
});

check("default product image is merged into branding.config", () => {
  assert.ok(setup.includes("applyDefaultProductImage"));
});

check("hero copy, hero links, and hero media share the storefront normalizers", () => {
  for (const token of ["normalizeHeroContent", "normalizeHeroLinks", "normalizeHeroMedia"]) {
    assert.ok(setup.includes(token), `setup missing ${token}`);
  }
});

check("store-admin action uses the same hero copy normalizer", () => {
  assert.ok(storeAdmin.includes('import { normalizeHeroContent } from "@/lib/storefront/hero-content"'));
});

check("server action wrapper enforces platform operator auth", () => {
  assert.ok(action.includes("getPlatformUser"));
  assert.ok(action.includes("FORBIDDEN"));
});

check("MCP endpoint exposes the create tenant tool", () => {
  assert.ok(mcpRoute.includes("create_whitelabel_tenant"));
  assert.ok(mcpRoute.includes("tools/list"));
  assert.ok(mcpRoute.includes("tools/call"));
});

async function mcpPost(body: unknown) {
  const res = await POST(
    new Request("https://app.pepweb.store/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
  assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
  return res.json() as Promise<Record<string, unknown>>;
}

console.log("MCP scan flow");

async function main() {
  await checkAsync("initialize returns tools capability", async () => {
    const json = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    });
    const result = json.result as Record<string, unknown>;
    const capabilities = result.capabilities as Record<string, unknown>;
    assert.ok(capabilities.tools, "initialize result does not declare tools");
  });

  await checkAsync("tools/list returns create_whitelabel_tenant schema", async () => {
    const json = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const result = json.result as { tools?: { name?: string; inputSchema?: unknown }[] };
    assert.equal(result.tools?.[0]?.name, "create_whitelabel_tenant");
    assert.ok(result.tools?.[0]?.inputSchema, "tool is missing inputSchema");
  });

  if (failed) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
