/**
 * COA (Lab Reports) pure core.
 *
 * A store's lab reports (branding.config.coaReports) are edited in the
 * storefront #admin and persisted server-side — the DB-persistence fix for the
 * bug where COA reports lived only in the editing browser's localStorage and so
 * never reached other devices/customers (a fresh device always fell back to the
 * generic SEED_COA_REPORTS samples). This module is the single sanitizer the
 * server save action (saveCoaReportsAction) runs at the trust boundary before
 * writing untrusted client input into `branding.config.coaReports`.
 *
 * Pure module (no DB, no Next runtime, no browser). Covered by scripts/test-coa.ts.
 */

import type { CoaReport } from "@/storefront/types";
import { safeHttpUrl } from "@/lib/storefront/hero-links";

/** Hard caps so a malformed/hostile blob can never bloat branding.config. */
export const MAX_COA_REPORTS = 200;
export const MAX_COA_NAME = 200;
export const MAX_COA_TEXT = 120;

/**
 * Coerce untrusted COA config into a closed, safe CoaReport[]. Never throws:
 * non-array input and garbage entries collapse away, name-less rows are dropped
 * (a report with no name is meaningless and the editor requires one), counts
 * and string lengths are capped, and image/link are kept http(s)-only so a
 * javascript:/data: URL can never reach an <img src> or <a href>.
 */
export function normalizeCoaReports(input: unknown): CoaReport[] {
  if (!Array.isArray(input)) return [];
  const out: CoaReport[] = [];
  input.slice(0, MAX_COA_REPORTS).forEach((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return;
    const o = r as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, MAX_COA_NAME);
    if (!name) return; // drop name-less rows
    const id = String(o.id ?? "").trim().slice(0, 60) || `coa-${i}`;
    out.push({
      id,
      name,
      lab: String(o.lab ?? "").slice(0, MAX_COA_TEXT),
      date: String(o.date ?? "").slice(0, MAX_COA_TEXT),
      purity: String(o.purity ?? "").slice(0, MAX_COA_TEXT),
      image: safeHttpUrl(o.image as string | undefined | null),
      link: safeHttpUrl(o.link as string | undefined | null),
    });
  });
  return out;
}
