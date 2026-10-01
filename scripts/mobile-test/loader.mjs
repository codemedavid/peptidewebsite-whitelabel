// Module hooks for scripts/test-mobile-api.ts — lets the REAL mobile route
// handlers run in plain Node (outside a Next server) by swapping four Next
// runtime modules for tiny stubs. Nothing else is stubbed: Prisma, withTenant,
// auth, the order engine and the push fan-out all run for real (against PGlite).
//
//   next/cache    → unstable_cache runs the function; revalidate* are recorded no-ops
//   next/server   → real NextResponse; after() queues the callback for the test to flush
//   next/headers  → a fixed request header set (x-forwarded-for)
//   server-only   → empty (Next normally aliases it internally)
//
// registerHooks (synchronous) covers both require() — which tsx emits for this
// CommonJS package — and import.
import { registerHooks } from "node:module";

const STUBS = {
  "next/cache": "./stubs/next-cache.mjs",
  "next/server": "./stubs/next-server.mjs",
  "next/headers": "./stubs/next-headers.mjs",
  "server-only": "./stubs/server-only.mjs",
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = STUBS[specifier];
    if (stub) return { url: new URL(stub, import.meta.url).href, format: "module", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
