import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/rate-limit";
import { readCappedJson } from "@/lib/tracker/body";
import { withTracker } from "@/lib/tracker/http";
import { MAX_SYNC_BODY_BYTES, MAX_PUSH_RECORDS, parseSyncRequest } from "@/lib/tracker/records";
import { syncTracker } from "@/lib/tracker/sync.server";

const TEN_MIN = 10 * 60 * 1000;
/** Generous: the outbox syncs after edits and pages through `hasMore`. */
const MAX_SYNCS = 300;

// POST /api/mobile/v1/tracker/sync  TrackerSyncRequest → TrackerSyncResponse
// Any signed-in account — its OWN tracker — tracker granted (lib/tracker/http.ts). Push the phone's
// changes and pull everything newer than `cursor` in one round trip. Pushes are
// idempotent on (kind, id); bad records come back in `rejected`, never a 400.
// The body is capped at MAX_SYNC_BODY_BYTES before it is parsed: over it is a
// 413 (same error envelope) and the app halves its batch and retries.
export async function POST(req: Request) {
  return withTracker(req, { route: "tracker/sync" }, async (ctx) => {
    if (!rateLimit(`mobile:tracker-sync:${ctx.sessionId}`, MAX_SYNCS, TEN_MIN).ok) {
      return fail("rate_limited", "Syncing too often. Try again in a few minutes.");
    }
    const read = await readCappedJson(req, MAX_SYNC_BODY_BYTES);
    if (!read.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "invalid_input", message: `Too much to sync at once. Send fewer than ${MAX_PUSH_RECORDS} changes per sync.` } },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = parseSyncRequest(read.body);
    if (!parsed.ok) return fail("invalid_input", parsed.message);
    return ok(await syncTracker(ctx.tenantId, ctx.owner, parsed));
  });
}
