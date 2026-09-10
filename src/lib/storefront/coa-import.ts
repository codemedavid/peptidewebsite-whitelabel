// Pure core for importing lab certificates (COAs) into a tenant's Lab Reports.
//
// Lab reports live in the shared `branding.config.coaReports` JSON array — the
// same one the store admin edits — so a bulk import is a read-modify-write that
// must not lose or duplicate a row. They are also PUBLISHED CLAIMS about a
// product's purity, so this builder refuses anything it cannot render
// faithfully rather than writing a row that quietly degrades: the server
// normalizer drops name-less rows and strips non-http images, and the COA card
// renders the date through `new Date(...)`, which turns a loose format into
// "Invalid Date" or a locale-dependent string.
//
// No DB / ImageKit / Next dependency, so the import scripts and
// test:coa-import share one core.

import type { CoaReport } from "@/storefront/types";

/** ISO calendar date — the only format the COA card renders identically for
 *  every visitor, whatever their locale. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  // Round-trips only if the calendar date actually exists (rejects 2026-13-45).
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Stable id for a report, derived from its name. Deriving rather than counting
 * means a re-import refreshes the same row instead of appending a copy, and it
 * makes a name collision inside one batch detectable (see mergeCoaReportsById).
 */
export function coaReportId(name: string): string {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return `coa-${slug}`;
}

/**
 * Build one CoaReport from a certificate's metadata.
 *
 * `purity` is the headline result chip on the card and may be blank — plenty of
 * certificates (sterility, heavy metals, pH) report no purity figure at all.
 * `link` defaults to empty, which makes the card open the certificate image
 * itself; pass one only when there is a real per-report verification URL.
 */
export function buildCoaReport(input: {
  name: string;
  lab: string;
  date: string;
  purity: string;
  image: string;
  link?: string;
}): CoaReport {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("buildCoaReport: report name is required");

  const image = String(input.image ?? "").trim();
  if (!image) throw new Error(`buildCoaReport: "${name}" has no certificate image`);
  if (!/^https:\/\//i.test(image)) {
    throw new Error(`buildCoaReport: "${name}" image must be an https URL, got "${image}"`);
  }

  const date = String(input.date ?? "").trim();
  if (date && !isRealIsoDate(date)) {
    throw new Error(`buildCoaReport: "${name}" date must be YYYY-MM-DD, got "${date}"`);
  }

  return {
    id: coaReportId(name),
    name,
    lab: String(input.lab ?? "").trim(),
    date,
    purity: String(input.purity ?? "").trim(),
    image,
    link: String(input.link ?? "").trim(),
  };
}

/**
 * Upsert `incoming` reports into a tenant's `existing` list by id.
 *
 * A report whose id already exists is REFRESHED where it sits; the rest are
 * appended in input order. Reports the import does not mention are always kept.
 * Two incoming reports sharing an id would collapse into one row and silently
 * lose a lab result, so that throws rather than writing a lossy list. Neither
 * input list is mutated.
 */
export function mergeCoaReportsById(
  existing: readonly CoaReport[],
  incoming: readonly CoaReport[],
): CoaReport[] {
  const byId = new Map<string, CoaReport>();
  for (const r of incoming) {
    if (byId.has(r.id)) {
      throw new Error(`mergeCoaReportsById: duplicate report id "${r.id}" ("${r.name}")`);
    }
    byId.set(r.id, r);
  }

  const used = new Set<string>();
  const merged = existing.map((r) => {
    const replacement = byId.get(r.id);
    if (!replacement) return r;
    used.add(r.id);
    return replacement;
  });

  for (const [id, r] of byId) {
    if (!used.has(id)) merged.push(r);
  }
  return merged;
}
