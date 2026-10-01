import { buildMe } from "@/lib/mobile/branding";
import { ok, withSession } from "@/lib/mobile/http";

// GET /api/mobile/v1/me → store, mode, actor, permissions, community and the
// tenant theme — for the store team AND for customers (the app picks its tab
// set from `mode`). The app calls this on launch and on every return to the
// foreground; the theme's `version` tells it whether the website's branding changed.
export async function GET(req: Request) {
  return withSession(req, { route: "me" }, async (principal) => ok(await buildMe(principal)));
}
