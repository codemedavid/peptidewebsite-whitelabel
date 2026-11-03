// DEV-ONLY sample of the Intl & Local layout (and, with ?admin=1, its
// Website Layout editor). Safe to delete. 404s in production. The editor saves
// into this browser only (./sample-store) and this page re-renders from it.
//
// Deliberately reads NOTHING from the database: the dev server points at the
// production Supabase instance, so flipping a real tenant's homeLayout to look
// at the layout would change a live storefront. Everything below is synthetic.

import { notFound } from "next/navigation";
import { BRAND, SEED_PRODUCTS } from "@/storefront/data";
import type { Brand, Product } from "@/storefront/types";
import { normalizeIntlLocalConfig } from "@/lib/storefront/intl-local/normalize";
import { EditorPreview } from "./EditorPreview";
import { SampleStorefront } from "./SampleStorefront";
import { StudioHarness } from "./StudioHarness";
import { PreviewFrame } from "@/components/admin/preview/PreviewFrame";
import "@/storefront/storefront.css";
import "@/storefront/section-background.css";
import "@/storefront/intl-local.css";

const CATEGORIES = [
  { id: "all", label: "All Products" },
  { id: "local", label: "Philippines" },
  { id: "wholesale", label: "Wholesale" },
];

// Two markets: even products sell in both (with a USD price), odd ones are
// local only — so each shop page lists a different shelf.
const products: Product[] = Array.from({ length: 8 }, (_, i) => ({
  ...(SEED_PRODUCTS[i % SEED_PRODUCTS.length] as Product),
  id: `il-prev-${i}`,
  name: `Sample Product ${i + 1}`,
  category: i % 2 ? "local" : "wholesale",
  featured: i < 2,
  available: true,
  stock: 12,
  price: 1850 + i * 640,
  currency: "₱",
  variations: [],
  productType: "onhand",
  ...(i % 2 === 0 ? { market: "both" as const, usdPrice: 35 + i * 12 } : {}),
}));

const brand: Brand = {
  ...BRAND,
  name: "Brand Name",
  homeLayout: "intl-local",
  categories: CATEGORIES,
  dualMarket: true,
  // Never place a real order from here — see Brand.checkoutPreviewOnly.
  checkoutPreviewOnly: true,
  intlMarket: { enabled: true, shippingLocations: [{ id: "us", courierId: "", code: "US", name: "United States", price: 25 }] },
  contactChannels: [{ type: "messenger", destination: "previewstore", enabled: true }],
  intlLocal: normalizeIntlLocalConfig({
    infoPages: [
      { id: "about", title: "About us", body: "A sample About page.\n\nWritten in the Website Layout editor." },
      { id: "privacy", title: "Privacy policy", body: "" },
      { id: "terms", title: "Terms of service", body: "" },
      { id: "shipping", title: "Shipping", body: "We ship nationwide in 2–5 days." },
      { id: "returns", title: "Returns", body: "" },
    ],
  }),
};

export default async function IntlLocalPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ admin?: string; frame?: string; studio?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { admin, frame, studio } = await searchParams;
  // ?frame=1 / ?studio=1: the Super Admin live preview's frame + editor side,
  // on sample data, so the protocol can be exercised without an operator login.
  if (frame) return <PreviewFrame base={brand} products={products} tenantKey="intl-local-preview" />;
  if (studio) return <StudioHarness brand={brand} />;
  if (admin) return <EditorPreview brand={brand} products={products} />;
  return <SampleStorefront brand={brand} products={products} />;
}
