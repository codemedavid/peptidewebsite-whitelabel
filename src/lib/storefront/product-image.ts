/**
 * Per-tenant default product image.
 *
 * A brand can carry a fallback photo (branding.config.defaultProductImage) that
 * the storefront shows for any product without an image of its own — products
 * with real photos keep them. Pure module (no DB, no Next runtime) shared by the
 * server page (normalize at the trust boundary) and the client render surfaces
 * (resolve per product). Covered by scripts/test-default-product-image.ts.
 */

/**
 * Coerce the untrusted branding.config value into a safe hosted URL. Only
 * http(s) is accepted — same rule as saved product images (actions/products.ts
 * rejects un-hosted data URLs), and it keeps javascript:/data: out of <img src>.
 */
export function normalizeDefaultProductImage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * The image a product card should render: the product's own image wins, then
 * the brand default, then null (callers keep their SVG/monogram placeholder).
 */
export function resolveProductImage(
  image: string | null | undefined,
  defaultProductImage: string | null | undefined,
): string | null {
  return image || defaultProductImage || null;
}
