// Pure core for the MCP store-settings tools (npm run test:mcp-store-settings).
//
// The website's own normalizers (inside actions/storefront-admin.ts) stay the
// authority on what a saved row looks like — the MCP tools run those exact
// actions as the store owner. This module is the step BEFORE them, the part a
// person never needs because the admin editor does it for them:
//
//   • fill in the ids the normalizers require (a courier, shipping row or promo
//     code without one is silently DROPPED by the website save), reusing the id
//     of an existing same-named row so products and shipping rows that point at
//     a category / courier keep pointing at it;
//   • refuse — never drop — anything that still can't be made valid, because an
//     agent cannot see the store and a half-applied save reported as success is
//     worse than an error;
//   • merge partial patches for the few settings the website only ever saves
//     whole (contact channels, footer);
//   • project branding.config for reading with every secret reduced to "is set".
//
// No Prisma, no server-only, no React: the tool shells do the I/O.

import { CONTACT_CHANNEL_META } from "@/lib/storefront/contact-channels";
import { categoryImage } from "@/lib/storefront/categories";
import { safeExternalUrl } from "@/lib/storefront/courier-booking";
import { normalizeSocialHref, SOCIAL_PLATFORMS } from "@/lib/storefront/footer-links";
import type { ContactChannel, ContactChannelType } from "@/storefront/types";

export type Row = Record<string, unknown>;
export type Prepared<T = Row> = { ok: true; rows: T[] } | { ok: false; error: string };

const MAX_ID = 64;

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" ? String(value) : "";
}

function plainObject(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : null;
}

function slugId(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID - 4);
  return slug || fallback;
}

function sameName(a: unknown, b: unknown): boolean {
  return text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== "";
}

/**
 * New rows with an id on every one. A row's own id wins; otherwise the id of the
 * existing row with the same name; otherwise a slug of the name, suffixed until
 * unique. The input rows are never mutated.
 */
export function assignIds(rows: readonly Row[], nameKey: string, existing: readonly Row[]): Row[] {
  const taken = new Set<string>();
  const explicit = new Set(rows.map((r) => text(r.id, MAX_ID)).filter(Boolean));
  return rows.map((row, i) => {
    const own = text(row.id, MAX_ID);
    const reused = own ? "" : text(existing.find((e) => sameName(e[nameKey], row[nameKey]))?.id, MAX_ID);
    let id = own || (reused && !explicit.has(reused) && !taken.has(reused) ? reused : "");
    if (!id) {
      const base = slugId(text(row[nameKey]), `row-${i + 1}`);
      id = base;
      for (let n = 2; taken.has(id) || explicit.has(id); n++) id = `${base}-${n}`;
    }
    taken.add(id);
    return { ...row, id };
  });
}

function asRows(raw: unknown, label: string): { ok: true; rows: Row[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${label} must be a list.` };
  const rows: Row[] = [];
  for (const [i, item] of raw.entries()) {
    const row = plainObject(item);
    if (!row) return { ok: false, error: `${label} #${i + 1} must be an object.` };
    rows.push(row);
  }
  return { ok: true, rows };
}

/** Two rows sharing an explicit id would be collapsed by the website normalizer
 *  (the later one silently dropped), so refuse the batch and name the id. */
function duplicateIdError(rows: readonly Row[], label: string): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const id = text(r.id, MAX_ID);
    if (!id) continue;
    if (seen.has(id)) return `${label} id "${id}" is used twice — each row needs its own id.`;
    seen.add(id);
  }
  return null;
}

/** Existing rows the new list no longer contains (by id). The tools refuse a
 *  save that removes rows unless the caller confirms, because products point at
 *  category ids and shipping rows at courier ids. */
export function removedRows(next: readonly Row[], existing: readonly Row[]): Row[] {
  const kept = new Set(next.map((r) => text(r.id, MAX_ID)));
  return existing.filter((e) => text(e.id, MAX_ID) && text(e.id) !== "all" && !kept.has(text(e.id, MAX_ID)));
}

/** The refusal a tool returns when a whole-list save would remove rows the
 *  caller did not confirm removing; null when nothing is removed or confirmed. */
export function removalError(
  section: string,
  next: readonly Row[],
  existing: readonly Row[],
  nameKey: string,
  confirmed: boolean,
): string | null {
  if (confirmed) return null;
  const gone = removedRows(next, existing);
  if (gone.length === 0) return null;
  const names = gone.map((r) => `"${text(r[nameKey]) || text(r.id)}" (id ${text(r.id)})`).join(", ");
  return `This ${section} list would REMOVE ${names}. To rename a row keep its id; to really remove it, resend with confirmRemove: true.`;
}

/** Every row must carry a non-blank `key`; the first that doesn't is named. */
function requireField(rows: readonly Row[], key: string, label: string): string | null {
  const bad = rows.findIndex((r) => !text(r[key]));
  return bad === -1 ? null : `${label} #${bad + 1} needs a ${key}.`;
}

export function prepareCategories(raw: unknown, existing: readonly Row[]): Prepared {
  const parsed = asRows(raw, "Category");
  if (!parsed.ok) return parsed;
  const missing = requireField(parsed.rows, "label", "Category");
  if (missing) return { ok: false, error: missing };
  const dup = duplicateIdError(parsed.rows, "Category");
  if (dup) return { ok: false, error: dup };
  if (parsed.rows.some((r) => text(r.id) === "all")) {
    return { ok: false, error: 'The "all" tab is built in — leave it out of the list.' };
  }
  const withIds = assignIds(parsed.rows, "label", existing.filter((e) => text(e.id) !== "all"));
  const bad = withIds.find((r) => r.image !== undefined && r.image !== "" && !categoryImage(r.image));
  if (bad) return { ok: false, error: `Category "${text(bad.label)}" has an image that is not a usable http(s) URL.` };
  return {
    ok: true,
    rows: withIds.map((r) => {
      const image = categoryImage(r.image);
      return image ? { id: r.id, label: text(r.label, 120), image } : { id: r.id, label: text(r.label, 120) };
    }),
  };
}

export function preparePaymentMethods(raw: unknown, existing: readonly Row[]): Prepared {
  const parsed = asRows(raw, "Payment method");
  if (!parsed.ok) return parsed;
  const missing = requireField(parsed.rows, "name", "Payment method") ?? duplicateIdError(parsed.rows, "Payment method");
  if (missing) return { ok: false, error: missing };
  const badQr = parsed.rows.find((r) => text(r.qrImage) && !categoryImage(r.qrImage));
  if (badQr) return { ok: false, error: `Payment method "${text(badQr.name)}" qrImage must be an http(s) image URL.` };
  return {
    ok: true,
    rows: assignIds(parsed.rows, "name", existing).map((r, i) => ({
      ...r,
      order: Number.isFinite(Number(r.order)) && r.order !== undefined ? Number(r.order) : i + 1,
    })),
  };
}

export function prepareCouriers(raw: unknown, existing: readonly Row[]): Prepared {
  const parsed = asRows(raw, "Courier");
  if (!parsed.ok) return parsed;
  const missing = requireField(parsed.rows, "name", "Courier") ?? duplicateIdError(parsed.rows, "Courier");
  if (missing) return { ok: false, error: missing };
  const unsafe = parsed.rows.find((r) => text(r.bookingUrl) && !safeExternalUrl(r.bookingUrl));
  if (unsafe) return { ok: false, error: `Courier "${text(unsafe.name)}" bookingUrl must be an http(s) link.` };
  return { ok: true, rows: assignIds(parsed.rows, "name", existing) };
}

/**
 * Shipping rows link to a courier by id. An agent knows the courier's NAME, so
 * `courier` may be either; it resolves against the couriers the store will have
 * after this save. `code` defaults to a slug of the name.
 */
export function prepareShippingLocations(
  raw: unknown,
  couriers: readonly Row[],
  existing: readonly Row[],
): Prepared {
  const parsed = asRows(raw, "Shipping location");
  if (!parsed.ok) return parsed;
  const missing = requireField(parsed.rows, "name", "Shipping location") ?? duplicateIdError(parsed.rows, "Shipping location");
  if (missing) return { ok: false, error: missing };

  const rows: Row[] = [];
  for (const row of assignIds(parsed.rows, "name", existing)) {
    const ref = text(row.courierId) || text(row.courier);
    let courierId = "";
    if (ref) {
      const match = couriers.find((c) => text(c.id) === ref || sameName(c.name, ref));
      if (!match) {
        const known = couriers.map((c) => text(c.name)).filter(Boolean).join(", ") || "none yet";
        return { ok: false, error: `Shipping location "${text(row.name)}" names courier "${ref}", which is not a courier of this store (known: ${known}).` };
      }
      courierId = text(match.id);
    }
    const { courier: _courier, ...rest } = row;
    void _courier;
    rows.push({ ...rest, courierId, code: text(row.code, MAX_ID) || slugId(text(row.name), text(row.id)) });
  }
  return { ok: true, rows };
}

export function preparePromoCodes(raw: unknown, existing: readonly Row[]): Prepared {
  const parsed = asRows(raw, "Promo code");
  if (!parsed.ok) return parsed;
  const missing = requireField(parsed.rows, "code", "Promo code") ?? duplicateIdError(parsed.rows, "Promo code");
  if (missing) return { ok: false, error: missing };
  return { ok: true, rows: assignIds(parsed.rows, "code", existing) };
}

/**
 * normalizePromoCodes reads `used` from the payload and treats a missing one as
 * 0, so a list rewrite would silently reset every code's usage — re-opening
 * codes that hit their usageLimit. Carry the stored count over unless the row
 * sets one explicitly.
 */
export function carryPromoUsage(rows: readonly Row[], existing: readonly Row[]): Row[] {
  return rows.map((row) => {
    if (row.used !== undefined) return row;
    const before = existing.find((e) => text(e.id) !== "" && text(e.id) === text(row.id));
    return before?.used !== undefined ? { ...row, used: before.used } : row;
  });
}

const CHANNEL_TYPES: readonly ContactChannelType[] = CONTACT_CHANNEL_META.map((m) => m.type);

/**
 * Merge a partial contact-channel patch over the stored channels. Only the
 * channels named change; a named channel keeps any field the patch omits.
 * Enabling a channel with no destination is refused (the storefront would show
 * a dead button) — the same rule saveContactChannelsAction enforces.
 */
export function patchContactChannels(
  current: unknown,
  patch: unknown,
): { ok: true; channels: ContactChannel[] } | { ok: false; error: string } {
  const parsed = asRows(patch, "Contact channel");
  if (!parsed.ok) return parsed;
  const stored = Array.isArray(current) ? current.map(plainObject).filter((c): c is Row => !!c) : [];

  const unknown = parsed.rows.find((r) => !CHANNEL_TYPES.includes(r.type as ContactChannelType));
  if (unknown) {
    return { ok: false, error: `Unknown contact channel "${text(unknown.type)}". Use one of: ${CHANNEL_TYPES.join(", ")}.` };
  }

  const channels = CHANNEL_TYPES.map((type): ContactChannel => {
    const before = stored.find((c) => c.type === type) ?? {};
    const change = parsed.rows.find((r) => r.type === type) ?? {};
    const destination = "destination" in change ? text(change.destination) : text(before.destination);
    const enabled = "enabled" in change ? change.enabled === true : before.enabled === true;
    return { type, destination, enabled };
  });

  const broken = channels.find((c) => c.enabled && !c.destination);
  if (broken) return { ok: false, error: `Add a destination for ${broken.type}, or leave it disabled.` };
  return { ok: true, channels };
}

const SOCIAL_ICONS = SOCIAL_PLATFORMS.map((p) => p.icon);

/** A footer column link the storefront renders as <a href>: an in-store route
 *  (#hash or /path), mailto:/tel:, or an http(s) URL. Anything else — notably
 *  javascript: and data: — is refused, since every shopper could click it. */
function safeFooterHref(raw: unknown): string {
  const href = text(raw, 500);
  if (!href) return "";
  if (/^#[\w-]*/.test(href) || /^\/(?!\/)/.test(href)) return href;
  if (/^(mailto|tel):[^\s]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? href : "";
  } catch {
    return "";
  }
}

/**
 * Footer patch → flat branding.config keys. Socials are given as
 * {platform, url}; each url must survive normalizeSocialHref (http(s) only),
 * because the storefront would otherwise quietly hide it and the agent would
 * report a link that never appears.
 */
export function normalizeFooterPatch(raw: unknown): { ok: true; patch: Row } | { ok: false; error: string } {
  const o = plainObject(raw);
  if (!o) return { ok: false, error: "footer must be an object." };
  const patch: Row = {};

  if (o.socials !== undefined) {
    const parsed = asRows(o.socials, "Social link");
    if (!parsed.ok) return parsed;
    const socials: Row[] = [];
    for (const s of parsed.rows) {
      const icon = text(s.platform).toLowerCase();
      if (!SOCIAL_ICONS.includes(icon)) {
        return { ok: false, error: `Unknown social platform "${text(s.platform)}". Use one of: ${SOCIAL_ICONS.join(", ")}.` };
      }
      const href = normalizeSocialHref(s.url);
      if (!href) return { ok: false, error: `The ${icon} link must be a web address, e.g. ${icon}.com/yourstore.` };
      const label = SOCIAL_PLATFORMS.find((p) => p.icon === icon)?.label ?? icon;
      socials.push({ label, href, icon, show: s.show !== false });
    }
    patch.footerSocials = socials;
  }

  if (o.columns !== undefined) {
    const parsed = asRows(o.columns, "Footer column");
    if (!parsed.ok) return parsed;
    const columns: Row[] = [];
    for (const c of parsed.rows) {
      const links: Row[] = [];
      for (const l of (Array.isArray(c.links) ? c.links : []).map(plainObject).filter((x): x is Row => !!x)) {
        const href = safeFooterHref(l.href);
        if (!href) {
          return { ok: false, error: `Footer link "${text(l.label)}" must be a #route, /path, mailto:, tel: or http(s) URL.` };
        }
        if (text(l.label, 80)) links.push({ label: text(l.label, 80), href });
      }
      columns.push({ title: text(c.title, 80), links });
    }
    patch.footerColumns = columns;
  }

  const strings: Record<string, string> = {
    blurb: "footerBlurb",
    disclaimer: "footerDisclaimer",
    copyright: "footerCopyright",
  };
  for (const [key, configKey] of Object.entries(strings)) {
    if (o[key] !== undefined) patch[configKey] = text(o[key], 600);
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "footer has nothing to change." };
  return { ok: true, patch };
}

/** branding.config keys the read tool returns verbatim — none hold a secret. */
const READABLE_KEYS = [
  "name",
  "currency",
  "homeLayout",
  "categories",
  "paymentMethods",
  "couriers",
  "shippingLocations",
  "contactChannels",
  "checkoutTitle",
  "checkoutNote",
  "requireProofOfPayment",
  "promoCodes",
  "faqGroups",
  "coaReports",
  "reviews",
  "noticeModal",
  "trackNote",
  "storeStatus",
  "checkoutRules",
  "adminFee",
  "footerSocials",
  "footerColumns",
  "footerBlurb",
  "footerDisclaimer",
  "footerCopyright",
  "heroMedia",
  "orderNotifications",
] as const;

export type CredentialFacts = { storeAdminEmail: string | null; hasPassword: boolean; hasAccessCode: boolean };

/** What get_store_settings returns: allow-listed config + secrets as booleans. */
export function projectStoreSettings(config: Row, facts: CredentialFacts): Row {
  const view: Row = {};
  for (const key of READABLE_KEYS) {
    if (config[key] !== undefined) view[key] = config[key];
  }
  const gate = plainObject(config.accessGate) ?? {};
  view.accessGate = {
    enabled: gate.enabled === true,
    heading: text(gate.heading, 120),
    codeSet: facts.hasAccessCode,
  };
  view.adminLogin = { email: facts.storeAdminEmail ?? "", passwordSet: facts.hasPassword };
  return view;
}

/**
 * The website store-admin actions run_store_admin_action may call, with the
 * argument each expects. Config only: nothing that lists orders or customers
 * (PII would leave the platform for the model provider), nothing that deletes,
 * nothing that manages staff or billing. Each of these still runs its own
 * store-admin guard, plan lock and validation.
 */
export const STORE_ACTION_ALLOWLIST: Readonly<Record<string, string>> = Object.freeze({
  saveHeroContentAction: "[hero] — hero copy object, as stored at branding.config hero fields.",
  saveBannerAction: "[banner] — announcement banner config.",
  saveCheckoutRulesAction: "[rules] — checkout rules (minimums etc.).",
  saveStoreAdminFeeAction: "[{enabled,label,amount}] — owner-side admin fee.",
  saveOrderNotificationsAction: "[{enabled,email}] — new-order email alert recipient.",
  saveSortCategoriesAction: "[sortCategories] — catalog sort dropdown entries.",
  saveProductOrderAction: "[productIds] — catalog arrangement, an ordered list of product ids.",
  saveCardDesignAction: "[cardDesign] — product card design.",
  saveCardTemplatesAction: "[templates] — saved card templates.",
  saveProtocolsAction: "[protocols] — protocol guides.",
  saveCurrencyAction: "[currency] — symbol or ISO code; re-stamps every product.",
  getResellerSettingsAction: "[] — read reseller settings.",
  saveResellerSettingsAction: "[settings] — reseller portal settings.",
  getGateSettingsAction: "[] — read the access-gate settings.",
  saveGroupBuyRulesAction: "[rules] — group-buy order ratio rules.",
  listGroupBuysAction: "[] — list group-buy rounds.",
  saveGroupBuyAction: "[round] — create or edit a group-buy round.",
  duplicateGroupBuyAction: "[roundId] — copy a round.",
  setGroupBuyArchivedAction: "[roundId, archived] — archive or restore a round.",
  saveGroupBuyProductPricingAction: "[pricing] — per-product group-buy prices.",
  saveGroupBuyAllowOnHandAction: "[boolean] — allow on-hand items during a live round.",
  saveTwoWaysModeAction: "[mode] — open/closed/hidden per order path.",
  saveGroupBuyContentAction: "[content] — 'How group buys work' copy.",
  saveGroupBuyLiveBannerAction: "[banner] — app LIVE strip.",
  saveGroupBuyInvoiceAction: "[invoice] — group-buy invoice settings.",
  saveGroupBuyPaymentModeAction: "[mode] — \"pay_first\" (pay at checkout) or \"pay_later\" (pay after the round closes).",
});

export function isAllowedStoreAction(name: unknown): name is string {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(STORE_ACTION_ALLOWLIST, name);
}
