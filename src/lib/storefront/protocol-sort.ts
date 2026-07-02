// Pure core for the Protocols page alphabetical sort. Used by the storefront
// client, so it must stay free of any DB / Next / browser dependency — it is
// exercised directly by test:protocol-sort.
//
// "default" preserves the admin-defined order from the protocols collection;
// "az" / "za" order by protocol name, case-insensitively and numeric-aware
// (BPC-2 before BPC-10). Sorting always returns a new array — the input list
// (shared store state) is never mutated.

export type ProtocolSort = "default" | "az" | "za";

export const PROTOCOL_SORT_OPTIONS: ReadonlyArray<{
  value: ProtocolSort;
  label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "az", label: "Name A–Z" },
  { value: "za", label: "Name Z–A" },
];

const KNOWN_SORTS: ReadonlySet<string> = new Set(
  PROTOCOL_SORT_OPTIONS.map((o) => o.value),
);

/** Coerce an untrusted sort value into a known ProtocolSort. */
export function normalizeProtocolSort(raw: unknown): ProtocolSort {
  return typeof raw === "string" && KNOWN_SORTS.has(raw)
    ? (raw as ProtocolSort)
    : "default";
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/**
 * Return a new copy of the protocol list in the requested order. "default"
 * keeps the input order; "az"/"za" sort by name. Missing names sort as ""
 * (first in A–Z), and equal names keep their relative input order.
 */
export function sortProtocolsByName<T extends { name: string }>(
  list: readonly T[],
  sort: ProtocolSort,
): T[] {
  const copy = [...list];
  if (sort === "default") return copy;
  const dir = sort === "az" ? 1 : -1;
  return copy.sort(
    (a, b) => dir * compareNames(String(a.name ?? ""), String(b.name ?? "")),
  );
}
