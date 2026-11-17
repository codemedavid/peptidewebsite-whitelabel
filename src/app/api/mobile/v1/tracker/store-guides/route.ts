import { ok } from "@/lib/mobile/http";
import { withTracker } from "@/lib/tracker/http";
import { toStoreGuides } from "@/lib/tracker/store-guides";

// GET /api/mobile/v1/tracker/store-guides → { guides: TrackerStoreGuide[] }
// The store's written Protocols, for "Start from the store's guide". Needs the
// tracker AND guide import (which itself needs Protocols); 404 otherwise.
export async function GET(req: Request) {
  return withTracker(req, { route: "tracker/store-guides", guideImport: true }, async (ctx) =>
    ok({ guides: toStoreGuides(ctx.tenant.branding?.config) }),
  );
}
