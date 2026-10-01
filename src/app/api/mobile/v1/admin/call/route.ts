import { fail, ok, withMobile } from "@/lib/mobile/http";
import { MAX_CALL_BODY_BYTES, runBridgedAction } from "@/lib/mobile/admin-bridge";

const TOO_LARGE = "That's too much to save at once.";

// POST /api/mobile/v1/admin/call  { fn, args[] } — run one allowlisted website
// store-admin action as this user (lib/mobile/admin-bridge.ts). `data` is the
// action's own return value, e.g. { ok: true } or { error: "…" }.
export async function POST(req: Request) {
  return withMobile(req, { route: "admin/call" }, async (ctx) => {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_CALL_BODY_BYTES) return fail("invalid_input", TOO_LARGE);

    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_CALL_BODY_BYTES) return fail("invalid_input", TOO_LARGE);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail("invalid_input", "Malformed request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_input", "Malformed request.");

    const { fn, args } = body as { fn?: unknown; args?: unknown };
    const res = await runBridgedAction(ctx, fn, args);
    if (!res.ok) {
      return res.reason === "not_found"
        ? fail("not_found", "This action isn't available in the app.")
        : fail("invalid_input", "Malformed request.");
    }
    return ok(res.data ?? null);
  });
}
