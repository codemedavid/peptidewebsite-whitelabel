// Pure core for importing owner-supplied protocol guides into a tenant's
// protocol collection. Protocols live in the `branding.config` JSON blob (no
// SQL table), so a bulk import is a read-modify-write of one shared array —
// the risk is silently dropping or duplicating rows the owner typed by hand.
// These helpers are the guard, and they stay free of DB / ImageKit / Next
// dependencies so the import scripts and test:protocol-import share one core.

import { MAX_PROTOCOL_IMAGES } from "@/lib/storefront/protocol-images";
import type { Protocol } from "@/storefront/types";

/**
 * The key two protocols are considered "the same" by. Owners retype names with
 * different casing, spacing and punctuation ("MicaBlend 2.0 tirzepatide 30mg"
 * vs "Micablend 2.0  Tirzepatide 30mg"), so matching on the raw string would
 * duplicate a row the store already shows. Strength numbers survive — "GHK-Cu
 * 50mg" and "GHK-Cu 100mg" stay distinct protocols.
 */
export function protocolKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build an image-mode Protocol from a guide's page images. In "image" mode the
 * images *are* the protocol — the written fields are hidden on the storefront —
 * so they are emitted empty rather than filled with invented dosing text the
 * owner never approved. The owner can switch the row to "details" in the admin
 * and type them later.
 *
 * Fails fast (rather than writing a blank row) when the guide yielded no usable
 * image or no name, since an image-mode protocol with an empty gallery renders
 * as an empty accordion on the public page.
 */
export function buildImageProtocol(input: {
  name: string;
  category: string;
  images: readonly string[];
}): Protocol {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("buildImageProtocol: protocol name is required");

  const images = (input.images ?? [])
    .map((src) => String(src ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_PROTOCOL_IMAGES);
  if (images.length === 0) {
    throw new Error(`buildImageProtocol: "${name}" has no usable image`);
  }

  return {
    category: String(input.category ?? "").trim(),
    name,
    dosage: "",
    frequency: "",
    duration: "",
    notes: [],
    storage: "",
    images,
    // Mirrored so a legacy reader that predates `images[]` still resolves one.
    image: images[0],
    mode: "image",
  };
}

/**
 * Upsert `incoming` protocols into a tenant's `existing` list by name.
 *
 * A same-named protocol is REPLACED where it already sits (so re-running an
 * import refreshes a guide instead of stacking copies, and the owner's ordering
 * survives); everything else is appended in input order. Existing protocols the
 * import does not mention are always kept — a bulk import must never quietly
 * delete a row the owner typed. Duplicate names inside one batch collapse to
 * the last occurrence. Neither input list is mutated.
 */
export function mergeProtocolsByName(
  existing: readonly Protocol[],
  incoming: readonly Protocol[],
): Protocol[] {
  const byKey = new Map<string, Protocol>();
  for (const p of incoming) byKey.set(protocolKey(p.name), p);

  const used = new Set<string>();
  const merged = existing.map((p) => {
    const key = protocolKey(p.name);
    const replacement = byKey.get(key);
    if (!replacement) return p;
    used.add(key);
    return replacement;
  });

  for (const [key, p] of byKey) {
    if (!used.has(key)) merged.push(p);
  }
  return merged;
}
