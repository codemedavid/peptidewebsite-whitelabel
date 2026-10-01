import "server-only";

import type { NextResponse } from "next/server";
import { fail, ok } from "@/lib/mobile/http";
import type { Outcome } from "./messages.server";

/** Map a community service outcome onto the mobile API envelope. */
export function respond<T>(outcome: Outcome<T>, notFound = "This chat isn't available."): NextResponse {
  switch (outcome.kind) {
    case "ok":
      return ok(outcome.value);
    case "invalid":
      return fail("invalid_input", outcome.message);
    case "forbidden":
      return fail("forbidden", outcome.message);
    default:
      return fail("not_found", notFound);
  }
}
