// Tenant lookup — the pure core behind the MCP connector's tenant directory and
// every tool that takes a `tenantSlug`.
//
// The connector could restyle a tenant, but only one whose EXACT slug the caller
// already held, because update_whitelabel_branding resolved with
// findUnique({ slug }). That works for a store ChatGPT just created and got the
// slug back for, and fails for every other one: "restyle HP Glow" becomes
// `hp-glow`, which is not a tenant — the real slug is `hpglow`. With no listing
// tool either, the model had nothing to try next. So "rebrand any tenant" was
// only ever true of self-created ones.
//
// Three rules carry the design (npm run test:tenant-lookup):
//
//   IT NEVER RESOLVES TO THE WRONG STORE. A branding write is live and visible
//   to a tenant's customers, so a name that fits two stores is refused with both
//   named — the same stance feature-toggle takes on an ambiguous feature label.
//   Guessing is the one failure mode nobody can undo from the chat window.
//
//   AN EXACT SLUG ALWAYS WINS. Tiered matching, not one big scoring pass: a real
//   slug must never be pulled into a false ambiguity by a lookalike sibling. If
//   `k-glow` and `kglow` both exist, asking for either by slug is unambiguous;
//   only the loose form "k glow" is genuinely undecidable.
//
//   A MISS TEACHES THE NEXT CALL. A bare "not found" ends the conversation. A
//   miss carries near matches, so the model's retry lands instead of the
//   operator being asked to go dig a slug out of the admin console.
//
// Pure (no Prisma, no React, no Next) so the tools, a script and the test all
// share one contract.

/** The identifying columns. Deliberately narrow — see buildTenantDirectory. */
export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status?: string | null;
  createdAt?: Date | string | null;
};

/** What the model is allowed to see about a store it has not opened. */
export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  storefrontUrl: string;
  createdAt: string | null;
};

export type TenantMatch =
  | { ok: true; tenant: TenantRow; matchedOn: "slug" | "name" | "loose" }
  | {
      ok: false;
      reason: "empty" | "none" | "ambiguous";
      message: string;
      candidates: TenantRow[];
    };

export type TenantDirectory = {
  tenants: TenantSummary[];
  total: number;
  truncated: boolean;
};

/** A page bigger than this is context spend, not information. */
const DEFAULT_LIMIT = 100;
/** Enough to choose from; more is just noise in a refusal message. */
const MAX_CANDIDATES = 8;

/**
 * Reduce anything an operator might say into a bare slug-ish token.
 *
 * Operators paste storefront URLs as often as they type slugs, so a scheme,
 * host suffix, port, path or fragment all have to fall away before comparison —
 * `https://hpglow.pepweb.store/#catalog` and `hpglow` are the same request.
 */
export function normalizeTenantQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let value = raw.trim().toLowerCase();
  if (!value) return "";

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Cut path, query and fragment.
  value = value.split(/[/?#]/)[0] ?? "";
  // Cut a port.
  value = value.replace(/:\d+$/, "");
  // A dotted, space-free token is a host: the tenant is its first label.
  if (!/\s/.test(value) && value.includes(".")) {
    value = value.split(".")[0] ?? "";
  }
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The punctuation-blind compare key. `hp-glow`, `hpglow` and `HP Glow` all
 * reduce to `hpglow`, which is the whole reason a human's spelling of a store
 * name can reach a slug nobody told them.
 */
export function tenantSearchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function ambiguous(query: string, candidates: TenantRow[]): TenantMatch {
  const named = candidates.map((t) => `${t.slug} (${t.name})`).join(", ");
  return {
    ok: false,
    reason: "ambiguous",
    message: `"${query}" matches more than one tenant: ${named}. Send the exact slug.`,
    candidates,
  };
}

/** Near misses, best first — shared-prefix length, then shared characters. */
function nearest(key: string, tenants: TenantRow[]): TenantRow[] {
  const score = (t: TenantRow) => {
    const candidates = [tenantSearchKey(t.slug), tenantSearchKey(t.name)];
    return Math.max(...candidates.map((c) => sharedPrefix(key, c) * 2 + sharedChars(key, c)));
  };
  return [...tenants]
    .map((t) => ({ t, s: score(t) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CANDIDATES)
    .map(({ t }) => t);
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sharedChars(a: string, b: string): number {
  const pool = [...b];
  let hits = 0;
  for (const ch of a) {
    const at = pool.indexOf(ch);
    if (at >= 0) {
      pool.splice(at, 1);
      hits++;
    }
  }
  return hits;
}

/**
 * Resolve whatever the operator said to exactly one tenant, or refuse.
 *
 * Tiered on purpose. Each tier is consulted only when every earlier one came up
 * empty, so an exact slug can never be dragged into a false ambiguity by a
 * lookalike that would have matched further down.
 */
export function buildTenantMatch(raw: unknown, tenants: TenantRow[]): TenantMatch {
  const query = normalizeTenantQuery(raw);
  if (!query) {
    return {
      ok: false,
      reason: "empty",
      message: "A tenant is required. Send its slug, its store name, or its storefront URL.",
      candidates: [],
    };
  }

  const key = tenantSearchKey(query);
  if (!key) {
    return {
      ok: false,
      reason: "empty",
      message: "A tenant is required. Send its slug, its store name, or its storefront URL.",
      candidates: [],
    };
  }

  type Tier = { on: "slug" | "name" | "loose"; hits: TenantRow[] };
  const tiers: Tier[] = [
    { on: "slug", hits: tenants.filter((t) => t.slug.toLowerCase() === query) },
    { on: "name", hits: tenants.filter((t) => t.name.trim().toLowerCase() === query) },
    { on: "loose", hits: tenants.filter((t) => tenantSearchKey(t.slug) === key) },
    { on: "loose", hits: tenants.filter((t) => tenantSearchKey(t.name) === key) },
    {
      on: "loose",
      hits: tenants.filter(
        (t) => tenantSearchKey(t.slug).startsWith(key) || tenantSearchKey(t.name).startsWith(key),
      ),
    },
    {
      on: "loose",
      hits: tenants.filter(
        (t) => tenantSearchKey(t.slug).includes(key) || tenantSearchKey(t.name).includes(key),
      ),
    },
  ];

  for (const tier of tiers) {
    const unique = dedupe(tier.hits);
    if (unique.length === 1) return { ok: true, tenant: unique[0], matchedOn: tier.on };
    if (unique.length > 1) return ambiguous(query, unique.slice(0, MAX_CANDIDATES));
  }

  const candidates = nearest(key, tenants);
  return {
    ok: false,
    reason: "none",
    message: candidates.length
      ? `No tenant matches "${query}". Closest: ${candidates.map((t) => t.slug).join(", ")}. Call list_whitelabel_tenants to see them all.`
      : `No tenant matches "${query}". Call list_whitelabel_tenants to see the stores that exist.`,
    candidates,
  };
}

function dedupe(rows: TenantRow[]): TenantRow[] {
  const seen = new Set<string>();
  return rows.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

function storefrontUrl(slug: string, root: string): string {
  return `https://${slug}.${root}`;
}

function isoDate(value: TenantRow["createdAt"]): string | null {
  if (!value) return null;
  // unstable_cache hands Dates back as strings; both shapes reach here.
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The store list the model is allowed to read.
 *
 * This projects field-by-field rather than spreading the row, and that is the
 * point: a Tenant carries adminPasswordHash, storeAdminPasswordHash,
 * accessCodeHash, the owner's WhatsApp number and the whole subscription ledger.
 * A spread — or a `select` someone widens later — would hand all of it to a
 * remote model. Only what identifies a store crosses this boundary.
 */
export function buildTenantDirectory(
  tenants: TenantRow[],
  options: { query?: unknown; limit?: unknown; rootDomain?: string } = {},
): TenantDirectory {
  const root = options.rootDomain || "pepweb.store";
  const query = normalizeTenantQuery(options.query);
  const key = tenantSearchKey(query);

  const matched = key
    ? tenants.filter(
        (t) => tenantSearchKey(t.slug).includes(key) || tenantSearchKey(t.name).includes(key),
      )
    : [...tenants];

  const sorted = matched.sort((a, b) => a.name.localeCompare(b.name));

  const asked = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.floor(options.limit)
    : DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(asked, DEFAULT_LIMIT));

  return {
    tenants: sorted.slice(0, limit).map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: (t.status ?? "active") || "active",
      storefrontUrl: storefrontUrl(t.slug, root),
      createdAt: isoDate(t.createdAt),
    })),
    total: sorted.length,
    truncated: sorted.length > limit,
  };
}
