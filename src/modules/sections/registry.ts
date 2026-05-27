import type { ComponentType } from "react";
import { Hero } from "./Hero";
import { ProductGrid } from "./ProductGrid";
import { FAQ } from "./FAQ";
import { ComplianceBanner } from "./ComplianceBanner";

/**
 * Section type → component. Adding a new section = one component + one entry here.
 * No per-tenant code: pages are data (Page.sections JSON), not branches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sectionRegistry: Record<string, ComponentType<any>> = {
  hero: Hero,
  productGrid: ProductGrid,
  faq: FAQ,
  complianceBanner: ComplianceBanner,
};

export type SectionType = keyof typeof sectionRegistry;
