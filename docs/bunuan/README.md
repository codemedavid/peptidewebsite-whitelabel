# Bunuan + Ligwak + GB payment mode — parallel build

Three SEPARATE group-buy features (owner, 2026-10-26):

- **Paid Access** — how a customer gets INTO a round. Already built: `src/modules/paid-access/`. Do not change it except where a brief says so.
- **Bunuan** — the phase after Open: only variations with an unfinished kit stay buyable, capped at EXACTLY the vials needed (143 vials @ 10/kit → 14 kits + 3 → 7 open). Closes by itself the moment every kit fills.
- **Ligwak** — after Bunuan the system SUGGESTS the vials that still don't make a kit (last-placed first, split per vial); the admin decides each line Ligwak (cancel) or Keep (store absorbs), then Locks. Lock re-totals orders.

Plus **GB payment mode** per store: *Pay before checkout* (`pay_first`) or *Pay after close* (`pay_later`).

## Owner decisions (do not re-ask)

1. A kit is per VARIATION (variation `kitSize` → product `vialsPerKit` fallback). Every order line names its variation.
2. Kit counter is ADMIN-ONLY and only during Bunuan. Storefront shows only open items + a quiet "up to N" limit — no progress bar; remove the existing storefront KitProgressBar in Bunuan stores.
3. Counting rule (ONE function, used by counter, Bunuan cap, Ligwak and supplier report): `pay_first` → confirmed orders only; `pay_later` → every placed, non-cancelled order. "Start Bunuan" is BLOCKED while pay_first orders still await a payment check (show the list).
4. Admin can add/remove/change lines on customer orders (re-priced server-side, audited, customer sees "Changed by the store"). May exceed the Bunuan limit with a warning. Edits lock when Payment time starts.
5. Bunuan is open to existing buyers (as a new order) and newly approved Paid Access members (anyone, if the store has no Paid Access).
6. Stages, set by the admin (web dashboard / Group Buys + app): **Open → [Bunuan time, only with Bunuan] → Closed (Ligwak review here) → [Payment time, pay_later only]**. Payment time is blocked until Ligwak is locked (when the store has Ligwak).
7. At Payment time every pay_later customer's latest order shows "Payment due ₱X" + proof upload; optional due date, admin cancels unpaid by hand. pay_first refunds: `for_review → refund_pending → refunded`, capped at amount paid, with a reference.
8. Supplier Excel is available once Bunuan ends; counts only orders under rule 3 minus ligwak'd vials; kits per variation.
9. Operator-grantable features, default OFF: `groupbuy.bunuan`, `groupbuy.ligwak`. First store: mnm-pepsabuy. Website + PepWorld app fully in sync. NOT Mamamica.

## Waves

| Wave | Brief | Depends on |
|---|---|---|
| 1 | [WAVE-1A-core.md](WAVE-1A-core.md) — pure logic + tests | — |
| 1 | [WAVE-1B-payment-mode.md](WAVE-1B-payment-mode.md) — payment-mode setting + website pay-later checkout | — |
| 2 | [WAVE-2A-server.md](WAVE-2A-server.md) — schema, live DB, server actions | 1A + 1B merged |
| 3 | [WAVE-3A-admin.md](WAVE-3A-admin.md) — admin UI web + app | 2A merged |
| 3 | [WAVE-3B-customer.md](WAVE-3B-customer.md) — customer UI web + app | 2A merged |
| 3 | [WAVE-3C-notify.md](WAVE-3C-notify.md) — notifications + invoice timing | 2A merged |

Merge each wave's branch into `feat/mobile-admin-app` (1A, 1B → 2A → 3A, 3B, 3C) before starting the next wave.

## Starting a terminal

```bash
cd "/Users/ynadonaire/peptide website whitelabel v1"
git worktree add ../pepweb-1a -b bunuan/1a-core feat/mobile-admin-app   # name per wave
cd ../pepweb-1a && cp "../peptide website whitelabel v1"/.env* . && npm install && (cd mobile && npm install)
claude
```

Then paste: **Read docs/bunuan/README.md and docs/bunuan/WAVE-1A-core.md, then do that wave.**

## Rules for every terminal

- Work ONLY in your worktree/branch. Never `git stash`, never commit or push outside your branch, never touch another worktree.
- Only Wave 2A edits `prisma/schema.prisma` or writes to the LIVE database. Everyone else: no `db push`, no SQL against Supabase.
- Stay inside "Files you own". If you must change a file outside it, keep the hunk tiny and list it in your hand-off.
- Ports: never 3100. Dev server `NEXT_DIST_DIR=.next-<wave> next dev -p <port>`: 1A 3111, 1B 3112, 2A 3121, 3A 3131, 3B 3132, 3C 3133. PGlite socket port = dev port + 52000.
- Tests first (red → green). New tests get an `npm run test:<name>` script. Mutation-check new tests (break the code, see them fail).
- Repo conventions: tenant DB access via `withTenant()`; ~60 queries max per transaction (`tx-round-trip-budget`); display reads may be cached, decisions (cap, totals) are always live; every whole-product writer must carry new metadata fields (`normalizeProductInput` drops unknown ones); order totals are computed in 6 surfaces — grep `adminFee` to find them.
- Finish by writing `docs/bunuan/HANDOFF-<wave>.md`: what you built, exported functions/actions with signatures, tests + counts, files touched outside your list, open questions. Commit on your branch.
