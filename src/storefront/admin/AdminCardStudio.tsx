"use client";

// Card Studio — the product card design gallery + customization workbench.
//
// Every preview here renders the REAL <ProductCard> (Catalog.tsx) with a
// sample product, so the gallery, modal, compare view and device frames show
// exactly what ships on the storefront. Clicking a design applies it
// instantly (store → debounced branding.config save) and opens the
// customization panel; every control feeds the same live design object, so
// all previews update in real time.

import { useMemo, useState } from "react";
import type { Brand, Product } from "../types";
import { useStore } from "../store";
import { ProductCard } from "../components/Catalog";
import {
  BORDER_COLOR_PRESETS,
  CARD_PRESETS,
  getCardPreset,
  type CardDesign,
  type CardPreset,
  type CardTemplate,
} from "../cardDesign";

const SAMPLE_RATING = { value: 4.8, count: 126 };

// A neutral abstract sample image (data URI — no network, works in demo mode)
// so every preview card has realistic media even before products exist.
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

type Device = "desktop" | "tablet" | "mobile";

// Frame widths approximate what the catalog grid actually hands a card at each
// breakpoint (desktop column, tablet column, 2-up phone column). Horizontal
// cards get wider frames; on the phone width they collapse to vertical via the
// same container query that governs the real storefront.
function frameWidth(device: Device, layout: CardDesign["layout"]): number {
  if (layout === "horizontal") {
    return device === "desktop" ? 560 : device === "tablet" ? 390 : 178;
  }
  return device === "desktop" ? 320 : device === "tablet" ? 252 : 178;
}

function noop() {}

/** A non-interactive, always-faithful card preview at a given frame width. */
function Stage({
  design,
  sample,
  width,
}: {
  design: CardDesign;
  sample: Product;
  width?: number;
}) {
  return (
    <div
      className="cstudio-stage"
      style={width ? { width, maxWidth: "100%" } : undefined}
      aria-hidden
    >
      <ProductCard product={sample} design={design} rating={SAMPLE_RATING} onAdd={noop} />
    </div>
  );
}

function DeviceTabs({ device, onChange }: { device: Device; onChange: (d: Device) => void }) {
  const tabs: { id: Device; label: string; icon: React.ReactNode }[] = [
    {
      id: "desktop",
      label: "Desktop",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
    {
      id: "tablet",
      label: "Tablet",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      ),
    },
    {
      id: "mobile",
      label: "Mobile",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2" width="10" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      ),
    },
  ];
  return (
    <div className="cstudio-devices" role="tablist" aria-label="Preview device">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={device === t.id}
          className={`cstudio-devices__tab ${device === t.id ? "is-active" : ""}`}
          onClick={() => onChange(t.id)}
          title={t.label}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Panel controls ────────────────────────────────────────────────────────────

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cstudio-group">
      <h3 className="cstudio-group__title">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cstudio-row">
      <span className="cstudio-row__label">{label}</span>
      <div className="cstudio-row__control">{children}</div>
    </div>
  );
}

function Seg<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="cstudio-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`cstudio-seg__btn ${value === o.value ? "is-active" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`cstudio-toggle ${value ? "is-on" : ""}`}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="cstudio-toggle__track"><span className="cstudio-toggle__thumb" /></span>
      <span className="cstudio-toggle__label">{label}</span>
    </button>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
  unit = "px",
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div className="cstudio-row">
      <span className="cstudio-row__label">
        {label}
        <em className="cstudio-row__value">{value}{unit}</em>
      </span>
      <input
        type="range"
        className="cstudio-range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Color control: recommended swatches + native picker + "Theme" inherit chip. */
function ColorRow({
  label,
  value,
  onChange,
  presets = [],
  themeLabel = "Theme",
  fallbackHex = "#FFFFFF",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets?: { name: string; value: string }[];
  /** Label of the inherit chip; pass null to disallow inheriting. */
  themeLabel?: string | null;
  /** What the native picker shows while inheriting. */
  fallbackHex?: string;
}) {
  return (
    <div className="cstudio-row cstudio-row--color">
      <span className="cstudio-row__label">{label}</span>
      <div className="cstudio-swatches">
        {themeLabel !== null && (
          <button
            type="button"
            className={`cstudio-swatch cstudio-swatch--theme ${value === "" ? "is-active" : ""}`}
            onClick={() => onChange("")}
            title="Use your theme color"
          >
            {themeLabel}
          </button>
        )}
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`cstudio-swatch ${value.toUpperCase() === p.value.toUpperCase() ? "is-active" : ""}`}
            style={{ background: p.value }}
            onClick={() => onChange(p.value)}
            title={`${p.name} (${p.value})`}
            aria-label={`${label}: ${p.name}`}
          />
        ))}
        <label className="cstudio-swatch cstudio-swatch--custom" title="Custom color">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallbackHex}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label}: custom color`}
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        </label>
      </div>
    </div>
  );
}

// ── The studio ────────────────────────────────────────────────────────────────

export function AdminCardStudio({
  onBack,
}: {
  brand: Brand;
  onBack: () => void;
}) {
  // Read the LIVE brand from the store rather than the prop — edits below
  // must re-render every preview instantly.
  const { brand, setCardDesign, setCardTemplates, products, toast, toastMsg } = useStore();
  const design = brand.cardDesign;
  const templates = useMemo(() => brand.cardTemplates ?? [], [brand.cardTemplates]);

  const [device, setDevice] = useState<Device>("desktop");
  const [modal, setModal] = useState<{ name: string; design: CardDesign } | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Preview with the store's real catalog when possible — the first product
  // with an image — so the owner judges designs against their own content.
  const sample: Product = useMemo(() => {
    const real = products.find((p) => p.image && p.available !== false) ?? products[0];
    return {
      id: "cstudio-sample",
      name: real?.name ?? "Sample Product 10mg",
      description:
        real?.description ??
        "A short example description so you can judge type, spacing and color in context.",
      price: real?.price ?? 1850,
      currency: real?.currency ?? "₱",
      purity: real?.purity ?? "99.9%",
      category: real?.category ?? "all",
      featured: true,
      image: real?.image ?? SAMPLE_IMAGE,
    };
  }, [products]);

  const apply = (d: CardDesign, name: string) => {
    setCardDesign({ ...d });
    toast(`Applied "${name}" — saving…`);
  };

  const patch = (edits: Partial<CardDesign>) => {
    if (!design) return;
    setCardDesign({ ...design, ...edits });
  };

  const resetToClassic = () => {
    if (!confirm("Remove the applied design and return to the classic card?")) return;
    setCardDesign(undefined);
    setCompareIds([]);
  };

  // Whether the live design has drifted from the preset it started as.
  const activePreset = design ? getCardPreset(design.preset) : undefined;
  const customized =
    !!design && !!activePreset && JSON.stringify(design) !== JSON.stringify(activePreset.design);

  const saveTemplate = () => {
    if (!design) return;
    const name = templateName.trim();
    if (!name) return;
    setCardTemplates((prev) => [
      ...prev,
      { id: `ct${Date.now()}`, name: name.slice(0, 80), design: { ...design } },
    ]);
    setSavingTemplate(false);
    setTemplateName("");
    toast(`Template "${name}" saved`);
  };

  const deleteTemplate = (t: CardTemplate) => {
    if (!confirm(`Delete the template "${t.name}"?`)) return;
    setCardTemplates((prev) => prev.filter((x) => x.id !== t.id));
  };

  // Compare entries can be presets ("p:<id>") or templates ("t:<id>").
  const compareEntries = compareIds
    .map((key): { key: string; name: string; design: CardDesign } | null => {
      if (key.startsWith("p:")) {
        const p = getCardPreset(key.slice(2));
        return p ? { key, name: p.name, design: p.design } : null;
      }
      const t = templates.find((x) => x.id === key.slice(2));
      return t ? { key, name: t.name, design: t.design } : null;
    })
    .filter((x): x is { key: string; name: string; design: CardDesign } => x !== null);

  const toggleCompare = (key: string) => {
    setCompareIds((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 4) {
        toast("Compare up to 4 designs at a time");
        return prev;
      }
      return [...prev, key];
    });
  };

  const renderTile = (
    key: string,
    name: string,
    tagline: string,
    d: CardDesign,
    extra?: React.ReactNode,
  ) => {
    const isActive = !!design && design.preset === d.preset && key.startsWith("p:");
    // The applied preset's tile previews the LIVE (possibly customized) design
    // so the gallery tracks the panel in real time.
    const shown = isActive && design ? design : d;
    const inCompare = compareIds.includes(key);
    return (
      <div
        key={key}
        className={`cstudio-tile ${isActive ? "is-active" : ""} ${
          d.layout === "horizontal" ? "cstudio-tile--wide" : ""
        }`}
      >
        <div className="cstudio-tile__stagewrap">
          <Stage design={shown} sample={sample} />
          <button
            type="button"
            className="cstudio-tile__hit"
            onClick={() => apply(shown, name)}
            aria-label={`Apply the ${name} design`}
          />
          <div className="cstudio-tile__actions">
            <button
              type="button"
              className="cstudio-tile__action"
              onClick={() => setModal({ name, design: shown })}
              title="Full-size preview"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="11" y1="8" x2="11" y2="14" />
              </svg>
              Preview
            </button>
            <button
              type="button"
              className={`cstudio-tile__action ${inCompare ? "is-on" : ""}`}
              onClick={() => toggleCompare(key)}
              title="Add to side-by-side compare"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" />
              </svg>
              {inCompare ? "Added" : "Compare"}
            </button>
          </div>
        </div>
        <div className="cstudio-tile__meta">
          <div>
            <div className="cstudio-tile__name">
              {name}
              {isActive && customized && <span className="cstudio-chip">Customized</span>}
            </div>
            <div className="cstudio-tile__tag">{tagline}</div>
          </div>
          {isActive ? (
            <span className="cstudio-tile__check" aria-label="Currently applied">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          ) : (
            extra
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="admin cstudio">
      <main className="admin__inner">
        <div className="admin-table__head">
          <h1 className="admin-table__title">
            <a
              className="admin-table__title-back"
              href="#"
              onClick={(e) => { e.preventDefault(); onBack(); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Dashboard
            </a>
            <span>Card Studio</span>
          </h1>
          <div className="cstudio-head-actions">
            {design && (
              <>
                <button className="cstudio-btn cstudio-btn--ghost" onClick={() => setSavingTemplate(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save as Template
                </button>
                <button className="cstudio-btn cstudio-btn--ghost" onClick={resetToClassic}>
                  Reset to Classic
                </button>
              </>
            )}
          </div>
        </div>

        {savingTemplate && design && (
          <div className="cstudio-template-bar">
            <input
              className="admin-input"
              autoFocus
              placeholder="Template name — e.g. Holiday promo cards"
              value={templateName}
              maxLength={80}
              onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTemplate();
                if (e.key === "Escape") setSavingTemplate(false);
              }}
            />
            <button className="cstudio-btn" onClick={saveTemplate} disabled={!templateName.trim()}>
              Save Template
            </button>
            <button className="cstudio-btn cstudio-btn--ghost" onClick={() => setSavingTemplate(false)}>
              Cancel
            </button>
          </div>
        )}

        {design ? (
          <div className="cstudio-workbench">
            <aside className="cstudio-panel" aria-label="Card customization">
              <div className="cstudio-panel__head">
                <span>Customize</span>
                <span className="cstudio-panel__preset">
                  {activePreset?.name ?? "Custom"}
                  {customized && <span className="cstudio-chip">Customized</span>}
                </span>
              </div>

              <Group title="Border">
                <Toggle label="Show border" value={design.borderEnabled} onChange={(v) => patch({ borderEnabled: v })} />
                {design.borderEnabled && (
                  <>
                    <ColorRow
                      label="Border color"
                      value={design.borderColor}
                      onChange={(v) => patch({ borderColor: v })}
                      presets={BORDER_COLOR_PRESETS}
                      fallbackHex="#E5E7EB"
                    />
                    <Slider label="Border width" min={1} max={6} value={design.borderWidth} onChange={(v) => patch({ borderWidth: v })} />
                    <Row label="Border style">
                      <Seg
                        ariaLabel="Border style"
                        options={[
                          { value: "solid", label: "Solid" },
                          { value: "dashed", label: "Dashed" },
                          { value: "dotted", label: "Dotted" },
                        ]}
                        value={design.borderStyle}
                        onChange={(v) => patch({ borderStyle: v })}
                      />
                    </Row>
                  </>
                )}
                <Slider label="Corner radius" min={0} max={32} value={design.radius} onChange={(v) => patch({ radius: v })} />
              </Group>

              <Group title="Card">
                <Row label="Surface">
                  <Seg
                    ariaLabel="Surface"
                    options={[
                      { value: "flat", label: "Flat" },
                      { value: "glass", label: "Glass" },
                      { value: "neumorphic", label: "Neu" },
                      { value: "gradient", label: "Gradient" },
                    ]}
                    value={design.surface}
                    onChange={(v) => patch({ surface: v })}
                  />
                </Row>
                <ColorRow label="Background" value={design.background} onChange={(v) => patch({ background: v })} />
                {design.surface === "gradient" && (
                  <ColorRow label="Gradient stop" value={design.background2} onChange={(v) => patch({ background2: v })} themeLabel="Auto" />
                )}
                <ColorRow label="Text color" value={design.textColor} onChange={(v) => patch({ textColor: v })} fallbackHex="#1F2937" />
                <Row label="Shadow">
                  <Seg
                    ariaLabel="Shadow intensity"
                    options={[
                      { value: "none", label: "None" },
                      { value: "sm", label: "Soft" },
                      { value: "md", label: "Medium" },
                      { value: "lg", label: "Deep" },
                      { value: "glow", label: "Glow" },
                    ]}
                    value={design.shadow}
                    onChange={(v) => patch({ shadow: v })}
                  />
                </Row>
                <Row label="Hover effect">
                  <Seg
                    ariaLabel="Hover effect"
                    options={[
                      { value: "none", label: "None" },
                      { value: "lift", label: "Lift" },
                      { value: "grow", label: "Grow" },
                      { value: "glow", label: "Glow" },
                      { value: "frame", label: "Frame" },
                      { value: "tilt", label: "Tilt" },
                    ]}
                    value={design.hover}
                    onChange={(v) => patch({ hover: v })}
                  />
                </Row>
                <Row label="Card spacing">
                  <Seg
                    ariaLabel="Card spacing"
                    options={[
                      { value: "compact", label: "Compact" },
                      { value: "cozy", label: "Cozy" },
                      { value: "roomy", label: "Roomy" },
                    ]}
                    value={design.spacing}
                    onChange={(v) => patch({ spacing: v })}
                  />
                </Row>
              </Group>

              <Group title="Layout & image">
                <Row label="Layout">
                  <Seg
                    ariaLabel="Card layout"
                    options={[
                      { value: "vertical", label: "Standard" },
                      { value: "horizontal", label: "Side image" },
                      { value: "overlay", label: "BG image" },
                    ]}
                    value={design.layout}
                    onChange={(v) => patch({ layout: v })}
                  />
                </Row>
                <Row label="Image ratio">
                  <Seg
                    ariaLabel="Image ratio"
                    options={[
                      { value: "square", label: "1:1" },
                      { value: "landscape", label: "4:3" },
                      { value: "portrait", label: "3:4" },
                      { value: "wide", label: "16:9" },
                    ]}
                    value={design.imageRatio}
                    onChange={(v) => patch({ imageRatio: v })}
                  />
                </Row>
                <Toggle label="Inset image (bento)" value={design.mediaInset} onChange={(v) => patch({ mediaInset: v })} />
              </Group>

              <Group title="Typography">
                <Row label="Title font">
                  <Seg
                    ariaLabel="Title font"
                    options={[
                      { value: "display", label: "Display" },
                      { value: "body", label: "Body" },
                    ]}
                    value={design.titleFont}
                    onChange={(v) => patch({ titleFont: v })}
                  />
                </Row>
                <Row label="Title weight">
                  <Seg
                    ariaLabel="Title weight"
                    options={[
                      { value: "400", label: "400" },
                      { value: "500", label: "500" },
                      { value: "600", label: "600" },
                      { value: "700", label: "700" },
                      { value: "800", label: "800" },
                    ]}
                    value={String(design.titleWeight) as "400" | "500" | "600" | "700" | "800"}
                    onChange={(v) => patch({ titleWeight: Number(v) as CardDesign["titleWeight"] })}
                  />
                </Row>
                <Row label="Title size">
                  <Seg
                    ariaLabel="Title size"
                    options={[
                      { value: "sm", label: "S" },
                      { value: "md", label: "M" },
                      { value: "lg", label: "L" },
                    ]}
                    value={design.titleSize}
                    onChange={(v) => patch({ titleSize: v })}
                  />
                </Row>
                <Toggle label="Uppercase title" value={design.titleCase === "uppercase"} onChange={(v) => patch({ titleCase: v ? "uppercase" : "none" })} />
                <Toggle label="Show description" value={design.showDesc} onChange={(v) => patch({ showDesc: v })} />
              </Group>

              <Group title="Button">
                <Row label="Button style">
                  <Seg
                    ariaLabel="Button style"
                    options={[
                      { value: "gradient", label: "Gradient" },
                      { value: "solid", label: "Solid" },
                      { value: "outline", label: "Outline" },
                      { value: "soft", label: "Soft" },
                      { value: "contrast", label: "Contrast" },
                    ]}
                    value={design.buttonStyle}
                    onChange={(v) => patch({ buttonStyle: v })}
                  />
                </Row>
                <ColorRow
                  label="Button color"
                  value={design.buttonColor}
                  onChange={(v) => patch({ buttonColor: v })}
                  presets={BORDER_COLOR_PRESETS.filter((p) => !p.name.includes("Gray") && p.name !== "Slate")}
                  fallbackHex="#6366F1"
                />
                <Row label="Button shape">
                  <Seg
                    ariaLabel="Button shape"
                    options={[
                      { value: "pill", label: "Pill" },
                      { value: "rounded", label: "Rounded" },
                      { value: "square", label: "Square" },
                    ]}
                    value={design.buttonShape}
                    onChange={(v) => patch({ buttonShape: v })}
                  />
                </Row>
              </Group>

              <Group title="Badge">
                <Row label="Badge style">
                  <Seg
                    ariaLabel="Badge style"
                    options={[
                      { value: "solid", label: "Solid" },
                      { value: "soft", label: "Soft" },
                      { value: "outline", label: "Outline" },
                      { value: "mono", label: "Mono" },
                      { value: "hidden", label: "Hidden" },
                    ]}
                    value={design.badgeStyle}
                    onChange={(v) => patch({ badgeStyle: v })}
                  />
                </Row>
              </Group>
            </aside>

            <section className="cstudio-preview" aria-label="Live preview">
              <div className="cstudio-preview__bar">
                <DeviceTabs device={device} onChange={setDevice} />
                <button
                  className="cstudio-btn cstudio-btn--ghost"
                  onClick={() => design && setModal({ name: activePreset?.name ?? "Current design", design })}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                  Full preview
                </button>
              </div>
              <div className={`cstudio-preview__frame cstudio-preview__frame--${device}`}>
                <Stage design={design} sample={sample} width={frameWidth(device, design.layout)} />
              </div>
              <p className="cstudio-preview__hint">
                Changes apply to your live catalog instantly and save automatically.
              </p>
            </section>
          </div>
        ) : (
          <div className="cstudio-intro">
            <h2>Pick a card design below</h2>
            <p>
              Click any design to apply it to your product cards instantly and unlock the
              customization panel — borders, colors, shadows, typography, buttons and more.
              Your current cards use the classic theme style.
            </p>
          </div>
        )}

        {templates.length > 0 && (
          <>
            <h2 className="cstudio-section-title">Your Templates</h2>
            <div className="cstudio-gallery">
              {templates.map((t) =>
                renderTile(
                  `t:${t.id}`,
                  t.name,
                  "Saved template",
                  t.design,
                  <button
                    type="button"
                    className="cstudio-tile__delete"
                    onClick={() => deleteTemplate(t)}
                    title={`Delete "${t.name}"`}
                    aria-label={`Delete the template ${t.name}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>,
                ),
              )}
            </div>
          </>
        )}

        <h2 className="cstudio-section-title">
          Design Gallery
          <span className="cstudio-section-sub">
            {CARD_PRESETS.length} professional styles — hover to preview, click to apply
          </span>
        </h2>
        <div className="cstudio-gallery">
          {CARD_PRESETS.map((p: CardPreset) => renderTile(`p:${p.id}`, p.name, p.tagline, p.design))}
        </div>
      </main>

      {/* Full-size preview modal */}
      {modal && (
        <div className="cstudio-modal" role="dialog" aria-modal="true" aria-label={`${modal.name} preview`} onClick={() => setModal(null)}>
          <div className="cstudio-modal__box" onClick={(e) => e.stopPropagation()}>
            <div className="cstudio-modal__head">
              <h3>{modal.name}</h3>
              <DeviceTabs device={device} onChange={setDevice} />
              <button className="cstudio-modal__close" onClick={() => setModal(null)} aria-label="Close preview">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="cstudio-modal__stage">
              <Stage design={modal.design} sample={sample} width={frameWidth(device, modal.design.layout)} />
            </div>
            <div className="cstudio-modal__foot">
              <button
                className="cstudio-btn"
                onClick={() => {
                  apply(modal.design, modal.name);
                  setModal(null);
                }}
              >
                Apply this design
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compare tray + side-by-side modal */}
      {compareEntries.length > 0 && !compareOpen && (
        <div className="cstudio-compare-tray">
          <span>
            {compareEntries.length} design{compareEntries.length > 1 ? "s" : ""} selected
          </span>
          <button className="cstudio-btn" onClick={() => setCompareOpen(true)} disabled={compareEntries.length < 2}>
            Compare side by side
          </button>
          <button className="cstudio-btn cstudio-btn--ghost" onClick={() => setCompareIds([])}>
            Clear
          </button>
        </div>
      )}
      {compareOpen && (
        <div className="cstudio-modal" role="dialog" aria-modal="true" aria-label="Compare designs" onClick={() => setCompareOpen(false)}>
          <div className="cstudio-modal__box cstudio-modal__box--wide" onClick={(e) => e.stopPropagation()}>
            <div className="cstudio-modal__head">
              <h3>Compare designs</h3>
              <DeviceTabs device={device} onChange={setDevice} />
              <button className="cstudio-modal__close" onClick={() => setCompareOpen(false)} aria-label="Close compare">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="cstudio-compare-grid">
              {compareEntries.map((c) => (
                <div key={c.key} className="cstudio-compare-cell">
                  <div className="cstudio-compare-cell__name">{c.name}</div>
                  <Stage design={c.design} sample={sample} width={frameWidth(device, c.design.layout)} />
                  <button
                    className="cstudio-btn"
                    onClick={() => {
                      apply(c.design, c.name);
                      setCompareOpen(false);
                    }}
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`admin-toast ${toastMsg ? "is-shown" : ""}`}>{toastMsg}</div>
    </div>
  );
}
