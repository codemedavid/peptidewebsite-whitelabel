// Pure core for the storefront FAQ page. Shared by the store-admin save action
// (server) and any client reader, so it must stay free of any DB / Next /
// browser dependency — it is exercised directly by test:faq.
//
// This module is the single place that sanitizes the owner's untrusted FAQ
// groups before they are persisted into `branding.config.faqGroups` (the fix
// for FAQ edits living only in localStorage and never reaching other devices).

import type { FaqGroup, FaqItem } from "../../storefront/types";

// The icon choices offered by the FAQ editor's group dropdown, kept as a
// readonly tuple so it is both iterable (tests/UI) and a closed literal union.
export const FAQ_ICONS = ["shipping", "payment", "product", "default"] as const;

export const MAX_FAQ_GROUPS = 20;
export const MAX_FAQ_ITEMS = 40;
export const MAX_FAQ_LABEL = 120;
export const MAX_FAQ_QUESTION = 300;
export const MAX_FAQ_ANSWER = 4000;

const FAQ_ICON_SET: ReadonlySet<string> = new Set(FAQ_ICONS);

// Coerce one untrusted Q/A row. Blank rows are deliberately KEPT — the editor
// adds empty rows the owner is still typing into, and they must survive a
// save → reload round-trip; only non-object garbage is dropped (→ null).
function normalizeItem(raw: unknown): FaqItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    q: String(o.q ?? "").trim().slice(0, MAX_FAQ_QUESTION),
    a: String(o.a ?? "").trim().slice(0, MAX_FAQ_ANSWER),
  };
}

/**
 * Coerce untrusted FAQ config into a closed, safe FaqGroup[] before it is
 * written to branding.config: garbage entries dropped, icons whitelisted
 * (unknown → "default"), a deterministic per-index id when none was provided,
 * and counts + string lengths capped. Never throws — non-array input
 * collapses to [].
 */
export function normalizeFaqGroups(input: unknown): FaqGroup[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw, index): FaqGroup | null => {
      if (!raw || typeof raw !== "object") return null;
      const o = raw as Record<string, unknown>;

      const providedId = typeof o.id === "string" ? o.id.trim() : "";
      const icon = FAQ_ICON_SET.has(o.icon as string) ? (o.icon as string) : "default";
      const items = Array.isArray(o.items)
        ? o.items
            .map(normalizeItem)
            .filter((it): it is FaqItem => it !== null)
            .slice(0, MAX_FAQ_ITEMS)
        : [];

      return {
        id: providedId || `g${index}`,
        label: String(o.label ?? "").trim().slice(0, MAX_FAQ_LABEL),
        icon,
        items,
      };
    })
    .filter((g): g is FaqGroup => g !== null)
    .slice(0, MAX_FAQ_GROUPS);
}
