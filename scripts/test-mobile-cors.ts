// Self-contained test gate for the mobile API CORS rule
// (src/lib/mobile/cors.ts). The Expo WEB build runs on a localhost origin and
// calls /api/mobile/v1 cross-origin; without these headers the browser blocks
// the request, fetch() throws, and the app shows "Can't reach the server".
// Native apps never send an Origin, so they are untouched. Pure — no DB.
//
//   npm run test:mobile-cors

import { mobileCorsHeaders } from "../src/lib/mobile/cors";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) return;
  failures++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

const API = "/api/mobile/v1/auth/login";

// Dev origins get their own origin echoed back.
for (const origin of [
  "http://localhost:8092",
  "http://localhost:8081",
  "http://127.0.0.1:19006",
  "http://192.168.1.20:8081",
  "http://10.0.0.5:8081",
  "http://lvh.me:8081",
]) {
  const h = mobileCorsHeaders(API, origin);
  ok(`allows ${origin}`, h?.["Access-Control-Allow-Origin"] === origin, JSON.stringify(h));
  ok(`allows Authorization header for ${origin}`, !!h?.["Access-Control-Allow-Headers"]?.includes("Authorization"));
  ok(`never allows credentials for ${origin}`, h?.["Access-Control-Allow-Credentials"] === undefined);
}

// Anything else gets nothing.
ok("no Origin (native app) → no headers", mobileCorsHeaders(API, null) === null);
ok("foreign site → no headers", mobileCorsHeaders(API, "https://evil.example") === null);
ok("lookalike host → no headers", mobileCorsHeaders(API, "http://localhost.evil.example") === null);
ok("public IP → no headers", mobileCorsHeaders(API, "http://8.8.8.8:8081") === null);
ok("garbage origin → no headers", mobileCorsHeaders(API, "not a url") === null);
ok("other API path → no headers", mobileCorsHeaders("/api/imagekit/auth", "http://localhost:8092") === null);
ok("page path → no headers", mobileCorsHeaders("/admin", "http://localhost:8092") === null);
ok("prefix lookalike path → no headers", mobileCorsHeaders("/api/mobile/v10/x", "http://localhost:8092") === null);

if (failures) {
  console.error(`\n${failures}/${checks} checks failed`);
  process.exit(1);
}
console.log(`✓ mobile CORS: ${checks} checks passed`);
