// GET /tracker/store-guides — the store's written Protocols as tracker guide
// templates (docs/mobile-admin/TRACKER.md §6: an explicit copy into an editable
// draft). Pure. Reads branding.config.protocols the same way the storefront and
// the community cards do (lib/community/cards.server.ts loadProtocolCards).
// Image-mode protocols are pictures, with no fields to copy, so they're left out.

import type { TrackerStoreGuide } from "@/lib/mobile/contract";

const MAX_GUIDES = 200;
const MAX_NOTES = 30;

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function toStoreGuides(config: unknown): TrackerStoreGuide[] {
  const list = config && typeof config === "object" ? (config as { protocols?: unknown }).protocols : undefined;
  if (!Array.isArray(list)) return [];
  const out: TrackerStoreGuide[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (p.mode === "image") continue;
    const name = str(p.name, 120);
    if (!name) continue;
    out.push({
      name,
      category: str(p.category, 80),
      dosage: str(p.dosage),
      frequency: str(p.frequency),
      duration: str(p.duration),
      storage: str(p.storage),
      notes: Array.isArray(p.notes) ? p.notes.map((n) => str(n)).filter(Boolean).slice(0, MAX_NOTES) : [],
    });
    if (out.length >= MAX_GUIDES) break;
  }
  return out;
}
