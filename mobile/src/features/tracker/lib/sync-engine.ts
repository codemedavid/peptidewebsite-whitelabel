/**
 * The tracker's sync loop without the app around it — no React Native, no API
 * client — so mobile/scripts/test-tracker-sync.ts can drive it against a fake
 * server. features/tracker/sync.ts wires it to the real store and API.
 *
 * - The outbox goes up to POST /tracker/sync (≤ SYNC_BATCH per call) and
 *   everything newer than the cursor comes back, in one round trip; it loops
 *   while the server says `hasMore` or more of the outbox is waiting.
 * - An entry leaves the outbox only once the server answered for it, so
 *   nothing is lost offline; network / 5xx errors keep it and retry with backoff.
 * - Records the server refuses (`rejected`) leave the outbox too (they'd fail
 *   the same way again) but are COUNTED in meta (rejectedCount, the last
 *   reason, their ids), so the UI can say "N changes couldn't sync".
 * - 413 / other 4xx about the batch (not 401/403/404/408/429): the batch is
 *   halved and retried; a single record the server still won't take is
 *   refused like above, so the queue always drains.
 * - 404 (tracker grant off) / 403 (not a customer session): sync stops
 *   quietly for this account until it is re-enabled, revived, or the scope changes.
 * - Never one account's records on another's session: the store's scope, its
 *   generation and the signed-in session's scope are checked right before the
 *   request goes out and again on the answer (a changed one drops it unsent /
 *   unapplied; the outbox keeps everything for the right account).
 */
import { applyPulled, LIST_OF, settingsRecord, toSyncRecord, tombstoneRecord, type ListKind, type SyncRecord } from "./merge";
import { MAX_REJECTED_IDS, type OutboxOp, type TrackerData, type TrackerMeta } from "./types";

export const SYNC_BATCH = 500;
/** One sync never loops forever (a server that keeps saying hasMore). */
const MAX_ROUNDS = 20;
/** Halvings + single-record refusals per sync run (log2(500) ≈ 9, with room to drain a few). */
const MAX_SHRINKS = 24;
const FLUSH_DELAY_MS = 2000;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 5 * 60_000;
const MAX_REASON = 200;
/** 4xx answers that are about the session or the server, not the batch: never shrink or refuse on these. */
const NOT_BATCH_PROBLEMS: ReadonlySet<number> = new Set([401, 403, 404, 408, 429]);

/** What the loop reads from the phone store. */
export interface SyncSnapshot {
  scope: string | null;
  isLoaded: boolean;
  outbox: readonly OutboxOp[];
  data: TrackerData;
  meta: TrackerMeta;
}

export interface SyncRequest {
  cursor: string | null;
  push: SyncRecord[];
}

/** The server's answer, unchecked (every field is read defensively). */
export interface SyncResponse {
  pulled?: unknown;
  cursor?: unknown;
  rejected?: unknown;
  hasMore?: unknown;
}

export interface SyncDeps {
  snapshot(): SyncSnapshot;
  /** Bumped by the store on every scope change. */
  generation(): number;
  ensureLoaded(): Promise<void>;
  /** One write: drop `sentOpIds` from the outbox, replace data (when merged), patch meta. */
  apply(sentOpIds: readonly string[], data: TrackerData | null, meta: Partial<TrackerMeta>): void;
  send(req: SyncRequest): Promise<SyncResponse>;
  /** The signed-in session's scope as the app last saw it (null = signed out / tracker off). */
  sessionScope(): string | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => Date;
}

/** The HTTP status on an API error (0 for network failures), null when there is none. */
export function statusOf(e: unknown): number | null {
  if (!e || typeof e !== "object") return null;
  const s = (e as { status?: unknown }).status;
  return typeof s === "number" ? s : null;
}

/** A 4xx about the batch itself (too big, unreadable): shrink it, then refuse the one record it can't take. */
export function isBatchProblem(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && !NOT_BATCH_PROBLEMS.has(status);
}

type Refused = { key: string; reason: string };

/** The server's `rejected` list, defensively. */
function parseRejected(raw: unknown): Refused[] {
  if (!Array.isArray(raw)) return [];
  const out: Refused[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { kind, id, reason } = r as { kind?: unknown; id?: unknown; reason?: unknown };
    out.push({
      key: `${typeof kind === "string" ? kind : "?"}:${typeof id === "string" ? id : "?"}`,
      reason: typeof reason === "string" && reason ? reason.slice(0, MAX_REASON) : "refused by the server",
    });
  }
  return out;
}

/** Adds refusals to the running tally in meta. */
export function withRejections(meta: TrackerMeta, refused: readonly Refused[]): Partial<TrackerMeta> {
  if (refused.length === 0) return {};
  return {
    rejectedCount: (meta.rejectedCount ?? 0) + refused.length,
    lastRejectReason: refused[refused.length - 1].reason,
    rejectedIds: [...(meta.rejectedIds ?? []), ...refused.map((r) => r.key)].slice(-MAX_REJECTED_IDS),
  };
}

function reasonOf(e: unknown, status: number | null): string {
  if (status === 413) return "too large to sync";
  const message = e instanceof Error ? e.message : "";
  return (message || `refused by the server (${status ?? "?"})`).slice(0, MAX_REASON);
}

/** The envelope for one outbox entry, from the current data. */
export function recordFor(op: OutboxOp, data: TrackerData): SyncRecord {
  if (op.table === "settings") return settingsRecord(data.settings);
  const kind = op.table as ListKind;
  const list = data[LIST_OF[kind]] as { id: string; updatedAt: string; deletedAt: string | null; createdAt: string }[];
  const record = list.find((r) => r.id === op.recordId);
  if (!record) return tombstoneRecord(kind, op.recordId, op.at);
  // A delete always goes up as a tombstone, even if the record was restored in between (it then has its own upsert).
  if (op.op === "delete" && !record.deletedAt) return tombstoneRecord(kind, op.recordId, op.at);
  return toSyncRecord(kind, record);
}

type Round = "done" | "more" | "stale";

export interface TrackerSync {
  /** Push + pull now (one run at a time; a call while one runs queues exactly one more). Never throws. */
  sync(): Promise<void>;
  /** Sync shortly after a change (several quick changes go together). */
  scheduleFlush(): void;
  /** The runtime turns sync off while /me says the tracker isn't granted; turning it back on clears a 404/403 stop. */
  setEnabled(on: boolean): void;
  /** A new account starts with a clean slate. */
  reset(): void;
  /** Whether the server switched sync off for the bound account. */
  isDisabled(): boolean;
  /** /me says the tracker is on again: lift a 404/403 stop for the bound account and sync. */
  revive(): void;
  /** Records per request right now (halves on 413 / batch 4xx, grows back on success). */
  batchSize(): number;
}

export function createTrackerSync(deps: SyncDeps): TrackerSync {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => new Date());
  let timer: unknown = null;
  let retries = 0;
  let running: Promise<void> | null = null;
  let rerun = false;
  /** The scope whose sync a 404/403 switched off. */
  let disabledScope: string | null = null;
  let enabled = true;
  let size = SYNC_BATCH;

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  /** Still the same account everywhere: the store's binding, its generation and the signed-in session. */
  const isCurrent = (scope: string, gen: number) => gen === deps.generation() && deps.snapshot().scope === scope && deps.sessionScope() === scope;

  /** One request: push `batch`, pull a page. */
  async function round(scope: string, gen: number, batch: readonly OutboxOp[]): Promise<Round> {
    const snap = deps.snapshot();
    const push = batch.map((op) => recordFor(op, snap.data));
    // The API client reads the access token when it sends: never send this account's records on another session.
    if (!isCurrent(scope, gen)) return "stale";
    const res = await deps.send({ cursor: snap.meta.cursor, push });
    // Signed out or switched account while the request ran: its answer isn't ours to apply.
    if (!isCurrent(scope, gen)) return "stale";

    const sentIds = new Set(batch.map((o) => o.id));
    const after = deps.snapshot();
    // Records changed again while the request ran stay pending (their new entry has a new op id).
    const pending = new Set(after.outbox.filter((o) => !sentIds.has(o.id)).map((o) => `${o.table}:${o.recordId}`));
    const pulled = Array.isArray(res.pulled) ? res.pulled : [];
    const merged = pulled.length > 0 ? applyPulled(after.data, pulled, pending).data : null;
    const at = now().toISOString();
    deps.apply([...sentIds], merged, {
      cursor: typeof res.cursor === "string" ? res.cursor : snap.meta.cursor,
      lastPullAt: at,
      ...(batch.length > 0 ? { lastFlushAt: at } : {}),
      ...withRejections(after.meta, parseRejected(res.rejected)),
    });
    const moreToPush = deps.snapshot().outbox.some((o) => !sentIds.has(o.id)) && after.outbox.length > batch.length;
    return res.hasMore === true || moreToPush ? "more" : "done";
  }

  /** A record the server won't take even on its own: it leaves the queue, counted. */
  function refuse(op: OutboxOp, reason: string): void {
    deps.apply([op.id], null, withRejections(deps.snapshot().meta, [{ key: `${op.table}:${op.recordId}`, reason }]));
  }

  async function syncOnce(): Promise<void> {
    const scope = deps.snapshot().scope;
    if (!scope || !enabled || disabledScope === scope) return;
    await deps.ensureLoaded();
    const gen = deps.generation();
    if (!isCurrent(scope, gen) || !deps.snapshot().isLoaded) return;
    let rounds = 0;
    let shrinks = 0;
    while (rounds < MAX_ROUNDS) {
      const batch = deps.snapshot().outbox.slice(0, size);
      let result: Round;
      try {
        result = await round(scope, gen, batch);
      } catch (e) {
        const status = statusOf(e);
        if (status === 404 || status === 403) {
          // Feature revoked (404) or not a customer session (403): stop quietly; data stays on the phone.
          disabledScope = scope;
          return;
        }
        if (!isBatchProblem(status) || batch.length === 0 || shrinks >= MAX_SHRINKS) throw e;
        shrinks += 1;
        if (batch.length > 1) {
          size = Math.max(1, Math.floor(batch.length / 2));
          continue;
        }
        if (!isCurrent(scope, gen)) return;
        refuse(batch[0], reasonOf(e, status));
        continue;
      }
      if (result === "stale") return;
      rounds += 1;
      size = Math.min(SYNC_BATCH, size * 2);
      if (result === "done") return;
    }
  }

  function scheduleRetry(): void {
    retries += 1;
    const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(retries, 8));
    cancelTimer();
    timer = setTimer(() => void sync(), wait);
  }

  function sync(): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = syncOnce()
      .then(() => {
        retries = 0;
      })
      .catch(() => scheduleRetry())
      .finally(() => {
        running = null;
        if (rerun) {
          rerun = false;
          void sync();
        }
      });
    return running;
  }

  return {
    sync,
    scheduleFlush() {
      if (!enabled || !deps.snapshot().scope) return;
      cancelTimer();
      timer = setTimer(() => void sync(), FLUSH_DELAY_MS);
    },
    setEnabled(on) {
      if (on && !enabled) disabledScope = null;
      enabled = on;
      if (!on) cancelTimer();
    },
    reset() {
      cancelTimer();
      retries = 0;
      disabledScope = null;
      size = SYNC_BATCH;
    },
    isDisabled() {
      const scope = deps.snapshot().scope;
      return !!scope && disabledScope === scope;
    },
    revive() {
      const scope = deps.snapshot().scope;
      if (!scope || disabledScope !== scope) return;
      disabledScope = null;
      void sync();
    },
    batchSize: () => size,
  };
}
