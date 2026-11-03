"use client";

// DEV-ONLY: the sample website (see ./page.tsx). Renders the layout from the
// browser-only sample store and re-renders whenever the editor tab saves.

import { useEffect, useState } from "react";
import { StorefrontApp } from "@/storefront/StorefrontApp";
import type { Brand, Product } from "@/storefront/types";
import { loadSample, onSampleChange, type SampleState } from "./sample-store";

export function SampleStorefront({ brand, products }: { brand: Brand; products: Product[] }) {
  const [sample, setSample] = useState<SampleState | null>(null);
  // A new key per save remounts the app, so its store picks up the new brand.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const reload = () => {
      setSample(loadSample(brand.intlLocal!));
      setVersion((v) => v + 1);
    };
    reload();
    return onSampleChange(reload);
  }, [brand.intlLocal]);

  if (!sample) return null;
  const live: Brand = { ...brand, intlLocal: sample.config, homeLayout: sample.active ? "intl-local" : "classic" };
  return <StorefrontApp key={version} brand={live} products={products} tenantKey="intl-local-preview" />;
}
