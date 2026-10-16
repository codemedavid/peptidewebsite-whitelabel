import { previewPolicyResponse, savePreviewPolicy } from "@/lib/community/preview.server";
import { fail, ok, readJson, withCommunity } from "@/lib/mobile/http";

// GET /api/mobile/v1/community/preview → PreviewPolicyResponse
// PATCH { enabled?, messageStore?, showPrices?, placeOrders?, viewGroupBuys?, joinGroupBuys?, useTracker? }
// What customers the store hasn't approved yet may do (lib/community/preview.ts). Moderators: the store team and community admins.
export async function GET(req: Request) {
  return withCommunity(req, { route: "community/preview", moderator: true }, async (actor) => ok(previewPolicyResponse(actor)));
}

export async function PATCH(req: Request) {
  return withCommunity(req, { route: "community/preview:patch", moderator: true }, async (actor) => {
    const body = await readJson(req);
    if (!body) return fail("invalid_input", "Nothing to save.");
    const res = await savePreviewPolicy(actor, body);
    return res.ok ? ok(res.value) : fail("invalid_input", res.error);
  });
}
