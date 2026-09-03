// MCP tenant lookup — RED/GREEN gate (npm run test:tenant-lookup).
//
// update_whitelabel_branding could already restyle a tenant, but only one whose
// EXACT slug the caller already knew: it resolves with findUnique({ slug }).
// That is fine for a store ChatGPT just created and returned the slug for, and a
// dead end for every other one. An operator saying "restyle HP Glow" gets
//   Tenant "hp-glow" was not found.
// because the real slug is `hpglow` — and the connector offers no way to find
// that out, because it has no tenant listing at all. So "rebrand any created
// tenant" was false in practice: only self-created ones were reachable.
//
// This gate pins the two halves of the fix — a directory the model can read, and
// a resolver tolerant enough to land on the right store — under three rules:
//
//   IT NEVER RESTYLES THE WRONG STORE. Branding writes are live and visible to
//   a tenant's customers. An ambiguous name is refused with every candidate
//   named, exactly as feature-toggle refuses an ambiguous feature label. An
//   exact slug, however, always wins outright — a real slug must never be
//   dragged into a false ambiguity by a lookalike. Journeys 4, 6.
//
//   A MISS MUST TEACH THE NEXT CALL. "Not found" with no candidates ends the
//   conversation; the model has nothing to try next. A miss carries near
//   matches. Journey 5.
//
//   THE DIRECTORY IS NOT A DATA EXPORT. The Tenant row carries scrypt password
//   hashes (adminPasswordHash, storeAdminPasswordHash, accessCodeHash), the
//   owner's WhatsApp and the subscription ledger. A careless select would hand
//   all of it to a remote model. The directory ships only what identifies a
//   store. Journey 7.
//
// Journeys covered:
//  1. Operator asks what stores exist → a directory of tenants ChatGPT never created.
//  2. Operator says the slug with different punctuation → resolves.
//  3. Operator pastes a storefront URL → resolves.
//  4. Two lookalike stores → refused, both named, nothing applied.
//  5. A typo → not-found that names near matches so the retry lands.
//  6. An exact slug is never dragged into a false ambiguity.
//  7. The directory never ships credentials or commercial data.
//  8. Trial / suspended / self-serve tenants are reachable too.
//  9. A huge estate is capped, not dumped into the model's context.
// 10. The tool schema, the core, the branding tool and the route all agree.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildTenantDirectory,
  buildTenantMatch,
  normalizeTenantQuery,
  type TenantRow,
} from "../src/lib/tenant/tenant-lookup";
import { LIST_TENANTS_TOOL } from "../src/lib/mcp/tenant-lookup-tool";
import { UPDATE_BRANDING_TOOL } from "../src/lib/mcp/update-branding-tool";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}`);
    if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** A realistic estate: the slugs really do mix conventions (hpglow vs k-glow). */
const ESTATE: TenantRow[] = [
  { id: "t1", slug: "hpglow", name: "HP Glow", status: "active" },
  { id: "t2", slug: "k-glow", name: "K Glow", status: "active" },
  { id: "t3", slug: "dragon-peptides", name: "Dragon Peptides", status: "active" },
  { id: "t4", slug: "peptibesties", name: "Pepti Besties", status: "trial" },
  { id: "t5", slug: "mstomato", name: "Ms Tomato", status: "suspended" },
  { id: "t6", slug: "luminara", name: "Luminara", status: "active" },
];

section("Journey 1 — the operator asks what stores exist");
{
  const dir = buildTenantDirectory(ESTATE, {});
  check("every tenant is listed, not just connector-created ones", dir.tenants.length === 6, dir.total);
  check("the total is reported", dir.total === 6, dir.total);
  const hp = dir.tenants.find((t) => t.slug === "hpglow");
  check("a listed store carries its slug", hp?.slug === "hpglow", hp);
  check("a listed store carries its display name", hp?.name === "HP Glow", hp);
  check("a listed store carries its status", hp?.status === "active", hp);
}

section("Journey 2 — the operator says the slug with different punctuation");
{
  const m = buildTenantMatch("hp-glow", ESTATE);
  check("hp-glow lands on hpglow", m.ok && m.tenant.slug === "hpglow", m);

  const spaced = buildTenantMatch("HP GLOW", ESTATE);
  check("HP GLOW lands on hpglow", spaced.ok && spaced.tenant.slug === "hpglow", spaced);

  const other = buildTenantMatch("kglow", ESTATE);
  check("kglow lands on k-glow", other.ok && other.tenant.slug === "k-glow", other);

  const named = buildTenantMatch("Dragon Peptides", ESTATE);
  check("a display name resolves", named.ok && named.tenant.slug === "dragon-peptides", named);
}

section("Journey 3 — the operator pastes a storefront URL");
{
  for (const url of [
    "https://hpglow.pepweb.store",
    "https://hpglow.pepweb.store/#catalog",
    "hpglow.pepweb.store",
    "http://hpglow.lvh.me:3100/",
  ]) {
    const m = buildTenantMatch(url, ESTATE);
    check(`${url} resolves to hpglow`, m.ok && m.tenant.slug === "hpglow", m);
  }
  check("normalize strips the scheme, host and path", normalizeTenantQuery("https://hpglow.pepweb.store/x") === "hpglow", normalizeTenantQuery("https://hpglow.pepweb.store/x"));
}

section("Journey 4 — two lookalike stores are refused, never guessed");
{
  const twins: TenantRow[] = [
    { id: "a", slug: "glow-labs", name: "Glow Labs", status: "active" },
    { id: "b", slug: "glow-labs-ph", name: "Glow Labs PH", status: "active" },
  ];
  // "glow" fits both and is nobody's exact slug or name — the real ambiguity.
  const m = buildTenantMatch("glow", twins);
  check("an ambiguous name does not resolve", !m.ok, m);
  check("the reason is ambiguity", !m.ok && m.reason === "ambiguous", m);
  check("both candidates are named", !m.ok && m.candidates.length === 2, m);
  check(
    "the message names the slugs so the operator can choose",
    !m.ok && m.message.includes("glow-labs") && m.message.includes("glow-labs-ph"),
    !m.ok ? m.message : null,
  );

  // A prefix that fits only one store is NOT ambiguous — refusing it would make
  // the tool useless for the exact half-remembered names operators actually type.
  const unique = buildTenantMatch("glow labs p", twins);
  check("a prefix unique to one store still resolves", unique.ok && unique.tenant.slug === "glow-labs-ph", unique);
  // The store literally named "Glow Labs" wins its own name outright.
  const named = buildTenantMatch("Glow Labs", twins);
  check("an exact name beats a longer sibling", named.ok && named.tenant.slug === "glow-labs", named);
}

section("Journey 5 — a typo teaches the next call");
{
  const m = buildTenantMatch("hpglw", ESTATE);
  check("a typo does not resolve", !m.ok, m);
  check("the reason is not-found", !m.ok && m.reason === "none", m);
  check("near matches are offered", !m.ok && m.candidates.length > 0, m);
  check(
    "the real store is among the suggestions",
    !m.ok && m.candidates.some((c) => c.slug === "hpglow"),
    !m.ok ? m.candidates : null,
  );

  const empty = buildTenantMatch("   ", ESTATE);
  check("a blank query is its own reason", !empty.ok && empty.reason === "empty", empty);
}

section("Journey 6 — an exact slug is never dragged into a false ambiguity");
{
  // Same display name, two slugs — the case where guessing restyles a live
  // store the operator never meant to touch.
  const collide: TenantRow[] = [
    { id: "a", slug: "kglow", name: "K Glow", status: "active" },
    { id: "b", slug: "k-glow", name: "K Glow", status: "active" },
  ];
  const exact = buildTenantMatch("k-glow", collide);
  check("the exact slug wins outright", exact.ok && exact.tenant.slug === "k-glow", exact);
  const other = buildTenantMatch("kglow", collide);
  check("the other exact slug wins outright too", other.ok && other.tenant.slug === "kglow", other);
  // Only the shared display name is genuinely undecidable between the two.
  const loose = buildTenantMatch("k glow", collide);
  check("a form matching both is refused", !loose.ok && loose.reason === "ambiguous", loose);
}

section("Journey 7 — the directory is not a data export");
{
  const leaky = [
    {
      id: "t1",
      slug: "hpglow",
      name: "HP Glow",
      status: "active",
      adminPasswordHash: "scrypt$deadbeef$cafe",
      storeAdminPasswordHash: "scrypt$deadbeef$cafe",
      storeAdminEmail: "owner@example.com",
      accessCodeHash: "scrypt$deadbeef$cafe",
      ownerWhatsapp: "639171234567",
      subscriptionPriceCents: 150000,
      subscriptionAmountCents: 1500000,
    } as unknown as TenantRow,
  ];
  const dir = buildTenantDirectory(leaky, {});
  const serialized = JSON.stringify(dir);
  for (const secret of [
    "scrypt$",
    "owner@example.com",
    "639171234567",
    "adminPasswordHash",
    "storeAdminPasswordHash",
    "accessCodeHash",
    "ownerWhatsapp",
    "subscriptionPriceCents",
    "subscriptionAmountCents",
  ]) {
    check(`the directory never ships ${secret}`, !serialized.includes(secret), serialized.slice(0, 300));
  }
  check("but it still identifies the store", serialized.includes("hpglow"), serialized);
}

section("Journey 8 — trial, suspended and self-serve tenants are reachable");
{
  for (const slug of ["peptibesties", "mstomato"]) {
    const m = buildTenantMatch(slug, ESTATE);
    check(`${slug} resolves regardless of status`, m.ok && m.tenant.slug === slug, m);
  }
  const dir = buildTenantDirectory(ESTATE, {});
  check(
    "a suspended store is listed, with its status shown",
    dir.tenants.some((t) => t.slug === "mstomato" && t.status === "suspended"),
    dir.tenants,
  );
  const filtered = buildTenantDirectory(ESTATE, { query: "glow" });
  check("a query narrows the directory", filtered.tenants.length === 2, filtered.tenants);
  check(
    "the narrowed directory holds both glow stores",
    filtered.tenants.every((t) => t.slug === "hpglow" || t.slug === "k-glow"),
    filtered.tenants,
  );
}

section("Journey 9 — a huge estate is capped, not dumped");
{
  const many: TenantRow[] = Array.from({ length: 400 }, (_, i) => ({
    id: `t${i}`,
    slug: `store-${i}`,
    name: `Store ${i}`,
    status: "active",
  }));
  const dir = buildTenantDirectory(many, {});
  check("the page is capped", dir.tenants.length <= 100, dir.tenants.length);
  check("the true total is still reported", dir.total === 400, dir.total);
  check("the caller is told it was truncated", dir.truncated === true, dir);
  const asked = buildTenantDirectory(many, { limit: 5 });
  check("an explicit limit is honoured", asked.tenants.length === 5, asked.tenants.length);
}

section("Journey 10 — schema, core, branding tool and route agree");
{
  check("the tool is named list_whitelabel_tenants", LIST_TENANTS_TOOL.name === "list_whitelabel_tenants", LIST_TENANTS_TOOL.name);
  check("the tool is marked read-only", (LIST_TENANTS_TOOL as any).annotations?.readOnlyHint === true, (LIST_TENANTS_TOOL as any).annotations);
  const props = (LIST_TENANTS_TOOL.inputSchema as Record<string, any>).properties ?? {};
  check("it accepts a free-text query", props.query?.type === "string", props);
  check("it accepts a limit", props.limit?.type === "number", props);
  check("it accepts the fallback admin token", props.adminToken?.type === "string", props);
  check("no tenant slug is required to list", !((LIST_TENANTS_TOOL.inputSchema as any).required ?? []).length, (LIST_TENANTS_TOOL.inputSchema as any).required);

  const route = readFileSync(join(process.cwd(), "src/app/api/mcp/route.ts"), "utf8");
  check("the route imports the lookup tool", route.includes("@/lib/mcp/tenant-lookup-tool"), null);
  check("tools/list advertises it", route.includes("LIST_TENANTS_TOOL"), null);
  check("the route dispatches it", route.includes("callListTenants"), null);
  const instructions = route.slice(route.indexOf("instructions:"), route.indexOf("instructions:") + 2600);
  check(
    "the server instructions tell the model it can find a store by name",
    /list_whitelabel_tenants/.test(instructions),
    null,
  );

  const branding = readFileSync(join(process.cwd(), "src/lib/mcp/update-branding-tool.ts"), "utf8");
  check("the branding tool resolves through the shared lookup", branding.includes("tenant-lookup"), null);
  check(
    "the branding tool no longer demands an exact slug via findUnique",
    !/findUnique\(\{\s*where:\s*\{\s*slug/.test(branding),
    null,
  );
  const slugDesc = String(
    ((UPDATE_BRANDING_TOOL.inputSchema as Record<string, any>).properties ?? {}).tenantSlug?.description ?? "",
  );
  check(
    "the branding tool's schema tells the model a name or URL works",
    /name|url/i.test(slugDesc),
    slugDesc,
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll MCP tenant lookup checks passed");
