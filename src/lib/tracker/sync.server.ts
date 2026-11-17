import "server-only";

import type { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/lib/db/tenant-client";
import type { TrackerRecordKind, TrackerSyncRecord, TrackerSyncResponse } from "@/lib/mobile/contract";
import type { TrackerOwner } from "./owner";
import {
  MAX_LIVE_RECORDS,
  MAX_TOTAL_RECORDS,
  PULL_PAGE_SIZE,
  TOMBSTONE_PURGE_BATCH,
  START_CURSOR,
  decodeCursor,
  encodeCursor,
  planPush,
  recordKey,
  toWireRecord,
  tombstoneCutoff,
  validatePushRecord,
  type CleanRecord,
  type Rejection,
  type StoredRecord,
  type SyncCursor,
} from "./records";

/**
 * POST /tracker/sync — push the phone's changes, pull everything newer than the
 * cursor, in ONE tenant transaction (docs/mobile-admin/TRACKER.md §5).
 *
 * Round trips are fixed, whatever the push size (withTenant budget ≈ 60):
 *   set_config · lock · purge · existing · counts · last syncedAt · delete · insert · pull
 * (purge = one bounded DELETE of tombstones past TOMBSTONE_RETENTION_DAYS, only
 * when something is pushed; counts = live + total rows in one query.)
 * Winners over a stored row are written as delete + createMany under the SAME
 * row id, so a 500-record push is still two writes, never 500 updates.
 *
 * The account's tracker is locked first (a transaction-scoped advisory lock on
 * tenant + subject — customers, the owner and staff alike), so two phones
 * syncing at once are serialised. With that, every write's `syncedAt` is strictly after every
 * row already stored, and a (syncedAt, id) cursor can never skip a row that
 * committed late.
 */

type Row = {
  id: string;
  kind: string;
  localId: string;
  data: Prisma.JsonValue;
  updatedAt: Date;
  deletedAt: Date | null;
  syncedAt: Date;
  createdAt: Date;
};

const asData = (v: Prisma.JsonValue): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function toStored(r: Row): StoredRecord {
  return {
    rowId: r.id,
    createdAt: r.createdAt,
    kind: r.kind as TrackerRecordKind,
    localId: r.localId,
    data: asData(r.data),
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

/** Serialises one account's syncs; released when the transaction ends. A hash collision only costs a wait. */
async function lockTracker(db: TenantTx, tenantId: string, subject: string): Promise<void> {
  const key = `tracker:${tenantId}:${subject}`;
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}

async function loadExisting(db: TenantTx, subject: string, records: CleanRecord[]): Promise<Map<string, StoredRecord>> {
  const byKind = new Map<TrackerRecordKind, string[]>();
  for (const r of records) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.localId]);
  const rows = await db.trackerRecord.findMany({
    where: { subject, OR: [...byKind].map(([kind, ids]) => ({ kind, localId: { in: ids } })) },
  });
  return new Map(rows.map((r) => [recordKey(r), toStored(r)]));
}

/** A server clock strictly after every row this account has — never equal, never behind. */
async function writeClock(db: TenantTx, subject: string): Promise<Date> {
  const last = await db.trackerRecord.findFirst({
    where: { subject },
    orderBy: { syncedAt: "desc" },
    select: { syncedAt: true },
  });
  const now = Date.now();
  return new Date(last ? Math.max(now, last.syncedAt.getTime() + 1) : now);
}

type PushOutcome = { rejected: Rejection[]; losers: StoredRecord[] };

/** Live and total (live + tombstone) rows for the account, in one round trip. */
async function countRows(db: TenantTx, subject: string): Promise<{ live: number; total: number }> {
  const [row] = await db.$queryRaw<{ live: bigint | number; total: bigint | number }[]>`
    SELECT count(*) FILTER (WHERE "deletedAt" IS NULL) AS live, count(*) AS total
    FROM tracker_records WHERE subject = ${subject}`;
  return { live: Number(row?.live ?? 0), total: Number(row?.total ?? 0) };
}

/** Opportunistic, bounded: at most TOMBSTONE_PURGE_BATCH tombstones older than the retention window. */
async function purgeOldTombstones(db: TenantTx, subject: string, now: Date): Promise<void> {
  await db.$executeRaw`
    DELETE FROM tracker_records WHERE id IN (
      SELECT id FROM tracker_records
      WHERE subject = ${subject} AND "deletedAt" IS NOT NULL AND "deletedAt" < ${tombstoneCutoff(now)}
      LIMIT ${TOMBSTONE_PURGE_BATCH}
    )`;
}

async function applyPush(db: TenantTx, tenantId: string, owner: TrackerOwner, records: CleanRecord[]): Promise<PushOutcome> {
  if (records.length === 0) return { rejected: [], losers: [] };
  const existing = await loadExisting(db, owner.subject, records);
  const counts = await countRows(db, owner.subject);
  const plan = planPush(records, existing, counts.live, MAX_LIVE_RECORDS, { count: counts.total, cap: MAX_TOTAL_RECORDS });
  if (plan.inserts.length + plan.replaces.length === 0) return { rejected: plan.rejected, losers: plan.losers };

  const syncedAt = await writeClock(db, owner.subject);
  const row = (r: CleanRecord) => ({
    tenantId,
    subject: owner.subject,
    customerId: owner.customerId,
    staffId: owner.staffId,
    kind: r.kind,
    localId: r.localId,
    data: r.data as Prisma.InputJsonObject,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    syncedAt,
  });
  if (plan.replaces.length > 0) {
    await db.trackerRecord.deleteMany({ where: { subject: owner.subject, id: { in: plan.replaces.map((r) => r.rowId) } } });
  }
  await db.trackerRecord.createMany({
    data: [
      ...plan.inserts.map(row),
      ...plan.replaces.map((r) => ({ ...row(r), id: r.rowId, createdAt: r.createdAt })),
    ],
  });
  return { rejected: plan.rejected, losers: plan.losers };
}

async function pullPage(db: TenantTx, subject: string, after: SyncCursor): Promise<Row[]> {
  return db.trackerRecord.findMany({
    where: {
      subject,
      OR: [{ syncedAt: { gt: after.syncedAt } }, { syncedAt: after.syncedAt, id: { gt: after.id } }],
    },
    orderBy: [{ syncedAt: "asc" }, { id: "asc" }],
    take: PULL_PAGE_SIZE + 1,
  });
}

/**
 * `push` is the raw array from the request (already capped at MAX_PUSH_RECORDS
 * by parseSyncRequest). Bad records are refused one by one, never the batch.
 */
export async function syncTracker(
  tenantId: string,
  owner: TrackerOwner,
  req: { cursor: string | null; push: unknown[] },
  now: Date = new Date(),
): Promise<TrackerSyncResponse> {
  const rejected: Rejection[] = [];
  const valid: CleanRecord[] = [];
  for (const raw of req.push) {
    const v = validatePushRecord(raw, now);
    if (v.ok) valid.push(v.record);
    else rejected.push({ kind: v.kind, id: v.id, reason: v.reason });
  }
  const after = decodeCursor(req.cursor) ?? START_CURSOR;

  return withTenant(tenantId, async (db) => {
    await lockTracker(db, tenantId, owner.subject);
    if (valid.length > 0) await purgeOldTombstones(db, owner.subject, now);
    const pushed = await applyPush(db, tenantId, owner, valid);
    const rows = await pullPage(db, owner.subject, after);

    const hasMore = rows.length > PULL_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PULL_PAGE_SIZE) : rows;
    const last = page[page.length - 1];
    const cursor = last ? { syncedAt: last.syncedAt, id: last.id } : after;

    // A pushed copy that lost: hand back the stored winner, so this phone
    // converges even when that row sits behind its cursor.
    const inPage = new Set(page.map((r) => r.id));
    const pulled: TrackerSyncRecord[] = [
      ...page.map((r) => toWireRecord(toStored(r))),
      ...pushed.losers.filter((l) => !inPage.has(l.rowId)).map(toWireRecord),
    ];
    return { pulled, cursor: encodeCursor(cursor), rejected: [...rejected, ...pushed.rejected], hasMore };
  });
}
