-- Exactly one ACTIVE group buy round per tenant — enforced by the database, not
-- by application code. This is the real backstop for the single-active invariant
-- (rule #4): the read-then-write guard in saveGroupBuyAction still races under
-- concurrent saves, and this partial unique index makes the second writer fail
-- loudly (Prisma P2002) instead of corrupting state.
--
-- Partial: only rows with status = 'active' participate, so any number of draft /
-- scheduled / closed / archived rounds coexist freely. Deliberately NOT an
-- entitlement — Postgres cannot see a tenant's feature grants, so the constraint
-- must hold unconditionally (this is why groupbuy.multiple_active was removed).
--
-- "tenantId" is quoted because the column is camelCase (no @map); an unquoted
-- identifier would fold to tenantid and fail.
--
-- Apply with:  npm run db:gb-index   (idempotent — safe to re-run)
--
-- NOTE: the save path persists a lapsed round's close (staleActiveRoundIds)
-- before activating a new one, so this index never false-rejects a legitimate
-- activation against a round whose window is already over.

CREATE UNIQUE INDEX IF NOT EXISTS group_buys_one_active_per_tenant
  ON group_buys ("tenantId")
  WHERE status = 'active';
