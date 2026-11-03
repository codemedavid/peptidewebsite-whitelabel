"use client";

// DEV-ONLY: the Super Admin's live preview (LivePreviewStudio) wired to this
// sample page's own frame (?frame=1), so the parent ⇄ frame protocol can be
// exercised end to end without an operator session. See ./page.tsx.

import { useState } from "react";
import type { Brand } from "@/storefront/types";
import { LivePreviewStudio } from "@/components/admin/preview/LivePreviewStudio";

export function StudioHarness({ brand }: { brand: Brand }) {
  const [title, setTitle] = useState("Discover. Understand. Choose.");
  const [picked, setPicked] = useState("");
  const draft = { homeLayout: "intl-local" as const, intlLocal: { ...brand.intlLocal!, hero: { ...brand.intlLocal!.hero, title } } };
  return (
    <div className="sa" style={{ padding: 24, display: "grid", gap: 12 }}>
      <label>
        Hero title <input id="harness-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p id="harness-picked">{picked}</p>
      <LivePreviewStudio
        slug="harness"
        frameSrc="/intl-local-preview?frame=1"
        draft={draft}
        extras={{ name: brand.name }}
        previewBrand={brand}
        storefrontUrl="/intl-local-preview"
        onSelectRegion={setPicked}
      />
    </div>
  );
}
