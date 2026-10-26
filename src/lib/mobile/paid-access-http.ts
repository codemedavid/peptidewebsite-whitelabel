import { fail, ok } from "./http";
import type { GroupBuyJoinResult } from "./shop-contract";

// HTTP shape for Paid Access join results (app routes /shop/group-buy/*). The app's
// error codes are a fixed set, so Paid Access's finer codes ride along as `reason`.

const HTTP_CODE = {
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  invalid_input: "invalid_input",
  not_found: "not_found",
  conflict: "conflict",
  closed: "conflict",
  full: "conflict",
  unavailable: "store_unavailable",
  rate_limited: "rate_limited",
  server_error: "server_error",
} as const;

export function respond(result: GroupBuyJoinResult) {
  if (!result.ok) return fail(HTTP_CODE[result.code], result.message, { reason: result.code });
  return ok(result.checkout ? { ...result.state, checkout: result.checkout } : result.state);
}
