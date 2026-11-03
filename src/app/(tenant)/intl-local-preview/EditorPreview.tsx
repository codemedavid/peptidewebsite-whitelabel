"use client";

// DEV-ONLY: the Website Layout editor on synthetic data (see ./page.tsx), wired
// to a browser-only store (./sample-store): uploads are read locally, Save
// writes to this browser, and the sample website tab picks the change up live.
// Nothing here can reach the database or a real store.

import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "@/storefront/store";
import { AdminSiteBuilder, type SaveLayout } from "@/storefront/admin/site-builder/AdminSiteBuilder";
import { SiteBuilderUploadProvider } from "@/storefront/admin/site-builder/mode";
import type { Brand, Product } from "@/storefront/types";
import { loadSample, readSampleImage, saveSample, type SampleState } from "./sample-store";

const NOTICE =
  "Sample page — uploads stay in this browser and Save updates the sample website tab (/intl-local-preview). Nothing is sent to a real store. To edit a real store, use its #admin → Website Layout.";

function Editor({ sample, onSaved }: { sample: SampleState; onSaved: (s: SampleState) => void }) {
  // The store's brand (not the prop) so Save's setTweak shows up here at once.
  const { brand } = useStore();
  const saveLayout: SaveLayout = async ({ config, activate }) => {
    const next = { config, active: activate ?? sample.active };
    const error = saveSample(next);
    if (error) return { error };
    onSaved(next);
    return { ok: true, homeLayout: next.active ? "intl-local" : "classic" };
  };
  return (
    <SiteBuilderUploadProvider upload={readSampleImage}>
      <AdminSiteBuilder brand={brand} onBack={() => window.history.back()} saveLayout={saveLayout} notice={NOTICE} />
    </SiteBuilderUploadProvider>
  );
}

export function EditorPreview({ brand, products }: { brand: Brand; products: Product[] }) {
  // localStorage only exists in the browser — read it after mount so the
  // server render and the first client render agree.
  const [sample, setSample] = useState<SampleState | null>(null);
  useEffect(() => setSample(loadSample(brand.intlLocal!)), [brand.intlLocal]);
  if (!sample) return <div className="sf-root" />;

  const sampleBrand: Brand = { ...brand, intlLocal: sample.config, homeLayout: sample.active ? "intl-local" : "classic" };
  return (
    <div className="sf-root">
      <StoreProvider brand={sampleBrand} products={products} tenantKey="intl-local-preview">
        <Editor sample={sample} onSaved={setSample} />
      </StoreProvider>
    </div>
  );
}
