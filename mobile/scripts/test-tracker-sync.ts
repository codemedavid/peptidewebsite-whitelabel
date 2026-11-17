// Unit tests for features/tracker/lib/sync-engine.ts against a fake server:
// refused records are counted (not silently lost), 413 / batch 4xx shrink the
// batch and drain the queue, a 404 stop clears when re-enabled, and a push
// never goes out (or lands) across an account switch. Run: npm run test:tracker
import assert from "node:assert/strict";
import { createTrackerSync, SYNC_BATCH, type SyncDeps, type SyncRequest, type SyncResponse, type SyncSnapshot } from "../src/features/tracker/lib/sync-engine";
import { DEFAULT_META, EMPTY_DATA, type OutboxOp, type TrackerData, type TrackerMeta } from "../src/features/tracker/lib/types";
import { dose } from "./tracker-fixtures";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message = `HTTP ${status}`,
  ) {
    super(message);
  }
}

type Answer = (req: SyncRequest) => SyncResponse | Promise<SyncResponse>;

/** A phone store + session + server, all in memory. */
function harness(opCount: number, answer: Answer = () => ({ pulled: [], cursor: "c1", rejected: [], hasMore: false })) {
  const doses = Array.from({ length: opCount }, (_, i) => ({ ...dose(new Date(2026, 9, 1, 8)), id: `d${i}` }));
  const outbox: OutboxOp[] = doses.map((d, i) => ({ id: `op${i}`, table: "dose", op: "upsert", recordId: d.id, at: d.updatedAt }));
  let state: SyncSnapshot = { scope: "alpha:customer:ann", isLoaded: true, outbox, data: { ...EMPTY_DATA, doses } as TrackerData, meta: DEFAULT_META };
  let gen = 1;
  const world = { session: "alpha:customer:ann" as string | null, sent: [] as SyncRequest[] };
  const deps: SyncDeps = {
    snapshot: () => state,
    generation: () => gen,
    ensureLoaded: async () => undefined,
    apply: (sentOpIds, data, meta: Partial<TrackerMeta>) => {
      const sent = new Set(sentOpIds);
      state = { ...state, outbox: state.outbox.filter((o) => !sent.has(o.id)), data: data ?? state.data, meta: { ...state.meta, ...meta } };
    },
    send: async (req) => {
      world.sent.push(req);
      return answer(req);
    },
    sessionScope: () => world.session,
    setTimer: () => null,
    clearTimer: () => undefined,
  };
  const switchAccount = (scope: string) => {
    gen += 1;
    state = { ...state, scope };
  };
  return { sync: createTrackerSync(deps), world, state: () => state, switchAccount };
}

async function main() {
  console.log("tracker sync engine");

  await test("records the server refuses leave the queue but are counted, with the reason and ids", async () => {
    const h = harness(3, (req) => ({ pulled: [], cursor: "c1", rejected: [{ kind: "dose", id: req.push[1].id, reason: "effects: too many" }], hasMore: false }));
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0);
    assert.equal(h.state().meta.rejectedCount, 1);
    assert.equal(h.state().meta.lastRejectReason, "effects: too many");
    assert.deepEqual(h.state().meta.rejectedIds, ["dose:d1"]);
    assert.equal(h.state().meta.cursor, "c1");
  });

  await test("413: the batch halves until it fits; everything still syncs", async () => {
    const h = harness(600, (req) => {
      if (req.push.length > 100) throw new HttpError(413, "Too large");
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0, `${h.state().outbox.length} left`);
    assert.equal(h.state().meta.rejectedCount, 0);
    assert.ok(h.world.sent.some((r) => r.push.length === 500));
    assert.ok(h.world.sent.every((r) => r.push.length <= SYNC_BATCH));
  });

  await test("a single record the server still won't take (413 at size 1) is refused, so the queue drains", async () => {
    const h = harness(4, (req) => {
      if (req.push.some((r) => r.id === "d2")) throw new HttpError(413, "Too large");
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0);
    assert.equal(h.state().meta.rejectedCount, 1);
    assert.deepEqual(h.state().meta.rejectedIds, ["dose:d2"]);
    assert.equal(h.state().meta.lastRejectReason, "too large to sync");
  });

  await test("a 400 batch shrinks down to 1, then that one op is refused (not retried forever)", async () => {
    const h = harness(2, (req) => {
      if (req.push.some((r) => r.id === "d0")) throw new HttpError(400, "The sync request couldn't be read.");
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0);
    assert.deepEqual(h.state().meta.rejectedIds, ["dose:d0"]);
    assert.equal(h.state().meta.lastRejectReason, "The sync request couldn't be read.");
  });

  await test("429 / 5xx / offline are not the batch's fault: nothing is refused, everything waits", async () => {
    for (const status of [429, 500, 0, 401]) {
      const h = harness(2, () => {
        throw new HttpError(status);
      });
      await h.sync.sync();
      assert.equal(h.state().outbox.length, 2, `status ${status}`);
      assert.equal(h.state().meta.rejectedCount, 0);
      assert.equal(h.world.sent.length, 1, `status ${status}: one try, then backoff`);
    }
  });

  await test("404 stops sync for the account; re-enabling the runtime (same scope) clears it", async () => {
    let revoked = true;
    const h = harness(1, () => {
      if (revoked) throw new HttpError(404, "Not found");
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    assert.ok(h.sync.isDisabled());
    revoked = false;
    await h.sync.sync();
    assert.equal(h.world.sent.length, 1, "stopped: no request while disabled");
    h.sync.setEnabled(false);
    h.sync.setEnabled(true);
    assert.ok(!h.sync.isDisabled());
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0);
  });

  await test("a /me that still grants the tracker revives a 404 stop and syncs", async () => {
    let revoked = true;
    const h = harness(1, () => {
      if (revoked) throw new HttpError(404);
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    assert.ok(h.sync.isDisabled());
    revoked = false;
    h.sync.revive();
    await h.sync.sync();
    assert.ok(!h.sync.isDisabled());
    assert.equal(h.state().outbox.length, 0);
  });

  await test("signed-in session no longer matches the store: nothing is sent", async () => {
    const h = harness(2);
    h.world.session = "alpha:customer:bob";
    await h.sync.sync();
    assert.equal(h.world.sent.length, 0);
    assert.equal(h.state().outbox.length, 2);
  });

  await test("account switched while the request ran: the answer is discarded, the outbox kept", async () => {
    let h: ReturnType<typeof harness> | null = null;
    h = harness(2, () => {
      h!.switchAccount("alpha:customer:bob");
      h!.world.session = "alpha:customer:bob";
      return { pulled: [], cursor: "bob-cursor", rejected: [{ kind: "dose", id: "d0", reason: "x" }], hasMore: false };
    });
    await h.sync.sync();
    assert.equal(h.world.sent.length, 1);
    assert.equal(h.state().outbox.length, 2);
    assert.equal(h.state().meta.cursor, null);
    assert.equal(h.state().meta.rejectedCount, 0);
  });

  await test("the batch grows back after a shrink, never past SYNC_BATCH", async () => {
    let fail = true;
    const h = harness(3, () => {
      if (fail) {
        fail = false;
        throw new HttpError(413);
      }
      return { pulled: [], cursor: "c", rejected: [], hasMore: false };
    });
    await h.sync.sync();
    assert.equal(h.state().outbox.length, 0);
    assert.ok(h.sync.batchSize() <= SYNC_BATCH && h.sync.batchSize() >= 2);
    h.sync.reset();
    assert.equal(h.sync.batchSize(), SYNC_BATCH);
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
