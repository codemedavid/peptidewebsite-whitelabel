// Self-contained gate for the ORDER TRASH — the store admin's undo for a
// deleted order (src/lib/orders/trash.ts). No DB, no React.
//
// Deleting an order used to be final: one mis-click on "Delete Selected" — or
// worse, on "Delete All Orders" — and a tenant's sales history was gone with no
// way back. Trash makes the destructive step reversible: deleting an order
// SOFT-deletes it (stamps deletedAt), the Trash view lists what was removed and
// when, and the owner can Restore it or Delete it permanently.
//
// The whole risk of a soft delete lives in the read paths. A hard DELETE drops
// a row out of every query for free; a soft delete does not. Miss one call site
// and a "deleted" order silently keeps inflating revenue, best-seller counts, a
// group-buy supplier report, or the operator's cross-tenant MRR. So this gate
// does two things:
//
//   1. pins the behaviour of the shared rules module (what counts as trashed,
//      how a list is partitioned, what the Prisma where-fragments mean)
//   2. reads the SOURCE of every file that queries storefront_orders and proves
//      each read carries the filter — the only check that survives a future
//      contributor adding a fourth aggregate query in six months' time
//
// Invariants worth naming, because they are the ones that lose data if broken:
//
//   • permanent delete can only ever remove rows ALREADY in the trash
//   • trashing and restoring never move stock (a hard delete never restocked
//     either — the goods left the shelf when the order was confirmed)
//   • the checkout's clientId idempotency lookup is DELIBERATELY unfiltered:
//     @@unique([tenantId, clientId]) still counts a trashed row, so a retry has
//     to find it rather than collide with it
//   • junk in deletedAt reads as NOT trashed — an order wrongly hidden from the
//     owner's revenue is far worse than one that reappears in the list
//
//   npm run test:order-trash

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTIVE_ORDERS_WHERE,
  MAX_TRASH_IDS,
  TRASHED_ORDERS_WHERE,
  activeOrders,
  isTrashed,
  normalizeTrashScope,
  ordersWhere,
  trashedOrders,
} from "../src/lib/orders/trash";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

console.log("order trash — recover or delete permanently\n");

// ── the Prisma where-fragments ───────────────────────────────────────────────
// Two fragments, spread into an existing `where` so a caller keeps its own
// conditions. Every top-level key ANDs in Prisma, so the filter can never be
// widened by accident by the condition it is combined with.
console.log("where fragments — one definition, spread everywhere");

check("active orders are the ones with no deletedAt", eq(ACTIVE_ORDERS_WHERE, { deletedAt: null }));
check(
  "trashed orders are the ones that have one",
  eq(TRASHED_ORDERS_WHERE, { deletedAt: { not: null } }),
);
check('ordersWhere("active") is the active fragment', eq(ordersWhere("active"), ACTIVE_ORDERS_WHERE));
check('ordersWhere("trash") is the trashed fragment', eq(ordersWhere("trash"), TRASHED_ORDERS_WHERE));
check(
  "the fragments are new objects, so a caller spreading one can't corrupt it",
  (ordersWhere("active") as unknown) !== (ACTIVE_ORDERS_WHERE as unknown),
);

// The scope arrives from a client call, so it is untrusted. Anything unrecognised
// has to resolve to "active": that is the list every existing caller already
// gets, and showing trashed orders in the working list would look like the
// delete silently failed.
console.log("\nthe scope is untrusted input and fails safe to active");

check("undefined → active", normalizeTrashScope(undefined) === "active");
check("null → active", normalizeTrashScope(null) === "active");
check("junk → active", normalizeTrashScope("deleted") === "active");
check("an object → active", normalizeTrashScope({ scope: "trash" }) === "active");
check('"active" → active', normalizeTrashScope("active") === "active");
check('"trash" → trash', normalizeTrashScope("trash") === "trash");

// ── isTrashed — only a real timestamp hides an order ─────────────────────────
// Fails safe the other way from the scope: an order is hidden from the owner's
// revenue ONLY on an unambiguous timestamp. Garbage leaves it visible, which is
// the recoverable direction — the owner sees it and can trash it again.
console.log("\nisTrashed — only a real timestamp counts");

check("no deletedAt at all → not trashed", isTrashed({}) === false);
check("null → not trashed", isTrashed({ deletedAt: null }) === false);
check("undefined → not trashed", isTrashed({ deletedAt: undefined }) === false);
check("an empty string → not trashed", isTrashed({ deletedAt: "" }) === false);
check("whitespace → not trashed", isTrashed({ deletedAt: "   " }) === false);
check("a number → not trashed", isTrashed({ deletedAt: 0 }) === false);
check("a boolean → not trashed", isTrashed({ deletedAt: true }) === false);
check("an unparseable date string → not trashed", isTrashed({ deletedAt: "someday" }) === false);
check("an Invalid Date → not trashed", isTrashed({ deletedAt: new Date("nope") }) === false);
check("an ISO string → trashed", isTrashed({ deletedAt: "2026-08-08T04:00:00.000Z" }) === true);
check("a Date → trashed", isTrashed({ deletedAt: new Date("2026-08-08T04:00:00.000Z") }) === true);

// ── partitioning a list (the demo path, and the admin client) ────────────────
// The DB path filters in SQL; demo mode and the admin UI hold plain arrays, so
// they need the same rule expressed once rather than an inline `.filter` per
// call site that can drift from the SQL.
console.log("\nactiveOrders / trashedOrders — the same rule for in-memory lists");

const sample = Object.freeze([
  Object.freeze({ id: "a" }),
  Object.freeze({ id: "b", deletedAt: "2026-08-08T04:00:00.000Z" }),
  Object.freeze({ id: "c", deletedAt: null }),
  Object.freeze({ id: "d", deletedAt: "2026-08-07T04:00:00.000Z" }),
]) as ReadonlyArray<{ id: string; deletedAt?: string | null }>;

check(
  "active keeps only the untrashed, in their original order",
  eq(
    activeOrders([...sample]).map((o) => o.id),
    ["a", "c"],
  ),
);
check(
  "trashed keeps only the trashed, in their original order",
  eq(
    trashedOrders([...sample]).map((o) => o.id),
    ["b", "d"],
  ),
);
check(
  "the two partitions account for every order — none is lost by both",
  activeOrders([...sample]).length + trashedOrders([...sample]).length === sample.length,
);
check("an empty list partitions to two empty lists", activeOrders([]).length === 0);
check(
  "the input array is never mutated",
  eq(
    sample.map((o) => o.id),
    ["a", "b", "c", "d"],
  ),
);
check(
  "the result is a NEW array, not the input",
  (activeOrders(sample) as unknown) !== (sample as unknown),
);
check(
  "the id cap matches the one the existing bulk actions already enforce",
  MAX_TRASH_IDS === 1000,
);

// ── every query site carries the filter ──────────────────────────────────────
// The source-reading half of the gate. A soft delete is only as good as its
// least-filtered read, and these sites are spread across five files that nobody
// edits together.

/** The argument text of each `storefrontOrder.<op>(…)` call, paren-matched. */
function callSites(source: string, ops: string[]): { index: number; args: string }[] {
  const re = new RegExp(`storefrontOrder\\.(${ops.join("|")})\\s*\\(`, "g");
  const found: { index: number; args: string }[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    found.push({ index: m.index, args: source.slice(open + 1, end) });
  }
  return found;
}

/**
 * A site carries the filter when it names deletedAt or — better — spreads one
 * of the shared fragments, which is what keeps the rule in one place.
 */
const FILTERED = /deletedAt|ACTIVE_ORDERS_WHERE|TRASHED_ORDERS_WHERE|ordersWhere\(/;

/**
 * A read site is compliant when it filters, or carries a `trash-exempt` marker
 * on the line immediately above it. The marker window is deliberately tight:
 * an exemption has to be written on the query it excuses, not somewhere in the
 * surrounding prose where it could drift onto a query added later.
 */
function audit(rel: string, ops = ["findMany", "findFirst", "count"]) {
  const source = src(rel);
  const sites = callSites(source, ops);
  const filtered = sites.filter((s) => FILTERED.test(s.args));
  const exempt = sites.filter(
    (s) =>
      !FILTERED.test(s.args) &&
      /trash-exempt/.test(source.slice(Math.max(0, s.index - 160), s.index)),
  );
  return { total: sites.length, filtered: filtered.length, exempt: exempt.length };
}

console.log("\nevery storefront_orders read excludes trashed rows");

// actions/orders.ts — the admin list, the public Track lookup, the status
// updates, and the two idempotency probes that must stay unfiltered.
const ordersAudit = audit("src/actions/orders.ts");
check(
  "actions/orders.ts — every read is either filtered or marked trash-exempt",
  ordersAudit.filtered + ordersAudit.exempt === ordersAudit.total,
  `${ordersAudit.total - ordersAudit.filtered - ordersAudit.exempt} unfiltered read(s)`,
);
check(
  "actions/orders.ts — exactly two reads are exempt (the clientId idempotency probes)",
  ordersAudit.exempt === 2,
  `found ${ordersAudit.exempt} — a new exemption hides orders from the owner`,
);

// The writes matter as much as the reads: a status change must not resurrect a
// trashed order into the fulfilment flow (and deduct stock doing it).
const ordersWrites = audit("src/actions/orders.ts", ["updateMany", "deleteMany"]);
check(
  "actions/orders.ts — every write is scoped by deletedAt too",
  ordersWrites.filtered + ordersWrites.exempt === ordersWrites.total,
  `${ordersWrites.total - ordersWrites.filtered - ordersWrites.exempt} unscoped write(s)`,
);

const gbAudit = audit("src/actions/group-buys.ts");
check(
  "actions/group-buys.ts — the supplier report and the linkable-orders list both filter",
  gbAudit.total >= 2 && gbAudit.filtered === gbAudit.total,
  `${gbAudit.filtered}/${gbAudit.total} filtered`,
);

// The home's two order reads: the group-buy fill count still renders inline,
// while the best-seller tally moved behind a cached loader (lib/storefront/
// best-sellers.ts) to stop rescanning every active order per render. Both files
// are audited so moving a read can never move it out from under this rule.
const homeAudit = audit("src/app/(tenant)/(storefront)/storefront-home.tsx");
check(
  "the storefront home — the group-buy fill count filters",
  homeAudit.total >= 1 && homeAudit.filtered === homeAudit.total,
  `${homeAudit.filtered}/${homeAudit.total} filtered — a trashed order would still sell the product`,
);

const bestSellerAudit = audit("src/lib/storefront/best-sellers.ts");
check(
  "the cached best-seller tally filters",
  bestSellerAudit.total >= 1 && bestSellerAudit.filtered === bestSellerAudit.total,
  `${bestSellerAudit.filtered}/${bestSellerAudit.total} filtered — a trashed order would still rank as a sale`,
);

check(
  "the two home order reads together still cover fill count + best sellers",
  homeAudit.total + bestSellerAudit.total >= 2,
  `${homeAudit.total + bestSellerAudit.total} read(s)`,
);

const platformAudit = audit("src/lib/admin/data.ts");
check(
  "the operator console — every cross-tenant order read filters",
  platformAudit.total >= 3 && platformAudit.filtered === platformAudit.total,
  `${platformAudit.filtered}/${platformAudit.total} filtered — trashed orders would inflate tenant revenue`,
);

// ── the actions themselves ───────────────────────────────────────────────────
console.log("\ntrash / restore / purge");

// The row -> Order mapping moved to lib/orders/db-mapping.ts so the Telegram
// webhook could share it; read both as one source.
const ordersSrc = src("src/actions/orders.ts") + src("src/lib/orders/db-mapping.ts");

check(
  "deleting an order now moves it to the trash",
  /export async function trashStorefrontOrdersAction/.test(ordersSrc),
);
check(
  "a trashed order can be restored",
  /export async function restoreStorefrontOrdersAction/.test(ordersSrc),
);
check(
  "a trashed order can be deleted for good",
  /export async function purgeStorefrontOrdersAction/.test(ordersSrc),
);
check(
  "the old irreversible delete action is gone, not left as a second way in",
  !/export async function deleteStorefrontOrdersAction/.test(ordersSrc),
);

/** The body of a top-level function, brace-matched from its declaration. */
function fnBody(source: string, name: string): string {
  const at = source.search(new RegExp(`function ${name}\\b`));
  if (at < 0) return "";
  const open = source.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return "";
}

const trashFn = fnBody(ordersSrc, "trashStorefrontOrdersAction");
const restoreFn = fnBody(ordersSrc, "restoreStorefrontOrdersAction");
const purgeFn = fnBody(ordersSrc, "purgeStorefrontOrdersAction");

check("trashing stamps deletedAt rather than dropping the row", /deletedAt/.test(trashFn));
check(
  "trashing never destroys a row",
  trashFn.length > 0 && !/deleteMany/.test(trashFn),
  "a delete in the trash action defeats the entire feature",
);
check("restoring clears deletedAt", /deletedAt:\s*null/.test(restoreFn));

// The single most important line in the feature: an active order must be
// unreachable from the permanent-delete path, whatever ids the client sends.
// Scoped to the TRASHED fragment specifically — a purge carrying the active
// filter instead would be the exact inversion of the intent, and a looser check
// would wave it through.
check(
  "permanent delete can only ever remove rows ALREADY in the trash",
  /deleteMany/.test(purgeFn) &&
    /TRASHED_ORDERS_WHERE|deletedAt:\s*\{\s*not:\s*null/.test(purgeFn),
  "purge without a trashed-only scope would hard-delete live orders on a crafted id list",
);
check(
  "emptying the trash is owner-only — staff can trash and restore, never purge",
  /actor\.kind\s*[!=]==\s*"owner"/.test(purgeFn),
  "trash is not a safety net if the same hand that deletes can also empty it",
);

// Trash is a bookkeeping state, not a fulfilment one: the goods left the shelf
// when the order was confirmed, and a hard delete never put them back either.
console.log("\ntrashing and restoring never move stock");

for (const [label, body] of [
  ["trash", trashFn],
  ["restore", restoreFn],
  ["purge", purgeFn],
] as const) {
  check(
    `${label} does not touch inventory`,
    body.length > 0 && !/applyOrderStockMove|adjustProductStock|planStatusChange/.test(body),
    "moving stock here would double-count against the status transitions",
  );
}

// ── demo mode keeps parity ───────────────────────────────────────────────────
// The file-backed demo store holds plain arrays, so every place the DB path
// gained a WHERE, the demo path needs the shared partition helper instead.
console.log("\ndemo mode applies the same rule");

check(
  "actions/orders.ts filters the demo list through the shared helper",
  /activeOrders\(|trashedOrders\(/.test(ordersSrc),
);
check(
  "the demo bulk status change skips trashed orders",
  /isTrashed\(/.test(ordersSrc),
  "otherwise a trashed order could be confirmed in demo and deduct stock",
);
check(
  "actions/group-buys.ts filters its demo lists too",
  /activeOrders\(/.test(src("src/actions/group-buys.ts")),
);
check(
  "the storefront home filters its demo lists too",
  /activeOrders\(/.test(src("src/app/(tenant)/(storefront)/storefront-home.tsx")),
);
check(
  "the cached best-seller tally filters its demo list too",
  /activeOrders\(/.test(src("src/lib/storefront/best-sellers.ts")),
);

// ── the row and the type carry the field ─────────────────────────────────────
console.log("\nthe column, the row mapper and the Order type agree");

const schema = src("prisma/schema.prisma");
const orderModel = schema.slice(
  schema.indexOf("model StorefrontOrder"),
  schema.indexOf("model GroupBuy"),
);
check("storefront_orders has a deletedAt column", /deletedAt\s+DateTime\?/.test(orderModel));
check(
  "and an index, so the Orders screen never scans the trash",
  /@@index\(\[tenantId, deletedAt\]\)/.test(orderModel),
);
check(
  "the storefront Order type carries deletedAt",
  /deletedAt\?:/.test(src("src/storefront/types.ts")),
);
check(
  "deletedAt is mapped from the ROW, never from untrusted checkout input",
  /row\.deletedAt/.test(ordersSrc) && !/deletedAt:\s*p\.deletedAt/.test(ordersSrc),
  "a buyer who could set deletedAt would place orders invisible to the owner",
);

// ── the owner has a way in ───────────────────────────────────────────────────
console.log("\nthe Orders screen offers the trash");

const adminOrders = src("src/storefront/admin/AdminOrders.tsx");
check("the destructive button now says Trash, not Delete", /Move to Trash/.test(adminOrders));
check("there is a Trash view to switch to", /Trash/.test(adminOrders));
check("a trashed order can be restored from it", /restoreStorefrontOrdersAction/.test(adminOrders));
check("and deleted for good from it", /purgeStorefrontOrdersAction/.test(adminOrders));
check(
  "the screen no longer calls the old irreversible delete",
  !/deleteStorefrontOrdersAction/.test(adminOrders),
);

console.log(
  failures === 0
    ? "\nPASS — order trash verified"
    : `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
