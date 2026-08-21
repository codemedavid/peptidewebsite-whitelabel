// DEV-ONLY sample of the editorial layout. Safe to delete.
//
// Deliberately reads NOTHING from the database: the dev server points at the
// production Supabase instance, so flipping a real tenant's homeLayout to look
// at the layout would change a live storefront. Everything below is synthetic.

import { StorefrontApp } from "@/storefront/StorefrontApp";
import { BRAND, SEED_PRODUCTS } from "@/storefront/data";
import type { Brand, Product } from "@/storefront/types";
import "@/storefront/storefront.css";
import "@/storefront/boutique.css";
import "@/storefront/editorial.css";

const CATEGORIES = [
  { id: "all", label: "All Products" },
  { id: "recovery", label: "Recovery & Repair" },
  { id: "weight", label: "Weight Management" },
  { id: "skin", label: "Skin & Aesthetics" },
  { id: "cognitive", label: "Cognitive" },
  // Deliberately stocked with nothing — it must not appear in the index.
  { id: "empty", label: "Nothing In Here" },
];

const CATS = ["recovery", "weight", "skin", "cognitive"];

const products: Product[] = Array.from({ length: 11 }, (_, i) => ({
  ...(SEED_PRODUCTS[i % SEED_PRODUCTS.length] as Product),
  id: `prev-${i}`,
  name: `Sample Product ${i + 1}`,
  category: CATS[i % CATS.length],
  featured: i < 3,
  available: true,
  // The seeds ship stock 0, which would badge every card "Out of stock" and
  // make the sample look broken rather than empty.
  stock: 12,
  price: 1850 + i * 640,
  currency: "₱",
}));

const brand: Brand = {
  ...BRAND,
  name: "Preview Store",
  homeLayout: "editorial",
  categories: CATEGORIES,
  boutique: {
    assurances: [
      {
        id: "a1",
        label: "Professional use",
        note: "Supplied to licensed practitioners for in-clinic use only.",
      },
      {
        id: "a2",
        label: "Batch documented",
        note: "Every carton ships with its certificate of analysis.",
      },
      {
        id: "a3",
        label: "Cold chain",
        note: "Temperature-sensitive items dispatched with gel packs.",
      },
    ],
  },
};

export default function EditorialPreviewPage() {
  return <StorefrontApp brand={brand} products={products} tenantKey="editorial-preview" />;
}
