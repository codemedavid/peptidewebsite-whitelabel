// Read a vial strength ("10mg", "500 mcg", "10 IU") out of a product name or
// variation label, so an order line can prefill a tracker vial. Pure.
//
// Only a number written right before a unit counts: "BPC-157 10MG" is 10 mg —
// the 157 is part of the name. A unit must end the word ("10mgs" is not one).

export type Strength = { value: number; unit: "mg" | "mcg" | "iu" };

// Number: 1,000 (thousands) | 2,5 / 2.5 (decimal) | 10. Never starts mid-number
// ("2x5mg" reads 5: the x ends the count).
const STRENGTH_RE = /(?<![0-9.,])(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)\s*(mcg|µg|μg|ug|mg|iu)(?![A-Za-z])/i;

const UNIT: Record<string, Strength["unit"]> = { mcg: "mcg", "µg": "mcg", "μg": "mcg", ug: "mcg", mg: "mg", iu: "iu" };

function parseNumber(raw: string): number {
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) return Number(raw.replace(/,/g, ""));
  return Number(raw.replace(",", "."));
}

function parseOne(text: string): Strength | null {
  const m = STRENGTH_RE.exec(text);
  if (!m) return null;
  const value = parseNumber(m[1]);
  const unit = UNIT[m[2].toLowerCase()];
  return unit && Number.isFinite(value) && value > 0 ? { value, unit } : null;
}

/** The first text (in order) that states a strength; null when none does. */
export function parseStrength(...texts: (string | null | undefined)[]): Strength | null {
  for (const t of texts) {
    if (typeof t !== "string" || !t.trim()) continue;
    const s = parseOne(t.slice(0, 300));
    if (s) return s;
  }
  return null;
}
