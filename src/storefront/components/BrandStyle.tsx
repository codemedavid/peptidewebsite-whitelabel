import type { Brand } from "../types";
import { brandStyleCss } from "@/lib/storefront/brand-style";

/**
 * The tenant's --brand-* palette and fonts as one server-rendered <style>, so
 * the first paint is already on-brand instead of storefront.css's pink :root
 * defaults waiting on hydration. Values are filtered by brandStyleCss, so the
 * config can't inject arbitrary CSS. applyBrandStyle's inline vars on <html>
 * still win over this sheet, which keeps live admin edits working.
 */
export function BrandStyle({ brand }: { brand: Brand }) {
  const css = brandStyleCss(brand);
  return css ? <style>{css}</style> : null;
}
