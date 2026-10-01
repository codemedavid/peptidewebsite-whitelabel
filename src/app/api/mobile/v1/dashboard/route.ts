import { buildDashboard } from "@/lib/mobile/dashboard";
import { ok, withMobile } from "@/lib/mobile/http";

// GET /api/mobile/v1/dashboard — the Home screen. Every section is filtered by
// this account's permissions inside buildDashboard.
export async function GET(req: Request) {
  return withMobile(req, { route: "dashboard" }, async (ctx) => ok(await buildDashboard(ctx)));
}
