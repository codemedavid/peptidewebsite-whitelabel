/**
 * Owner-editable copy for the reseller portal's password screen, stored in
 * `branding.config`. Pure — no database, no "server-only" — so the save action,
 * the storefront render and the tests share one normalizer.
 *
 * The Brand already carried `merchantGateTitle` / `merchantGateSub`, but only the
 * platform operator could set them (they live in the super-admin branding
 * editor). The store owner had no way to word their own gate, so every tenant
 * showed the same generic default. These read the SAME two config keys rather
 * than introducing a second pair — the operator's branding editor and the
 * owner's Reseller Portal screen now write to one field each, and whoever saved
 * last wins, which is how the rest of the shared Brand copy already behaves.
 */

export const DEFAULT_RESELLER_GATE_TITLE = "Reseller Access";
export const DEFAULT_RESELLER_GATE_SUB =
  "Enter the reseller password to access wholesale pricing.";

export type ResellerPageCopy = {
  gateTitle: string;
  gateSub: string;
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** The effective copy for a config blob, with defaults filled in. */
export function readResellerPageCopy(config: unknown): ResellerPageCopy {
  const c = (config ?? {}) as Record<string, unknown>;
  return {
    gateTitle: str(c.merchantGateTitle, 120) || DEFAULT_RESELLER_GATE_TITLE,
    gateSub: str(c.merchantGateSub, 400) || DEFAULT_RESELLER_GATE_SUB,
  };
}

/**
 * The config patch for a save. A field the caller did not send is left at its
 * CURRENT stored value rather than blanked — the admin screen posts the whole
 * form, but any other caller (a script, a future partial save) must not wipe copy
 * it never intended to touch. Sending an empty string DOES clear a field, which
 * falls back to the default on read.
 */
export function readResellerPageCopyPatch(
  input: Record<string, unknown>,
  current: unknown,
): Record<string, string> {
  const c = (current ?? {}) as Record<string, unknown>;
  const patch: Record<string, string> = {};
  for (const [key, max] of [
    ["merchantGateTitle", 120],
    ["merchantGateSub", 400],
  ] as const) {
    if (key in input) patch[key] = str(input[key], max);
    else if (typeof c[key] === "string") patch[key] = c[key] as string;
  }
  return patch;
}
