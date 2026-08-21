import assert from "node:assert";
import { checkMcpAuth } from "../src/lib/mcp/auth";

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

const TOKEN = "a".repeat(64);
const OTHER = "b".repeat(64);
const URL_BASE = "https://app.pepweb.store/api/mcp";

async function main() {
  console.log("MCP connector authentication");

  await check("reports a server misconfiguration when no token is set", () => {
    const result = checkMcpAuth({ authorization: `Bearer ${TOKEN}`, url: URL_BASE }, {}, undefined);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /not configured on the server/);
  });

  await check("accepts a matching Authorization: Bearer header", () => {
    const result = checkMcpAuth({ authorization: `Bearer ${TOKEN}`, url: URL_BASE }, {}, TOKEN);
    assert.equal(result.ok, true);
  });

  // Vercel stores env values literally, so a value pasted with its .env quotes
  // would never match the clean token the connector sends.
  await check("tolerates a server token that was pasted with surrounding quotes", () => {
    for (const stored of [`"${TOKEN}"`, `'${TOKEN}'`, ` ${TOKEN}\n`]) {
      const result = checkMcpAuth({ authorization: `Bearer ${TOKEN}`, url: URL_BASE }, {}, stored);
      assert.equal(result.ok, true, `stored form ${JSON.stringify(stored)} should still authorize`);
    }
  });

  // A ChatGPT connector set to "No authentication" sends no Authorization header
  // at all, so the connector URL itself has to be able to carry the secret.
  await check("accepts a token carried on the connector URL when no header is sent", () => {
    for (const param of ["token", "adminToken", "key"]) {
      const result = checkMcpAuth({ authorization: null, url: `${URL_BASE}?${param}=${TOKEN}` }, {}, TOKEN);
      assert.equal(result.ok, true, `?${param}= should authorize`);
    }
  });

  await check("rejects a wrong token supplied on the connector URL", () => {
    const result = checkMcpAuth({ authorization: null, url: `${URL_BASE}?token=${OTHER}` }, {}, TOKEN);
    assert.equal(result.ok, false);
  });

  await check("still accepts the adminToken tool argument fallback", () => {
    const result = checkMcpAuth({ authorization: null, url: URL_BASE }, { adminToken: TOKEN }, TOKEN);
    assert.equal(result.ok, true);
  });

  await check("keeps the original rejection wording for existing callers", () => {
    const result = checkMcpAuth({ authorization: null, url: URL_BASE }, {}, TOKEN);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /^Invalid or missing MCP admin token\./);
  });

  await check("names every place it looked so a silent connector is diagnosable", () => {
    const result = checkMcpAuth({ authorization: null, url: URL_BASE }, {}, TOKEN);
    const message = result.ok ? "" : result.message;
    assert.match(message, /header: absent/);
    assert.match(message, /url: absent/);
    assert.match(message, /argument: absent/);
  });

  await check("fingerprints a mismatch so two deployments can be told apart", () => {
    const result = checkMcpAuth({ authorization: `Bearer ${OTHER}`, url: URL_BASE }, {}, TOKEN);
    const message = result.ok ? "" : result.message;
    assert.match(message, /header: present/);
    assert.match(message, /sent [0-9a-f]{8}/, "should fingerprint what arrived");
    assert.match(message, /expected [0-9a-f]{8}/, "should fingerprint what the server holds");
    assert.match(message, /64 chars/, "should report the supplied length");
  });

  await check("never echoes either secret back to an unauthenticated caller", () => {
    const result = checkMcpAuth({ authorization: `Bearer ${OTHER}`, url: `${URL_BASE}?token=${OTHER}` }, {}, TOKEN);
    const message = result.ok ? "" : result.message;
    assert.ok(!message.includes(TOKEN), "must not leak the server token");
    assert.ok(!message.includes(OTHER), "must not echo the supplied token");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
