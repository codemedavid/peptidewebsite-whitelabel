// Editing a product's variation list as a set of CHANGES rather than a whole
// new array — the rules behind the MCP connector's manage_product_variations.
//
// The storefront's other variation module (./variations) decides what a customer
// may pick and pay. This one decides what an *editor* may do to that list, and
// it exists because the connector's only previous route to a variation was
// update_products, whose patch semantics replace the array wholesale. An agent
// asked to "add a 10mg option" cannot see the other options, so a replace is
// indistinguishable from deleting them — mstomato sells 81 colorways behind one
// product, and one helpful `variations: [{ 10mg }]` would have wiped 80 of them.
//
// Pure by design (no DB, no Next runtime) so the decision can be asserted whole:
// npm run test:mcp-variations. The route is only the shell around it.

import { normalizeHostedImageUrl } from "./product-image";
import type { Variation } from "./variations";

/** Ceiling on a product's option list, matching the cap normalizeProductInput
 *  already enforces (`slice(0, 100)`). Named here so a caller can refuse a long
 *  list loudly instead of having the tail silently truncated on save. */
export const MAX_VARIATIONS = 100;

/** Longest option name that survives the save path (`str(x.name, 80)`). */
const MAX_NAME = 80;

export type VariationMode = "add" | "replace" | "remove";

const MODES: readonly VariationMode[] = ["add", "replace", "remove"];

export type VariationPlan = {
  /** The complete list to persist — what `variations` becomes, not a delta. */
  variations: Variation[];
  /** Option names created by this call. */
  added: string[];
  /** Option names that already existed and were patched. */
  updated: string[];
  /** Option names this call takes off the product. */
  removed: string[];
};

export type VariationPlanError = { error: string };

type Input = {
  mode?: unknown;
  variations?: unknown;
  remove?: unknown;
};

/** Case-insensitive identity for an option. Sellers type "rosegold" for
 *  "Rosegold"; matching loosely is what makes "just fix its price" work, while
 *  the SAVED name always stays the spelling the seller originally chose. */
const keyOf = (name: string) => name.trim().toLocaleLowerCase();

type NumberRead =
  | { kind: "missing" }
  | { kind: "clear" }
  | { kind: "invalid" }
  | { kind: "value"; value: number };

/**
 * Read an optional numeric field.
 *
 * `undefined` is "don't touch this", `null` is "clear it", and a blank string is
 * INVALID rather than 0 — `Number("")` is 0, and letting that through is exactly
 * how an option ends up on sale for free.
 */
function readNumber(raw: unknown): NumberRead {
  if (raw === undefined) return { kind: "missing" };
  if (raw === null) return { kind: "clear" };
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "" || typeof value === "boolean") return { kind: "invalid" };
  const n = Number(value);
  return Number.isFinite(n) ? { kind: "value", value: n } : { kind: "invalid" };
}

type Edit = {
  name: string;
  key: string;
  price?: number;
  stock?: number | null;
  gbPrice?: number | null;
  image?: string | null;
};

/** Parse one requested edit, or say precisely what is wrong with it. Every
 *  message names the option, because the operator is reading it through a chat
 *  transcript with no view of the store. */
function parseEdit(raw: unknown, position: number): Edit | VariationPlanError {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `Variation ${position} must be an object with a name.` };
  }
  const o = raw as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return { error: `Variation ${position} needs a name.` };

  const edit: Edit = { name, key: keyOf(name) };

  const price = readNumber(o.price);
  if (price.kind === "invalid" || price.kind === "clear") {
    return { error: `"${name}" has an unreadable price. Send a number above 0.` };
  }
  if (price.kind === "value") {
    if (price.value <= 0) {
      return { error: `"${name}" must cost more than 0 — an option priced at 0 checks out free.` };
    }
    edit.price = price.value;
  }

  const stock = readNumber(o.stock);
  if (stock.kind === "invalid") return { error: `"${name}" has an unreadable stock value.` };
  if (stock.kind === "clear") edit.stock = null;
  if (stock.kind === "value") {
    if (stock.value < 0) return { error: `"${name}" cannot have negative stock.` };
    edit.stock = Math.round(stock.value);
  }

  const gbPrice = readNumber(o.gbPrice);
  if (gbPrice.kind === "invalid") return { error: `"${name}" has an unreadable group-buy price.` };
  // 0 and null both mean "this option has no group price of its own", which the
  // cart reads as "sell it at its own price" (never at the product's gbPrice).
  if (gbPrice.kind === "clear") edit.gbPrice = null;
  if (gbPrice.kind === "value") {
    if (gbPrice.value < 0) return { error: `"${name}" cannot have a negative group-buy price.` };
    edit.gbPrice = gbPrice.value > 0 ? gbPrice.value : null;
  }

  if (o.image !== undefined) {
    if (o.image === null || o.image === "") edit.image = null;
    else {
      const image = normalizeHostedImageUrl(o.image);
      // Refused rather than dropped: the save path would silently discard a
      // data: URL, and an operator who asked for a photo deserves to hear that
      // it did not take instead of finding a blank pill later.
      if (!image) {
        return { error: `"${name}": image must be a public http(s) URL. Upload it first, then send the URL.` };
      }
      edit.image = image;
    }
  }

  return edit;
}

const isError = (v: unknown): v is VariationPlanError =>
  !!v && typeof v === "object" && "error" in (v as Record<string, unknown>);

/** Apply one parsed edit onto an option, leaving every field it did not mention
 *  exactly as it was — this is what makes "add" additive rather than a rewrite. */
function patch(current: Variation, edit: Edit): Variation {
  const next: Variation = { ...current, name: current.name };
  if (edit.price !== undefined) next.price = edit.price;
  if (edit.stock === null) delete next.stock;
  else if (edit.stock !== undefined) next.stock = edit.stock;
  if (edit.gbPrice === null) delete next.gbPrice;
  else if (edit.gbPrice !== undefined) next.gbPrice = edit.gbPrice;
  if (edit.image === null) delete next.image;
  else if (edit.image !== undefined) next.image = edit.image;
  return next;
}

/** Read the option names a remove call is targeting. Accepts bare strings and
 *  `{ name }` objects alike, because a model asked to remove options sends
 *  either depending on how the surrounding conversation went. */
function removalNames(input: Input): string[] {
  const raw = Array.isArray(input.remove)
    ? input.remove
    : Array.isArray(input.variations)
      ? input.variations
      : [];
  return raw
    .map((it) => {
      if (typeof it === "string") return it.trim();
      if (it && typeof it === "object" && typeof (it as { name?: unknown }).name === "string") {
        return (it as { name: string }).name.trim();
      }
      return "";
    })
    .filter(Boolean);
}

/**
 * Turn a requested change into the complete option list to persist.
 *
 * All-or-nothing on purpose: any bad row returns `{ error }` and NOTHING is
 * applied. A picker half-rebuilt but reported as success is worse than a
 * refusal, because the agent cannot look at the storefront to notice.
 *
 * - `add` (the default) touches only the options it names. A name that already
 *   exists is patched in place, keeping its position and every field the call
 *   left out; a name that does not is appended and must carry a price.
 * - `replace` installs exactly the list it is given, and is therefore the only
 *   mode that can delete options the caller never mentioned — which is why it
 *   has to be asked for by name.
 * - `remove` drops the named options and refuses names that are not there.
 */
export function buildVariationPlan(
  existing: readonly Variation[],
  input: Input,
): VariationPlan | VariationPlanError {
  const mode = (input.mode ?? "add") as VariationMode;
  if (!MODES.includes(mode)) {
    return { error: `Unknown mode "${String(input.mode)}". Use add, replace, or remove.` };
  }

  const current = (Array.isArray(existing) ? existing : []).map((v) => ({ ...v }));

  if (mode === "remove") {
    const wanted = removalNames(input);
    if (!wanted.length) return { error: "Name at least one variation to remove." };

    const byKey = new Map(current.map((v) => [keyOf(v.name), v] as const));
    const unknown = wanted.filter((n) => !byKey.has(keyOf(n)));
    if (unknown.length) {
      const have = current.map((v) => v.name).join(", ") || "none";
      return {
        error: `No variation named ${unknown.map((n) => `"${n}"`).join(", ")} on this product. It has: ${have}.`,
      };
    }

    const drop = new Set(wanted.map(keyOf));
    return {
      variations: current.filter((v) => !drop.has(keyOf(v.name))),
      added: [],
      updated: [],
      removed: current.filter((v) => drop.has(keyOf(v.name))).map((v) => v.name),
    };
  }

  const rawList = Array.isArray(input.variations) ? input.variations : [];
  if (!rawList.length) {
    return { error: "Provide at least one variation — name, price, and optionally stock, gbPrice, image." };
  }
  if (rawList.length > MAX_VARIATIONS) {
    return { error: `A product can hold at most ${MAX_VARIATIONS} variations; ${rawList.length} were sent.` };
  }

  const edits: Edit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawList.length; i += 1) {
    const parsed = parseEdit(rawList[i], i + 1);
    if (isError(parsed)) return parsed;
    if (seen.has(parsed.key)) {
      return { error: `"${parsed.name}" appears twice in this call. Send each variation once.` };
    }
    seen.add(parsed.key);
    edits.push(parsed);
  }

  if (mode === "replace") {
    const priceless = edits.filter((e) => e.price === undefined).map((e) => e.name);
    if (priceless.length) {
      return { error: `replace needs a price for every variation. Missing: ${priceless.join(", ")}.` };
    }
    const existingByKey = new Map(current.map((v) => [keyOf(v.name), v] as const));
    const variations = edits.map((e) => patch({ name: e.name, price: e.price! }, e));
    return {
      variations,
      added: edits.filter((e) => !existingByKey.has(e.key)).map((e) => e.name),
      // Reported under the name the STORE holds, not the caller's spelling: the
      // operator reads this line back to confirm what moved, so it has to match
      // what they would see in the store admin.
      updated: edits.map((e) => existingByKey.get(e.key)?.name).filter((n): n is string => !!n),
      removed: current.filter((v) => !seen.has(keyOf(v.name))).map((v) => v.name),
    };
  }

  // ── add ──
  const newcomers = edits.filter((e) => !current.some((v) => keyOf(v.name) === e.key));
  const priceless = newcomers.filter((e) => e.price === undefined).map((e) => e.name);
  if (priceless.length) {
    return {
      error: `A new variation needs a price above 0. Missing: ${priceless.join(", ")}.`,
    };
  }
  if (current.length + newcomers.length > MAX_VARIATIONS) {
    return {
      error: `That would take the product to ${current.length + newcomers.length} variations; the limit is ${MAX_VARIATIONS}.`,
    };
  }

  const byKey = new Map(edits.map((e) => [e.key, e] as const));
  const variations = current.map((v) => {
    const edit = byKey.get(keyOf(v.name));
    return edit ? patch(v, edit) : v;
  });
  for (const e of newcomers) variations.push(patch({ name: e.name, price: e.price! }, e));

  return {
    variations,
    added: newcomers.map((e) => e.name),
    // Same rule as replace: echo the store's spelling of an option we patched.
    updated: edits
      .filter((e) => !newcomers.includes(e))
      .map((e) => current.find((v) => keyOf(v.name) === e.key)!.name),
    removed: [],
  };
}
