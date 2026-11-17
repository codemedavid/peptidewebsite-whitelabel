// Reads a JSON request body with a hard byte cap, BEFORE parsing it: a declared
// Content-Length over the cap is refused at once, and a streamed body is cut
// off as soon as it passes the cap (never buffered whole). Plain Web APIs, no
// Next, so the API test runs it for real.

export type CappedBody = { ok: true; body: Record<string, unknown> | null } | { ok: false; reason: "too_large" };

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The JSON object in the body (null when absent or malformed), or too_large past `maxBytes`. */
export async function readCappedJson(req: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: true, body: null };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(concat(chunks, size)));
    return { ok: true, body: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null };
  } catch {
    return { ok: true, body: null };
  }
}
