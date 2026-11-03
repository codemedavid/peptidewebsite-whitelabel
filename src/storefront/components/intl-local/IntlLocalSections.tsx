"use client";

// The Intl & Local home SECTIONS — hero, market cards, learn cards, the
// community / custom bands and the newsletter. Presentational: each takes its
// slice of config and renders exactly that, so the store-admin live preview
// renders the very same components with the owner's unsaved draft.
//
// Every element carries its own SectionBackground (bgProps → separate image and
// overlay layers), every empty field simply isn't drawn, and every button goes
// through IlButtonLink, which drops a button that has nowhere to go.

import { useState, type FormEvent } from "react";
import type {
  IlBand,
  IlCard,
  IlHero,
  IlMarketCard,
  IlNewsletter,
  IlSectionGroup,
} from "@/lib/storefront/intl-local/config";
import { HERO_SIZES, HERO_WIDTHS, imageSrcSet, imageUrl } from "@/lib/media/image-url";
import { IlButtonLink, IlLinkAnchor } from "./il-nav";
import { IlIcon } from "./IlIcon";
import { bgProps } from "./il-style";

function Heading({ title, description, id }: { title: string; description: string; id: string }) {
  if (!title && !description) return null;
  return (
    <header className="il-section__head">
      {title && <h2 id={id}>{title}</h2>}
      {description && <p>{description}</p>}
    </header>
  );
}

/** A decorative or icon image. Below-the-fold, so lazy. */
function Art({ src, width }: { src: string; width: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={imageUrl(src, { width: width * 2 })} alt="" width={width} height={width} loading="lazy" decoding="async" />;
}

export function IlHeroSection({ hero }: { hero: IlHero }) {
  if (!hero.show) return null;
  const p = bgProps(hero.background, `il-hero il-hero--${hero.align}`, hero.textColor);
  const hasImage = hero.imageSide !== "none" && !!(hero.imageUrl || hero.mobileImageUrl);
  const desktop = hero.imageUrl || hero.mobileImageUrl;
  return (
    <section
      className={`${p.className}${hasImage ? ` il-hero--img-${hero.imageSide}` : ""}`}
      style={p.style}
      aria-labelledby={hero.title ? "il-hero-title" : undefined}
    >
      <div className="il-hero__copy">
        {hero.eyebrow && <p className="il-eyebrow">{hero.eyebrow}</p>}
        {hero.title && <h1 id="il-hero-title">{hero.title}</h1>}
        {hero.description && <p className="il-hero__desc">{hero.description}</p>}
        <div className="il-actions">
          {hero.buttons.map((b, i) => (
            <IlButtonLink key={i} btn={b} />
          ))}
        </div>
      </div>
      {hasImage && (
        <picture className="il-hero__media">
          {hero.mobileImageUrl && hero.imageUrl && (
            <source media="(max-width: 719px)" srcSet={imageSrcSet(hero.mobileImageUrl, [480, 720, 960])} />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl(desktop, { width: 1280 })}
            srcSet={imageSrcSet(desktop, [...HERO_WIDTHS])}
            sizes={HERO_SIZES}
            alt={hero.imageAlt}
            width={960}
            height={640}
            loading="eager"
            fetchPriority="high"
          />
        </picture>
      )}
    </section>
  );
}

const ART_FOCUS: Record<IlMarketCard["imageFocus"], string> = {
  center: "center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
};

function MarketCard({ card }: { card: IlMarketCard }) {
  const p = bgProps(card.background, "il-market", card.textColor);
  return (
    <article className={p.className} style={p.style}>
      {card.icon !== "none" && (
        <span className="il-market__icon">
          <IlIcon name={card.icon} size={44} />
        </span>
      )}
      <div className="il-market__body">
        {card.eyebrow && <p className="il-eyebrow il-eyebrow--sm">{card.eyebrow}</p>}
        {(card.title || card.currency) && (
          <h3 className="il-market__title">
            {card.title}
            {card.title && card.currency && " · "}
            {card.currency && <span className="il-market__currency">{card.currency}</span>}
          </h3>
        )}
        {card.description && <p className="il-market__desc">{card.description}</p>}
        <IlButtonLink btn={card.button} />
      </div>
      {card.imageUrl && (
        // Its own layer: blend mode and opacity apply to the picture only.
        <span
          className={`il-market__art il-market__art--${card.imageBlend} il-market__art--${card.imageSize}`}
          style={
            {
              "--il-art-opacity": String(card.imageOpacity / 100),
              "--il-art-pos": ART_FOCUS[card.imageFocus],
            } as React.CSSProperties
          }
        >
          <Art src={card.imageUrl} width={card.imageBlend === "cover" ? 640 : card.imageBlend === "watermark" ? 260 : 150} />
        </span>
      )}
    </article>
  );
}

export function IlMarketsSection({ markets }: { markets: IlSectionGroup<IlMarketCard> }) {
  const cards = markets.cards.filter((c) => c.show);
  if (!markets.show || cards.length === 0) return null;
  return (
    <section id="il-markets" className="il-section" aria-labelledby="il-markets-title">
      <Heading id="il-markets-title" title={markets.title} description={markets.description} />
      <div className="il-markets" data-count={cards.length}>
        {cards.map((c) => (
          <MarketCard key={c.id} card={c} />
        ))}
      </div>
    </section>
  );
}

function LearnCard({ card }: { card: IlCard }) {
  const p = bgProps(card.background, "il-learn", card.textColor);
  const badge: Record<string, string> = card.iconBg ? { "--il-badge": card.iconBg } : {};
  return (
    <article className={p.className} style={p.style}>
      {(card.imageUrl || card.icon !== "none") && (
        <span className="il-learn__badge" style={badge}>
          {card.imageUrl ? <Art src={card.imageUrl} width={72} /> : <IlIcon name={card.icon} size={34} />}
        </span>
      )}
      <div className="il-learn__body">
        {card.title && <h3>{card.title}</h3>}
        {card.description && <p>{card.description}</p>}
        {card.ctaLabel && (
          // The whole card is the hit target (::after stretches the link).
          <IlLinkAnchor link={card.link} className="il-learn__cta">
            {card.ctaLabel} <span aria-hidden="true">→</span>
          </IlLinkAnchor>
        )}
      </div>
    </article>
  );
}

export function IlLearnSection({ learn }: { learn: IlSectionGroup<IlCard> }) {
  const cards = learn.cards.filter((c) => c.show);
  if (!learn.show || cards.length === 0) return null;
  return (
    <section id="il-learn" className="il-section" aria-labelledby="il-learn-title">
      <Heading id="il-learn-title" title={learn.title} description={learn.description} />
      <div className="il-learn-grid" data-count={Math.min(cards.length, 4)}>
        {cards.map((c) => (
          <LearnCard key={c.id} card={c} />
        ))}
      </div>
    </section>
  );
}

/** A full-width band — the Community section and every custom section. */
export function IlBandSection({ band, anchor }: { band: IlBand; anchor?: string }) {
  if (!band.show || (!band.title && !band.description)) return null;
  const p = bgProps(band.background, "il-band", band.textColor);
  return (
    <section id={anchor} className="il-section il-section--flush">
      <div className={p.className} style={p.style}>
        {(band.imageUrl || band.icon !== "none") && (
          <span className="il-band__icon">
            {band.imageUrl ? <Art src={band.imageUrl} width={64} /> : <IlIcon name={band.icon} size={30} />}
          </span>
        )}
        <div className="il-band__copy">
          {band.title && <h2>{band.title}</h2>}
          {band.description && <p>{band.description}</p>}
        </div>
        <IlButtonLink btn={band.button} className="il-band__cta" />
      </div>
    </section>
  );
}

export type SubscribeResult = { ok: true } | { error: string };

export function IlNewsletterSection({
  newsletter,
  onSubscribe,
}: {
  newsletter: IlNewsletter;
  onSubscribe: (email: string, honeypot: string) => Promise<SubscribeResult>;
}) {
  const [email, setEmail] = useState("");
  const [trap, setTrap] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (!newsletter.show) return null;
  const p = bgProps(newsletter.background, "il-band il-newsletter", newsletter.textColor);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setState("busy");
    try {
      const res = await onSubscribe(email.trim(), trap);
      if ("error" in res) {
        setError(res.error);
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Couldn't subscribe right now — please try again.");
      setState("idle");
    }
  };

  return (
    <section id="il-newsletter" className="il-section il-section--flush">
      <div className={p.className} style={p.style}>
        {newsletter.icon !== "none" && (
          <span className="il-band__icon il-band__icon--plain">
            <IlIcon name={newsletter.icon} size={34} />
          </span>
        )}
        <div className="il-band__copy">
          {newsletter.title && <h2>{newsletter.title}</h2>}
          {newsletter.description && <p>{newsletter.description}</p>}
        </div>
        {state === "done" ? (
          <p className="il-newsletter__done" role="status">
            {newsletter.successMessage}
          </p>
        ) : (
          <form className="il-newsletter__form" onSubmit={submit} noValidate>
            <label className="il-sr" htmlFor="il-newsletter-email">
              Email address
            </label>
            <input
              id="il-newsletter-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={newsletter.placeholder}
              aria-invalid={!!error}
              aria-describedby={error ? "il-newsletter-error" : undefined}
            />
            {/* Honeypot: invisible to people, irresistible to form bots. */}
            <input className="il-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} name="website" />
            <button type="submit" className="il-btn il-btn--solid" disabled={state === "busy"}>
              {state === "busy" ? "…" : newsletter.buttonLabel}
            </button>
            {error && (
              <p id="il-newsletter-error" className="il-newsletter__error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
