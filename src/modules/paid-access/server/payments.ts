import "server-only";

// Payment plumbing: the online-provider adapter and private receipt storage.
//
// Online payments are confirmed ONLY by a provider webhook whose signature
// verifies (webhook.ts) — never by the browser coming back from checkout.
// No real provider is connected yet (decision Q1): `onlineProvider()` returns
// the signed FAKE provider outside production when PAID_ACCESS_FAKE_PROVIDER_SECRET
// is set (tests, local dev), and null everywhere else, which keeps the
// "online" option greyed out in settings. A real provider (e.g. PayMongo)
// implements OnlineProvider and is returned from here.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isDemoMode } from "@/lib/demo/fixtures";
import { isImageKitConfigured, signedPrivateUrl, uploadPrivateTenantFile } from "@/lib/imagekit/server";
import { PROOF_VIEW_TRANSFORM } from "@/lib/imagekit/signed-url";
import { classifyProofFile } from "@/lib/upload/image-file";

export type WebhookEvent = {
  id: string;
  type: "payment.paid" | "payment.failed" | "refund.succeeded" | "refund.failed";
  /** The checkout/charge id we stored as PaidAccessPayment.providerRef. */
  ref: string;
  amountCents?: number;
  refundRef?: string;
};

export interface OnlineProvider {
  readonly name: string;
  createCheckout(input: { amountCents: number; currency: string; description: string; membershipId: string }): Promise<{ ref: string; url: string }>;
  /** The parsed event, or null when the signature doesn't verify. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
  /** Ask the provider to refund a charge; the outcome arrives by webhook. */
  refund(input: { ref: string; amountCents: number }): Promise<{ ok: true } | { ok: false; error: string }>;
}

const WEBHOOK_TYPES: ReadonlySet<string> = new Set(["payment.paid", "payment.failed", "refund.succeeded", "refund.failed"]);

/** HMAC-signed stand-in provider (tests + local dev only). */
function fakeProvider(secret: string): OnlineProvider {
  return {
    name: "fake",
    async createCheckout() {
      const ref = `fake_chk_${randomUUID()}`;
      return { ref, url: `https://fake-pay.invalid/checkout/${ref}` };
    },
    verifyWebhook(rawBody, headers) {
      const given = headers.get("x-paid-access-signature") ?? "";
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(given, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      try {
        const o = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: Record<string, unknown> };
        if (typeof o.id !== "string" || typeof o.type !== "string" || !WEBHOOK_TYPES.has(o.type)) return null;
        const d = o.data ?? {};
        if (typeof d.checkoutId !== "string") return null;
        return {
          id: o.id,
          type: o.type as WebhookEvent["type"],
          ref: d.checkoutId,
          amountCents: typeof d.amountCents === "number" ? d.amountCents : undefined,
          refundRef: typeof d.refundId === "string" ? d.refundId : undefined,
        };
      } catch {
        return null;
      }
    },
    async refund() {
      return { ok: true };
    },
  };
}

/** The store's online provider, or null when none is connected. */
export function onlineProvider(): OnlineProvider | null {
  const fakeSecret = process.env.PAID_ACCESS_FAKE_PROVIDER_SECRET;
  if (fakeSecret && process.env.NODE_ENV !== "production") return fakeProvider(fakeSecret);
  return null;
}

export function providerByName(name: string): OnlineProvider | null {
  const p = onlineProvider();
  return p && p.name === name ? p : null;
}

// ── Manual proof: the receipt image ──────────────────────────────────────────

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_URL_TTL_SECONDS = 10 * 60;

export function checkReceiptFile(file: unknown): { ok: true; file: File } | { ok: false; error: string } {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Add a screenshot of your payment." };
  if (file.size > MAX_RECEIPT_BYTES) return { ok: false, error: "That image is too large (max 10 MB)." };
  const verdict = classifyProofFile(file.name || "", file.type || "");
  if (!verdict.ok) return { ok: false, error: verdict.reason };
  return { ok: true, file };
}

/**
 * Store a receipt where only the uploader and the store's admins can read it
 * (ImageKit private file). Production refuses rather than fall back to
 * anything public; dev/tests/demo keep the image inline.
 */
export async function storeReceipt(tenantId: string, file: File): Promise<{ fileId: string | null; filePath: string }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  if (isDemoMode() || !isImageKitConfigured()) {
    if (process.env.NODE_ENV === "production" && !isDemoMode()) throw new Error("RECEIPT_STORAGE_UNAVAILABLE");
    return { fileId: null, filePath: `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}` };
  }
  return uploadPrivateTenantFile({
    tenantId,
    subfolder: "paid-access-receipts",
    file: bytes,
    fileName: `paid-access-receipt-${file.name || "image"}`.slice(0, 120),
    tags: ["paid-access-receipt"],
  });
}

/**
 * Signed, short-lived link for a stored receipt path (inline in dev/tests).
 * A viewer-sized render, not the original upload — the proof is shown in the
 * page's lightbox, so a phone screenshot costs ~100 kB instead of megabytes.
 */
export function receiptUrl(filePath: string): string {
  return filePath.startsWith("data:") ? filePath : signedPrivateUrl(filePath, RECEIPT_URL_TTL_SECONDS, PROOF_VIEW_TRANSFORM);
}
