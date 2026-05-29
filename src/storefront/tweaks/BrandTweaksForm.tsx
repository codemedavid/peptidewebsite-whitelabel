"use client";

// The full Brand Tweaks form body — every control section ported from the
// design's <TweaksPanel>: AI Hero Designer, section & page toggles, identity,
// colors (hex/RGB/HSL), typography, header/hero/catalog, per-page copy, footer.
//
// It is host-agnostic: it only needs the current `brand` and a `setTweak`
// writer. The storefront mounts it inside a floating, localStorage-backed panel
// (BrandTweaks); the platform admin mounts it inside the Branding editor where
// `setTweak` writes to local state that the "Save branding" button persists to
// the database. `goPage`/`goHome` differ per host (in-app hash vs. open tab).

import { useState } from "react";
import type { Brand } from "../types";
import {
  FONT_OPTIONS,
  FONT_WEIGHTS,
  WEIGHT_LABELS,
  LETTER_SPACINGS,
  HERO_FIELD_SIZES,
  type FontWeight,
  type HeroTextField,
  type HeroFieldStyle,
} from "@/lib/theme/tokens";
import {
  ColorField,
  LogoUpload,
  TweakButton,
  TweakSection,
  TweakSelect,
  TweakText,
  TweakToggle,
} from "./controls";
import { FooterEditor } from "./FooterEditor";
import { DESIGN_FONTS_HREF } from "./designFonts";

const INHERIT = "Inherit";

// Per-field text-style controls for one hero copy element. Collapsed by default
// to keep the panel scannable; writes a HeroFieldStyle patch up to setTweak.
function HeroFieldStyle_({
  style,
  onChange,
}: {
  style: HeroFieldStyle;
  onChange: (patch: Partial<HeroFieldStyle>) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = Object.values(style).some((v) => v !== undefined);

  const weightLabel = (w?: FontWeight) => (w ? WEIGHT_LABELS[w] : INHERIT);
  const spacingLabel = (em?: number) =>
    em === undefined ? INHERIT : (Object.keys(LETTER_SPACINGS).find((k) => LETTER_SPACINGS[k] === em) ?? INHERIT);

  return (
    <div style={{ margin: "-4px 0 2px" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: "none",
          border: 0,
          background: "transparent",
          cursor: "pointer",
          padding: "2px 0",
          font: "inherit",
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: ".03em",
          color: active ? "rgba(41,38,27,.72)" : "rgba(41,38,27,.45)",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s", fontSize: 8 }}>▶</span>
        Text style{active ? " •" : ""}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6 }}>
          <TweakSelect
            label="Font"
            value={style.font ?? INHERIT}
            options={[INHERIT, ...FONT_OPTIONS]}
            onChange={(v) => onChange({ font: v === INHERIT ? undefined : v })}
          />
          <TweakSelect
            label="Size"
            value={style.size ? String(style.size) : INHERIT}
            options={[INHERIT, ...HERO_FIELD_SIZES.map((s) => `${s}px`)]}
            onChange={(v) => onChange({ size: v === INHERIT ? undefined : parseInt(v, 10) })}
          />
          <TweakSelect
            label="Weight"
            value={weightLabel(style.weight)}
            options={[INHERIT, ...FONT_WEIGHTS.map((w) => WEIGHT_LABELS[w])]}
            onChange={(v) =>
              onChange({ weight: v === INHERIT ? undefined : FONT_WEIGHTS.find((w) => WEIGHT_LABELS[w] === v) })
            }
          />
          <TweakSelect
            label="Italic"
            value={style.italic === undefined ? INHERIT : style.italic ? "Italic" : "Not italic"}
            options={[INHERIT, "Italic", "Not italic"]}
            onChange={(v) => onChange({ italic: v === INHERIT ? undefined : v === "Italic" })}
          />
          <TweakSelect
            label="Transform"
            value={
              style.transform === undefined
                ? INHERIT
                : { uppercase: "UPPERCASE", lowercase: "lowercase", capitalize: "Capitalize", none: "None" }[style.transform]
            }
            options={[INHERIT, "UPPERCASE", "lowercase", "Capitalize", "None"]}
            onChange={(v) =>
              onChange({
                transform:
                  v === INHERIT
                    ? undefined
                    : (({ UPPERCASE: "uppercase", lowercase: "lowercase", Capitalize: "capitalize", None: "none" } as const)[
                        v as "UPPERCASE" | "lowercase" | "Capitalize" | "None"
                      ]),
              })
            }
          />
          <TweakSelect
            label="Letter spacing"
            value={spacingLabel(style.letterSpacing)}
            options={[INHERIT, ...Object.keys(LETTER_SPACINGS)]}
            onChange={(v) => onChange({ letterSpacing: v === INHERIT ? undefined : LETTER_SPACINGS[v] })}
          />
        </div>
      )}
    </div>
  );
}

export const HERO_VARIANTS: Brand["heroVariant"][] = [
  "centered",
  "split",
  "editorial",
  "card",
  "minimal",
  "spotlight",
];

// Local, no-network hero composer — picks a layout + copy from the industry tag.
// (The design called window.claude.complete; this keeps the feature usable offline.)
export function composeHero(industry: string, brandName: string): Partial<Brand> {
  const k = (industry || "").toLowerCase();
  const pick = (...opts: Brand["heroVariant"][]) => opts[Math.floor(Math.random() * opts.length)];
  let variant: Brand["heroVariant"] = "centered";
  if (/saas|tech|app|software|api|platform/.test(k)) variant = pick("split", "card", "spotlight");
  else if (/luxury|design|studio|art|architect/.test(k)) variant = pick("minimal", "editorial");
  else if (/fashion|food|lifestyle|magazine|publish/.test(k)) variant = pick("editorial", "card");
  else if (/performance|auto|gym|sport|crypto/.test(k)) variant = pick("spotlight", "split");
  else if (/beauty|peptide|wellness|skin|health/.test(k)) variant = pick("centered", "card");
  else variant = pick("centered", "split", "card");

  const topic = industry?.trim() || "your brand";
  const chip = topic.toUpperCase().slice(0, 22);
  const lines: [string, string][] = [
    ["Crafted for", topic + "."],
    ["Made to", "stand out."],
    ["The new standard", "in " + topic + "."],
    ["Premium " + topic + ",", "beautifully done."],
  ];
  const [l1, l2] = lines[Math.floor(Math.random() * lines.length)];
  const subs = [
    `A refined experience for ${topic}, with the details that matter and none that don't.`,
    `${brandName || "We"} brings clarity and craft to ${topic} — verified, considered, and built to last.`,
    `Everything you need for ${topic}, presented with intent and shipped with care.`,
  ];
  return {
    heroVariant: variant,
    heroChipLabel: chip,
    heroLine1: l1,
    heroLine2: l2,
    heroSub: subs[Math.floor(Math.random() * subs.length)],
    heroCta1: "Shop Now",
    heroCta2: "Learn More",
  };
}

export type SetTweak = (keyOrEdits: keyof Brand | Partial<Brand>, val?: unknown) => void;

export function BrandTweaksForm({
  brand: t,
  setTweak,
  goPage,
  goHome,
}: {
  brand: Brand;
  setTweak: SetTweak;
  goPage: (page: string) => void;
  goHome: () => void;
}) {
  const [generating, setGenerating] = useState(false);

  const generateHero = () => {
    setGenerating(true);
    // Brief delay to surface the "Generating…" affordance, then apply.
    setTimeout(() => {
      setTweak(composeHero(t.industry, t.name));
      setGenerating(false);
    }, 450);
  };
  const cycleHeroVariant = () => {
    const i = HERO_VARIANTS.indexOf(t.heroVariant || "centered");
    setTweak("heroVariant", HERO_VARIANTS[(i + 1) % HERO_VARIANTS.length]);
  };

  // Merge a per-field hero text-style patch into heroFieldStyles, pruning any
  // attribute reset to "Inherit" (undefined) so the stored object stays minimal.
  const setFieldStyle = (field: HeroTextField, patch: Partial<HeroFieldStyle>) => {
    const all = t.heroFieldStyles ?? {};
    const next: HeroFieldStyle = { ...(all[field] ?? {}), ...patch };
    (Object.keys(next) as (keyof HeroFieldStyle)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    setTweak("heroFieldStyles", { ...all, [field]: next });
  };
  const fieldStyle = (field: HeroTextField): HeroFieldStyle => t.heroFieldStyles?.[field] ?? {};

  return (
    <>
      {/* Load all selectable fonts only while the picker is open. */}
      <link rel="stylesheet" href={DESIGN_FONTS_HREF} />
      <TweakSection label="✨ AI Hero Designer" />
      <TweakText
        label="Industry / what you sell"
        value={t.industry}
        placeholder="e.g. coffee, peptides, SaaS"
        onChange={(v) => setTweak("industry", v)}
      />
      <TweakButton label={generating ? "Generating…" : "Generate hero"} onClick={generateHero} disabled={generating} />
      <TweakButton label="Cycle layout variant" onClick={cycleHeroVariant} />

      <TweakSection label="Sections (show / hide)" />
      <TweakToggle label="Header" value={t.showHeader !== false} onChange={(v) => setTweak("showHeader", v)} />
      <TweakToggle label="Hero" value={t.showHero !== false} onChange={(v) => setTweak("showHero", v)} />
      <TweakToggle label="Categories" value={t.showCategories !== false} onChange={(v) => setTweak("showCategories", v)} />
      <TweakToggle label="Catalog" value={t.showCatalog !== false} onChange={(v) => setTweak("showCatalog", v)} />
      <TweakToggle label="Footer" value={t.showFooter !== false} onChange={(v) => setTweak("showFooter", v)} />

      <TweakSection label="Pages (show / hide)" />
      <TweakToggle label="Track Order page" value={t.showPageTrack !== false} onChange={(v) => setTweak("showPageTrack", v)} />
      <TweakToggle label="FAQ page" value={t.showPageFAQ !== false} onChange={(v) => setTweak("showPageFAQ", v)} />
      <TweakToggle label="Lab Reports (COA) page" value={t.showPageCOA !== false} onChange={(v) => setTweak("showPageCOA", v)} />
      <TweakToggle label="Protocols page" value={t.showPageProtocols !== false} onChange={(v) => setTweak("showPageProtocols", v)} />
      <TweakToggle label="Reviews page" value={t.showPageReviews !== false} onChange={(v) => setTweak("showPageReviews", v)} />
      <TweakButton label="Open: Home" onClick={goHome} secondary />
      <TweakButton label="Open: Track Order" onClick={() => goPage("track")} secondary />
      <TweakButton label="Open: FAQ" onClick={() => goPage("faq")} secondary />
      <TweakButton label="Open: Lab Reports" onClick={() => goPage("coa")} secondary />
      <TweakButton label="Open: Protocols" onClick={() => goPage("protocols")} secondary />
      <TweakButton label="Open: Reviews" onClick={() => goPage("reviews")} secondary />

      <TweakSection label="Admin Dashboard" />
      <TweakText label="Admin password" value={t.adminPassword} placeholder="default: admin" onChange={(v) => setTweak("adminPassword", v.trim())} />
      <TweakText label="Login title" value={t.adminLoginTitle} onChange={(v) => setTweak("adminLoginTitle", v)} />
      <TweakText label="Login subtitle" value={t.adminLoginSub} placeholder={`defaults to: Enter the admin password for ${t.name || "this tenant"}`} onChange={(v) => setTweak("adminLoginSub", v)} />
      <TweakButton label="Open: Admin Dashboard" onClick={() => goPage("admin")} secondary />

      <TweakSection label="Identity" />
      <TweakText label="Brand name" value={t.name} onChange={(v) => setTweak("name", v)} />
      <LogoUpload value={t.logoUrl} onChange={(v) => setTweak("logoUrl", v)} />
      <TweakText label="Logo URL" value={t.logoUrl} placeholder="or paste a URL" onChange={(v) => setTweak("logoUrl", v)} />

      <TweakSection label="Colors" />
      <ColorField label="Main" value={t.main} onChange={(v) => setTweak("main", v)}
        options={["#B0345E", "#E94B7D", "#0F4C81", "#2A6FDB", "#1F8A5B", "#22B07D", "#7A4FCF", "#9D6BE3", "#C25E1A", "#E08C2A", "#D4AF37", "#1A1A1A", "#5B5B5B", "#FFFFFF"]} />
      <ColorField label="Accent" value={t.accent} onChange={(v) => setTweak("accent", v)}
        options={["#E94B7D", "#F687A8", "#2A6FDB", "#7BB6FF", "#22B07D", "#7DDDB1", "#9D6BE3", "#C9A8F0", "#E08C2A", "#F0B574", "#F23E5C", "#FFC857", "#FF6B35", "#06D6A0"]} />
      <ColorField label="Button" value={t.button} onChange={(v) => setTweak("button", v)}
        options={["#E94B7D", "#B0345E", "#2A6FDB", "#0F4C81", "#22B07D", "#1F8A5B", "#9D6BE3", "#7A4FCF", "#E08C2A", "#C25E1A", "#1A1A1A", "#3A3A3A"]} />
      <ColorField label="Button gradient" value={t.button2} onChange={(v) => setTweak("button2", v)}
        options={["#F687A8", "#FFB3CC", "#7BB6FF", "#A8D0FF", "#7DDDB1", "#A8E6CC", "#C9A8F0", "#E0CCFF", "#F0B574", "#FFD9A8", "#4A4A4A", "#6E6E6E"]} />
      <ColorField label="Background" value={t.background} onChange={(v) => setTweak("background", v)}
        options={["#FFF7FA", "#FFFFFF", "#F5F8FC", "#F4FAF6", "#FAF7FF", "#FAF6F0", "#F8F8F6", "#FFF8EC", "#F0F4F8", "#0F0F12", "#1A1A20", "#0A0E1A"]} />
      <ColorField label="Surface" value={t.surface} onChange={(v) => setTweak("surface", v)}
        options={["#FFFFFF", "#FAFAFA", "#F5F5F5", "#FFF9F5", "#F8FBFF", "#1A1A20", "#252530", "#0F0F12"]} />
      <ColorField label="Text" value={t.text} onChange={(v) => setTweak("text", v)}
        options={["#3B1F2A", "#1A1A1A", "#000000", "#2A2A33", "#3A3A3A", "#5A4A52", "#6B6B6B", "#EFEFEF", "#FFFFFF"]} />

      <TweakSection label="Typography" />
      <TweakSelect label="Heading font" value={t.headingFont} onChange={(v) => setTweak("headingFont", v)}
        options={["Playfair Display", "DM Serif Display", "Cormorant Garamond", "Lora", "Inter", "DM Sans", "Manrope"]} />
      <TweakSelect label="Body font" value={t.bodyFont} onChange={(v) => setTweak("bodyFont", v)}
        options={["Inter", "DM Sans", "Manrope", "Work Sans", "IBM Plex Sans", "Lora"]} />

      <TweakSection label="Header elements" />
      <TweakToggle label="Brand name in header" value={t.headerShowBrand !== false} onChange={(v) => setTweak("headerShowBrand", v)} />
      <TweakToggle label="Cart" value={t.headerShowCart !== false} onChange={(v) => setTweak("headerShowCart", v)} />
      <TweakToggle label="CTA button" value={t.headerShowCta !== false} onChange={(v) => setTweak("headerShowCta", v)} />

      <TweakSection label="Hero layout & elements" />
      <TweakSelect label="Layout variant" value={t.heroVariant || "centered"} onChange={(v) => setTweak("heroVariant", v as Brand["heroVariant"])} options={[...HERO_VARIANTS]} />
      <TweakToggle label="Show logo card" value={t.heroShowLogo !== false} onChange={(v) => setTweak("heroShowLogo", v)} />
      <TweakToggle label="Show chip" value={t.heroShowChip !== false} onChange={(v) => setTweak("heroShowChip", v)} />
      <TweakToggle label="Show subhead" value={t.heroShowSub !== false} onChange={(v) => setTweak("heroShowSub", v)} />
      <TweakToggle label="Show CTAs" value={t.heroShowCtas !== false} onChange={(v) => setTweak("heroShowCtas", v)} />
      <TweakToggle label="Show secondary CTA" value={t.heroShowCta2 !== false} onChange={(v) => setTweak("heroShowCta2", v)} />

      <TweakSection label="Hero copy" />
      <TweakText label="Chip label" value={t.heroChipLabel} placeholder="defaults to brand name" onChange={(v) => setTweak("heroChipLabel", v)} />
      <HeroFieldStyle_ style={fieldStyle("chip")} onChange={(p) => setFieldStyle("chip", p)} />
      <TweakText label="Line 1" value={t.heroLine1} onChange={(v) => setTweak("heroLine1", v)} />
      <HeroFieldStyle_ style={fieldStyle("line1")} onChange={(p) => setFieldStyle("line1", p)} />
      <TweakText label="Line 2 (italic)" value={t.heroLine2} onChange={(v) => setTweak("heroLine2", v)} />
      <HeroFieldStyle_ style={fieldStyle("line2")} onChange={(p) => setFieldStyle("line2", p)} />
      <TweakText label="Subhead" value={t.heroSub} onChange={(v) => setTweak("heroSub", v)} />
      <HeroFieldStyle_ style={fieldStyle("sub")} onChange={(p) => setFieldStyle("sub", p)} />
      <TweakText label="Primary CTA" value={t.heroCta1} onChange={(v) => setTweak("heroCta1", v)} />
      <HeroFieldStyle_ style={fieldStyle("cta1")} onChange={(p) => setFieldStyle("cta1", p)} />
      <TweakText label="Secondary CTA" value={t.heroCta2} onChange={(v) => setTweak("heroCta2", v)} />
      <HeroFieldStyle_ style={fieldStyle("cta2")} onChange={(p) => setFieldStyle("cta2", p)} />

      <TweakSection label="Catalog" />
      <TweakText label="Eyebrow" value={t.catalogEyebrow} onChange={(v) => setTweak("catalogEyebrow", v)} />
      <TweakText label="Title" value={t.catalogTitle} onChange={(v) => setTweak("catalogTitle", v)} />
      <TweakToggle label="Show search" value={t.catalogShowSearch !== false} onChange={(v) => setTweak("catalogShowSearch", v)} />
      <TweakToggle label="Show sort" value={t.catalogShowSort !== false} onChange={(v) => setTweak("catalogShowSort", v)} />
      <TweakToggle label="Show product count" value={t.catalogShowCount !== false} onChange={(v) => setTweak("catalogShowCount", v)} />

      <TweakSection label="Page: Track Order" />
      <TweakText label="Title" value={t.trackTitle} onChange={(v) => setTweak("trackTitle", v)} />
      <TweakText label="Subtitle" value={t.trackSub} onChange={(v) => setTweak("trackSub", v)} />
      <TweakText label="Input placeholder" value={t.trackPlaceholder} onChange={(v) => setTweak("trackPlaceholder", v)} />
      <TweakText label="CTA label" value={t.trackCta} onChange={(v) => setTweak("trackCta", v)} />

      <TweakSection label="Page: FAQ" />
      <TweakText label="Title" value={t.faqTitle} onChange={(v) => setTweak("faqTitle", v)} />

      <TweakSection label="Page: Lab Reports (COA)" />
      <TweakText label="Title" value={t.coaTitle} onChange={(v) => setTweak("coaTitle", v)} />
      <TweakText label="Verified label" value={t.coaVerifiedLabel} onChange={(v) => setTweak("coaVerifiedLabel", v)} />
      <TweakText label="Empty message" value={t.coaEmptyMsg} onChange={(v) => setTweak("coaEmptyMsg", v)} />
      <TweakText label="Info title" value={t.coaInfoTitle} onChange={(v) => setTweak("coaInfoTitle", v)} />
      <TweakText label="Info body" value={t.coaInfoBody} onChange={(v) => setTweak("coaInfoBody", v)} />

      <TweakSection label="Page: Protocols" />
      <TweakText label="Eyebrow" value={t.protocolsEyebrow} onChange={(v) => setTweak("protocolsEyebrow", v)} />
      <TweakText label="Title" value={t.protocolsTitle} onChange={(v) => setTweak("protocolsTitle", v)} />
      <TweakText label="Subtitle" value={t.protocolsSub} onChange={(v) => setTweak("protocolsSub", v)} />

      <TweakSection label="Page: Reviews" />
      <TweakText label="Title" value={t.reviewsTitle} onChange={(v) => setTweak("reviewsTitle", v)} />

      <TweakSection label="Footer" />
      <TweakToggle label="Show brand block" value={t.footerShowBrand !== false} onChange={(v) => setTweak("footerShowBrand", v)} />
      <TweakToggle label="Show blurb" value={t.footerShowBlurb !== false} onChange={(v) => setTweak("footerShowBlurb", v)} />
      <TweakToggle label="Show socials" value={t.footerShowSocials !== false} onChange={(v) => setTweak("footerShowSocials", v)} />
      <TweakToggle label="Show link columns" value={t.footerShowColumns !== false} onChange={(v) => setTweak("footerShowColumns", v)} />
      <TweakToggle label="Show legal row" value={t.footerShowLegal !== false} onChange={(v) => setTweak("footerShowLegal", v)} />
      <TweakText label="Blurb" value={t.footerBlurb} onChange={(v) => setTweak("footerBlurb", v)} />
      <TweakText label="Copyright" value={t.footerCopyright} placeholder="© {year} {brand}. All rights reserved." onChange={(v) => setTweak("footerCopyright", v)} />
      <TweakText label="Disclaimer" value={t.footerDisclaimer} onChange={(v) => setTweak("footerDisclaimer", v)} />
      <FooterEditor brand={t} setTweak={setTweak} />
    </>
  );
}
