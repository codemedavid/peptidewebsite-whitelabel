import { uploadPaymentProofAction } from "@/actions/orders";
import { customerPreview } from "@/lib/community/preview.server";
import { previewCanOrder } from "@/lib/community/preview";
import { PREVIEW_LOCKED_MESSAGE } from "@/lib/mobile/contract";
import { fail, ok, withCustomer } from "@/lib/mobile/http";
import { asShopper } from "@/lib/mobile/shop";
import { rateLimit } from "@/lib/security/rate-limit";

const TEN_MIN = 10 * 60 * 1000;
const MAX_UPLOADS = 20;

// POST /api/mobile/v1/shop/proof  multipart { file } → ShopProofResponse
// The website's proof upload (image ≤ 10 MB, stored in the store's own media
// folder), run as the signed-in customer.
export async function POST(req: Request) {
  return withCustomer(req, { route: "shop/proof" }, async (ctx) => {
    if (!rateLimit(`mobile:shop-proof:${ctx.session.id}`, MAX_UPLOADS, TEN_MIN).ok) {
      return fail("rate_limited", "Too many uploads. Try again in a few minutes.");
    }
    const preview = await customerPreview(ctx);
    if (preview && !previewCanOrder(preview)) return fail("forbidden", PREVIEW_LOCKED_MESSAGE);
    const form = await req.formData().catch(() => null);
    if (!form) return fail("invalid_input", "Choose a photo of your payment.");
    const store = { tenantId: ctx.tenantId, slug: ctx.slug, customer: ctx };
    const result = await asShopper(store, () => uploadPaymentProofAction(form));
    return "url" in result ? ok({ url: result.url }) : fail("invalid_input", result.error);
  });
}
