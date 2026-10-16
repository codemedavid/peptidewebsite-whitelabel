// The SHOWCASE layout's hero — copy on the left (eyebrow, a two-line headline
// whose second line is the accent, the owner's sub-copy, the CTA pair, a trust
// row of their own promises), photography on the right.
//
// Template rules, as everywhere in this layout: every word is the owner's own
// hero copy (the same heroChipLabel / heroLine1 / heroLine2 / heroSub / CTA
// fields every other hero reads, honouring the same show/hide switches and
// per-field text styles), and the picture is theirs too — ONLY the uploaded hero
// image (heroShowcaseImage). With no upload the hero is text-only and the copy
// takes the full width (sc-hero--text); it never borrows product photos or the
// logo as a stand-in.
//
// IMAGE mode means the owner uploaded a banner. With "show text over the image"
// ON, Showcase lays its own copy over it (sc-hero--banner): the banner fills the
// hero, pinned by the owner's focus point, the copy sits on the left over a wash
// in the page colour, and on phones the picture stacks above the copy. With the
// overlay OFF the banner is a finished artwork, copy and all, so the shared
// <Hero> renders it untouched.

import type { CSSProperties } from "react";
import type { Brand } from "../types";
import { Hero } from "./Hero";
import { ShowcaseArrow, ShowcaseIcon } from "./ShowcaseIcon";
import { heroFieldCss } from "@/lib/theme/tokens";
import { imageUrl } from "@/lib/media/image-url";
import { heroMediaPosition, resolveHeroMedia } from "@/lib/storefront/hero-media";
import { assuranceIcon } from "@/lib/storefront/showcase-home";
import type { BoutiqueAssurance } from "@/lib/storefront/boutique-home";

/** The trust row under the CTAs is a glance, not the full strip. */
const HERO_TRUST_MAX = 4;

export function ShowcaseHero({
  brand,
  image,
  assurances,
  onPrimary,
  onSecondary,
  onMedia,
}: {
  brand: Brand;
  /** The uploaded hero image, already sanitised by heroShowcaseImage; null = none. */
  image: string | null;
  assurances: BoutiqueAssurance[];
  onPrimary: () => void;
  onSecondary: () => void;
  onMedia?: () => void;
}) {
  const media = resolveHeroMedia(brand);
  if (media.mode === "image" && !media.overlay) {
    return <Hero brand={brand} onPrimary={onPrimary} onSecondary={onSecondary} onMedia={onMedia} />;
  }
  const banner = media.mode === "image" ? media : null;

  const fs = brand.heroFieldStyles ?? {};
  // A custom highlight recolours the accent line, exactly as on the shared hero.
  const accentStyle: CSSProperties = {
    ...(brand.heroHighlight ? { color: brand.heroHighlight } : {}),
    ...heroFieldCss(fs.line2),
  };
  const trust = assurances.slice(0, HERO_TRUST_MAX);

  return (
    <section
      className={`sc-hero${banner ? " sc-hero--banner" : image ? "" : " sc-hero--text"}`}
      id="top"
      aria-labelledby="sc-hero-title"
    >
      {banner && (
        <figure className="sc-hero__backdrop">
          {/* Above the fold: the banner is the LCP candidate. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(banner.url, { width: 1920 })}
            alt={banner.alt}
            width={1920}
            height={1080}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{ objectPosition: heroMediaPosition(banner.focus) }}
          />
        </figure>
      )}
      <div className="container sc-hero__inner">
        <div className="sc-hero__copy">
          {brand.heroShowChip !== false && brand.heroChipLabel && (
            <p className="sc-hero__eyebrow" style={heroFieldCss(fs.chip)}>
              {brand.heroChipLabel}
            </p>
          )}

          <h1 id="sc-hero-title" className="sc-hero__title">
            <span className="sc-hero__line1 font-display" style={heroFieldCss(fs.line1)}>
              {brand.heroLine1 || brand.name}
            </span>
            {brand.heroLine2 && (
              <span className="sc-hero__line2" style={accentStyle}>
                {brand.heroLine2}
              </span>
            )}
          </h1>

          {brand.heroShowSub !== false && brand.heroSub && (
            <p className="sc-hero__sub" style={heroFieldCss(fs.sub)}>
              {brand.heroSub}
            </p>
          )}

          {brand.heroShowCtas !== false && (
            <div className="sc-hero__ctas">
              <button
                type="button"
                className="btn btn-primary sc-pill"
                onClick={onPrimary}
                style={heroFieldCss(fs.cta1)}
              >
                {brand.heroCta1 || brand.ctaLabel || "Shop now"}
                <ShowcaseArrow />
              </button>
              {brand.heroShowCta2 !== false && brand.heroCta2 && (
                <button
                  type="button"
                  className="sc-pill sc-pill--ghost"
                  onClick={onSecondary}
                  style={heroFieldCss(fs.cta2)}
                >
                  {brand.heroCta2}
                </button>
              )}
            </div>
          )}

          {trust.length > 0 && (
            <ul className="sc-hero__trust" aria-label="Why shop with us">
              {trust.map((item) => (
                <li key={item.id} className="sc-hero__trust-item">
                  <span className="sc-hero__trust-icon">
                    <ShowcaseIcon icon={assuranceIcon(item.label, item.note)} size={24} />
                  </span>
                  <span className="sc-hero__trust-label">{item.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {image && !banner && <HeroVisual image={image} />}
      </div>
    </section>
  );
}

/** The owner's uploaded hero image, framed on the right of the copy. */
function HeroVisual({ image }: { image: string }) {
  return (
    <div className="sc-hero__visual">
      <figure className="sc-hero__shot">
        {/* The hero is above the fold: the image is the LCP candidate. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl(image, { width: 960 })}
          alt=""
          width={960}
          height={980}
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </figure>
    </div>
  );
}
