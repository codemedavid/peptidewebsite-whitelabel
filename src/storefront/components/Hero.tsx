import type { CSSProperties } from "react";
import { STOREFRONT_HERO_TITLE_CLAMP, STOREFRONT_HERO_BODY_CLAMP, heroFieldCss } from "@/lib/theme/tokens";
import type { Brand } from "../types";

export function Hero({
  brand,
  onPrimary,
  onSecondary,
  isGenerating,
}: {
  brand: Brand;
  onPrimary: () => void;
  onSecondary: () => void;
  isGenerating?: boolean;
}) {
  const variant = brand.heroVariant || "centered";

  // ── Hero typography overrides (admin "Hero" tab). Each is applied inline so it
  // wins over the base + per-variant storefront.css; unset fields stay undefined
  // and inherit the CSS defaults. Inline styles also reach the headline's inner
  // spans, whose .font-display rules would otherwise override a parent <h1>.
  const headlineStyle: CSSProperties = {
    fontSize: brand.heroTitleSize ? STOREFRONT_HERO_TITLE_CLAMP[brand.heroTitleSize] : undefined,
  };
  const headlineSpanStyle: CSSProperties = {
    fontFamily: brand.heroTitleFont ? `'${brand.heroTitleFont}', var(--brand-heading-font)` : undefined,
    fontWeight: brand.heroTitleWeight,
  };
  // A custom highlight replaces the accent gradient on the second headline line.
  const accentStyle: CSSProperties = brand.heroHighlight
    ? { background: "none", WebkitBackgroundClip: "border-box", backgroundClip: "border-box", color: brand.heroHighlight }
    : {};
  const subStyle: CSSProperties = {
    fontFamily: brand.heroBodyFont ? `'${brand.heroBodyFont}', var(--brand-body-font)` : undefined,
    fontSize: brand.heroBodySize ? STOREFRONT_HERO_BODY_CLAMP[brand.heroBodySize] : undefined,
  };
  const chipDotStyle: CSSProperties = brand.heroHighlight ? { background: brand.heroHighlight } : {};
  const sectionStyle: CSSProperties = brand.heroAlign ? { textAlign: brand.heroAlign } : {};

  // Per-field text-style overrides (Hero copy section of the tweaks panel).
  // These layer *over* the grouped title/body styles above so a field-level
  // choice always wins; unset attributes fall through to the grouped values.
  const fs = brand.heroFieldStyles ?? {};
  const chipStyle = heroFieldCss(fs.chip);
  const line1Style = heroFieldCss(fs.line1);
  const line2Style = heroFieldCss(fs.line2);
  const subFieldStyle = heroFieldCss(fs.sub);
  const cta1Style = heroFieldCss(fs.cta1);
  const cta2Style = heroFieldCss(fs.cta2);

  // A custom hero logo size enlarges the card (and trims its padding) so the
  // logo fills the space instead of sitting in the default whitespace.
  const logoCardStyle: CSSProperties = brand.heroLogoSize
    ? { width: brand.heroLogoSize, height: brand.heroLogoSize, padding: Math.round(brand.heroLogoSize * 0.06) }
    : {};

  const logoCard = brand.heroShowLogo !== false && (
    <div className="hero__logo-card" style={logoCardStyle}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.name} />
      ) : (
        <div className="hero__logo-fallback">
          <span>{brand.name?.[0]?.toUpperCase() || "B"}</span>
          <small>{brand.name}</small>
        </div>
      )}
    </div>
  );

  const chip = brand.heroShowChip !== false && (
    <div className="hero__chip" style={chipStyle}>
      <span className="hero__chip-dot" aria-hidden="true" style={chipDotStyle} />
      {(brand.heroChipLabel || brand.name)?.toUpperCase()}
    </div>
  );

  const headline = (
    <h1 className="hero__headline" style={headlineStyle}>
      <span className="font-display" style={{ ...headlineSpanStyle, ...line1Style }}>{brand.heroLine1 || "Premium products,"}</span>
      {brand.heroLine2 && (
        <>
          {variant !== "editorial" && <br />}
          <span className="font-display-italic hero__headline-accent" style={{ ...headlineSpanStyle, ...accentStyle, ...line2Style }}>
            {brand.heroLine2}
          </span>
        </>
      )}
    </h1>
  );

  const sub = brand.heroShowSub !== false && brand.heroSub && (
    <p className="hero__sub" style={{ ...subStyle, ...subFieldStyle }}>{brand.heroSub}</p>
  );

  const ctas = brand.heroShowCtas !== false && (
    <div className="hero__ctas">
      <button className="btn btn-primary" onClick={onPrimary} style={cta1Style}>
        {brand.heroCta1 || "Shop Now"}
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </button>
      {brand.heroShowCta2 !== false && brand.heroCta2 && (
        <button className="btn btn-secondary" onClick={onSecondary} style={cta2Style}>
          {brand.heroCta2}
        </button>
      )}
    </div>
  );

  let content: React.ReactNode;
  if (variant === "split") {
    content = (
      <div className="container hero__inner">
        <div className="hero__text">
          {chip}
          {headline}
          {sub}
          {ctas}
        </div>
        <div className="hero__visual">{logoCard}</div>
      </div>
    );
  } else if (variant === "editorial") {
    content = (
      <div className="container hero__inner">
        <div className="hero__masthead">
          <span>{(brand.name || "Brand").toUpperCase()}</span>
          <span>{brand.heroChipLabel || "Issue 01"}</span>
        </div>
        {headline}
        <div className="hero__bottom">
          {sub}
          {ctas}
        </div>
      </div>
    );
  } else if (variant === "card") {
    content = (
      <div className="container">
        <div className="hero__inner">
          {logoCard}
          {chip}
          {headline}
          {sub}
          {ctas}
        </div>
      </div>
    );
  } else if (variant === "minimal") {
    content = (
      <div className="container hero__inner">
        {logoCard}
        {chip}
        {headline}
        {sub}
        {ctas}
      </div>
    );
  } else {
    // "centered" (default) and "spotlight" share the bg + inner layout
    content = (
      <>
        <div className="hero__bg" aria-hidden="true" />
        <div className="container hero__inner">
          {logoCard}
          {chip}
          {headline}
          {sub}
          {ctas}
        </div>
      </>
    );
  }

  return (
    <section
      className={`hero ${isGenerating ? "is-generating" : ""}`}
      id="top"
      data-variant={variant}
      style={sectionStyle}
    >
      {content}
    </section>
  );
}
