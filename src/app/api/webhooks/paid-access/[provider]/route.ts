import { NextResponse } from "next/server";
import { handleWebhook } from "@/modules/paid-access";

// Online-payment webhooks for Paid Access (src/modules/paid-access/server/webhook.ts).
// The provider's signature is verified against the RAW body, so it is read as
// text — never parsed and re-serialised first. Idempotent: a re-delivered event
// is acknowledged and does nothing.
//   POST /api/webhooks/paid-access/<provider>

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const rawBody = await req.text();
  try {
    const res = await handleWebhook({ provider, rawBody, headers: req.headers });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.message }, { status: res.status });
    return NextResponse.json({ ok: true, duplicate: res.duplicate ?? false });
  } catch (e) {
    // 500 → the provider retries later; the event row rolled back with the transaction.
    console.error(`[paid access] webhook failed: ${e instanceof Error ? e.name : "Error"}`);
    return NextResponse.json({ ok: false, error: "Webhook processing failed." }, { status: 500 });
  }
}
