"use client";

// Card Studio picker for the platform admin's Branding editor — a compact
// gallery of every card preset, each tile rendering the REAL storefront
// <ProductCard> (scaled down) painted with the tenant's live brand vars, so
// the operator previews exactly what ships. Picking a design writes
// brand.cardDesign on the editor's config draft; "Save branding" persists it.
// The full workbench (sliders, templates, compare) stays in the store admin's
// Card Studio — this is the apply-a-style surface, same as the theme picker.

import { useMemo } from "react";
import "@/storefront/storefront.css";
import type { Brand, Product } from "@/storefront/types";
import { ProductCard } from "@/storefront/components/Catalog";
import { CARD_PRESETS, getCardPreset, type CardDesign } from "@/storefront/cardDesign";
import { brandVars } from "@/components/admin/StorefrontLivePreview";

// Same neutral abstract sample image the store admin's Card Studio uses
// (data URI — no network, renders identically in every environment).
const SAMPLE_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="#c7d2fe"/><stop offset="0.55" stop-color="#e9d5ff"/>` +
      `<stop offset="1" stop-color="#fbcfe8"/></linearGradient></defs>` +
      `<rect width="600" height="600" fill="url(#g)"/>` +
      `<circle cx="430" cy="170" r="130" fill="#ffffff" opacity="0.35"/>` +
      `<circle cx="160" cy="430" r="170" fill="#ffffff" opacity="0.25"/>` +
      `<rect x="250" y="210" width="100" height="220" rx="50" fill="#ffffff" opacity="0.85"/>` +
      `<rect x="272" y="180" width="56" height="46" rx="12" fill="#312e81" opacity="0.75"/>` +
      `</svg>`,
  );

const SAMPLE_PRODUCT: Product = {
  id: "cdpicker-sample",
  name: "Sample Product 10mg",
  description: "A short example description to judge type, spacing and color.",
  price: 49.99,
  currency: "₱",
  purity: "99.9%",
  category: "all",
  featured: true,
  image: SAMPLE_IMAGE,
  stock: 99,
};

const SAMPLE_RATING = { value: 4.8, count: 126 };

function noop() {}

// Tile thumbnails render the card at its natural catalog width and scale it
// down to the tile, clipping the (design-dependent) overflow below the fold.
const TILE_W = 132;
const TILE_H = 196;

function CardThumb({ design }: { design: CardDesign }) {
  // Horizontal cards are laid out for a wide grid cell — frame them wider so
  // the split layout reads as such instead of collapsing.
  const cardW = design.layout === "horizontal" ? 460 : 300;
  const scale = TILE_W / cardW;
  return (
    <div
      className="cstudio-stage"
      style={{ width: TILE_W, height: TILE_H, overflow: "hidden" }}
      aria-hidden
    >
      <div style={{ width: cardW, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <ProductCard product={SAMPLE_PRODUCT} design={design} rating={SAMPLE_RATING} onAdd={noop} />
      </div>
    </div>
  );
}

/** Human label for the currently applied design (used by the section summary). */
export function cardDesignLabel(design: CardDesign | undefined): string {
  if (!design) return "Classic (theme default)";
  if (design.preset.startsWith("template:")) return "Saved template";
  const p = getCardPreset(design.preset);
  if (!p) return "Custom";
  const customized = JSON.stringify(design) !== JSON.stringify(p.design);
  return customized ? `${p.name} (customized)` : p.name;
}

export function CardDesignPicker({
  brand,
  value,
  onChange,
}: {
  /** The editor's current Brand draft — paints the previews with its palette/fonts. */
  brand: Brand;
  value: CardDesign | undefined;
  onChange: (design: CardDesign | undefined) => void;
}) {
  const vars = useMemo(() => brandVars(brand), [brand]);
  const activeId = value?.preset;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {/* "Classic" tile — no cardDesign set, the card renders the theme default. */}
        <PickTile
          name="Classic"
          tagline="Theme default card"
          active={!value}
          onPick={() => onChange(undefined)}
        >
          <div className="sf-root" style={vars}>
            <CardThumb design={{ ...CARD_PRESETS[0].design }} />
          </div>
        </PickTile>

        {CARD_PRESETS.map((p) => (
          <PickTile
            key={p.id}
            name={p.name}
            tagline={p.tagline}
            active={activeId === p.id}
            onPick={() => onChange({ ...p.design })}
          >
            <div className="sf-root" style={vars}>
              <CardThumb design={p.design} />
            </div>
          </PickTile>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Applies on <span className="font-medium text-foreground">Save branding</span>. For
        fine-tuning (borders, shadows, typography, templates), the tenant&apos;s store admin
        has the full Card Studio.
      </p>
    </div>
  );
}

function PickTile({
  name,
  tagline,
  active,
  onPick,
  children,
}: {
  name: string;
  tagline: string;
  active: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={tagline}
      className={`rounded-[var(--radius)] border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        active ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted"
      }`}
    >
      <div className="overflow-hidden rounded-[6px] border border-border">{children}</div>
      <span className="mt-1.5 block truncate text-xs font-medium">{name}</span>
    </button>
  );
}
