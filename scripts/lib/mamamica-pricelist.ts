// Pure build of Mama Mica Glow's shop catalog from the owner's pricelist sheet
// (scripts/data/mamamica-pricelist-2026-08-25.json — a straight export of
// "Mica - Pricelist 8_25_25 - Updated Pricelist.csv") and the curated families in
// ./mamamica-families.ts. Verified by scripts/test-mamamica-pricelist.ts;
// written by scripts/seed-mamamica-products.ts.
//
// Decisions (owner, 2026-10-08):
//
//   • PER VIAL ONLY. Each option sells at the sheet's "Per vial cost" column, never
//     the 10-vial box. Rows with no per-vial cell (shampoos, printers, gummies…)
//     are single units, so the sheet's price column is the unit price. One row
//     (HGH Fragment) prints "OUT OF STOCK" in the vial cell: its box ÷ 10.
//   • HIDE OUT ITEMS. A size is OUT only when BOTH stock columns say so — Mica's
//     Luzon & Visayas column ("out") AND the Mindanao column ("OUT…"). Such sizes
//     are left off the product; a family whose every size is out is saved as a
//     draft (hidden) so the owner can switch it back on.
//   • The sheet's stock words (PLENTY, LOW, COUPLE BOXES…) are not counts, so live
//     options get PLACEHOLDER_STOCK for the owner to correct in the store admin.
//   • "Mica's Top Pick / HIGHLY RECOMMENDS / FAVORITE" lines mark `featured`
//     products instead of being repeated in the description.
//
// Sheet quirks handled deliberately:
//   • RETALIDE is printed twice; the first (unstocked, 30mg spec) row is dropped
//     for pricing, its "Community Exclusive Blend" copy is kept.
//   • Mazdutide and KLOW carry an LL-37 lab block pasted from the LL-37 row; that
//     block is dropped so a customer never reads another compound's test as theirs.

import { slugify } from "../../src/lib/storefront/product-mapping";
import pricelist from "../data/mamamica-pricelist-2026-08-25.json";
import { MAMAMICA_FAMILIES, type MamamicaCategoryId, type MamamicaFamily } from "./mamamica-families";

export type SheetRow = {
  row: number;
  code: string;
  name: string;
  spec: string;
  usd: string;
  box: string;
  vial: string;
  note: string;
  luzon: string;
  mindanao: string;
};

export type MamamicaOption = { code: string; label: string; price: number; stock: number };

export type MamamicaProduct = {
  sku: string;
  slug: string;
  name: string;
  category: MamamicaCategoryId;
  description: string;
  featured: boolean;
  /** false = saved as a draft (every size is out). */
  active: boolean;
  /** The cheapest option — the card's "from" price. */
  price: number;
  /** What sells: live sizes only, or every size (stock 0) on a hidden product. */
  options: MamamicaOption[];
  /** Every sheet code the family covers, hidden sizes included. */
  allCodes: string[];
};

/** Live options' stock until the owner sets real counts in the store admin. */
export const PLACEHOLDER_STOCK = 100;
/** Vials in the box the sheet prices when a per-vial cell is unusable. */
const KIT_SIZE = 10;
/** Sheet rows (1-based record numbers) never used for pricing. */
export const DROPPED_ROWS: ReadonlySet<number> = new Set([34]);
/** Codes whose descriptions carry another compound's lab block. */
const MISPASTED_LAB: Readonly<Record<string, RegExp>> = { MDT10: /LL-37/, KLOW80: /LL-37/ };

const HIGHLIGHT = /top pick|highly recommends|favorite/i;
const LAB_START = /^(vanguard|janoshik)\s*$/i;
const LAB_END = /^(laboratory id|unique key)\b/i;
const GENERIC_SPEC = /^\(?[\d.,\s]*(mg|mcg|iu|ml|g)\b/i;

export const normCode = (code: string): string => code.replace(/\s+/g, " ").trim();
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function sheetRows(): SheetRow[] {
  return (pricelist as { rows: SheetRow[] }).rows;
}

function parsePeso(cell: string): number | null {
  const m = cell.replace(/[₱,\s]/g, "").match(/^\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The unit price a row sells at, or null when the row prints none (inherits). */
function unitPrice(r: SheetRow): number | null {
  const vial = parsePeso(r.vial);
  if (vial !== null) return vial;
  const box = parsePeso(r.box);
  if (box === null) return null;
  return r.vial ? round2(box / KIT_SIZE) : box;
}

export function isOut(r: SheetRow): boolean {
  const luzonOut = /^out$/i.test(r.luzon) || /^out$/i.test(r.note);
  return luzonOut && /^out/i.test(r.mindanao);
}

/** Removes Vanguard/Janoshik blocks that match `pattern`. */
function dropLabBlocks(lines: string[], pattern: RegExp): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!LAB_START.test(lines[i].trim())) {
      out.push(lines[i]);
      continue;
    }
    let end = i;
    while (end < lines.length - 1 && !LAB_END.test(lines[end].trim())) end++;
    const block = lines.slice(i, end + 1);
    if (!pattern.test(block.join("\n"))) out.push(...block);
    i = end;
  }
  return out;
}

/** A short first line that just restates the product name ("Tirzepatide (With Vanguard…)"). */
function isTitleLine(line: string, family: string): boolean {
  const first = norm(family.split(/\s+/)[0] ?? "");
  return line.length <= 60 && !/[:|•]/.test(line) && first.length > 0 && norm(line).includes(first);
}

function cleanBlock(text: string, family: string, code: string): string {
  let lines = text.split("\n").filter((l) => !HIGHLIGHT.test(l));
  const mispasted = MISPASTED_LAB[code];
  if (mispasted) lines = dropLabBlocks(lines, mispasted);
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx >= 0 && isTitleLine(lines[firstIdx].trim(), family)) lines = lines.slice(firstIdx + 1);
  return lines
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function specBlock(r: SheetRow): string {
  const spec = r.spec.trim();
  if (!spec || spec === r.name.trim()) return "";
  if (!spec.includes("\n") && spec.length < 60 && GENERIC_SPEC.test(spec)) return "";
  return spec.replace(/\n{3,}/g, "\n\n");
}

function unitLine(rows: SheetRow[], unit: string): string {
  for (const r of rows) {
    const box = parsePeso(r.box);
    const vial = parsePeso(r.vial);
    if (box !== null && vial !== null && box > vial * 1.5) {
      return `Price is per ${unit} (a full box has ${Math.round(box / vial)}).`;
    }
  }
  return "";
}

function buildFamily(fam: MamamicaFamily, byCode: Map<string, SheetRow[]>): MamamicaProduct {
  const resolved = fam.options.map(([code, label]) => {
    const rows = byCode.get(normCode(code));
    if (!rows?.length) throw new Error(`${fam.name}: sheet has no row for code "${code}"`);
    const priced = rows.find((r) => !DROPPED_ROWS.has(r.row)) ?? rows[0];
    return { code: normCode(code), label, rows, priced };
  });

  let carry: number | null = null;
  const all = resolved.map((o) => {
    const price = unitPrice(o.priced) ?? carry;
    if (price === null) throw new Error(`${fam.name} / ${o.label}: no price on the sheet`);
    carry = price;
    return { ...o, price, out: isOut(o.priced) };
  });

  const live = all.filter((o) => !o.out);
  const active = live.length > 0;
  const options: MamamicaOption[] = (active ? live : all).map((o) => ({
    code: o.code,
    label: o.label,
    price: o.price,
    stock: active ? PLACEHOLDER_STOCK : 0,
  }));

  const sheet = all.flatMap((o) => o.rows);
  const blocks = all.flatMap((o) =>
    o.rows.flatMap((r) => {
      const text = [cleanBlock(r.name, fam.name, o.code), specBlock(r)].filter(Boolean).join("\n\n");
      return text && fam.labelOptions ? [`${o.label}\n${text}`] : [text];
    }),
  );
  // Paragraph-level dedupe: sizes repeat the same lab results and notes.
  const paragraphs = [...new Set(blocks.flatMap((b) => (fam.labelOptions ? [b] : b.split(/\n{2,}/))).map((p) => p.trim()))];
  const description = [unitLine(sheet, fam.unit ?? "vial"), fam.note ?? "", ...paragraphs].filter(Boolean).join("\n\n");

  const slug = slugify(fam.name);
  return {
    sku: `MM-${slug.toUpperCase()}`,
    slug,
    name: fam.name,
    category: fam.category,
    description,
    featured: sheet.some((r) => HIGHLIGHT.test(r.name)),
    active,
    price: Math.min(...options.map((o) => o.price)),
    options,
    allCodes: all.map((o) => o.code),
  };
}

export function buildMamamicaProducts(): MamamicaProduct[] {
  const byCode = new Map<string, SheetRow[]>();
  for (const r of sheetRows()) {
    const key = normCode(r.code);
    byCode.set(key, [...(byCode.get(key) ?? []), r]);
  }
  return MAMAMICA_FAMILIES.map((fam) => buildFamily(fam, byCode));
}
