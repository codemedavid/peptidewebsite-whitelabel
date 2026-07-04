"use client";

// The announcement bar the owner can show directly under the site header. It
// renders one of three layouts the owner picks in store-admin:
//   - "single"   : one static message
//   - "carousel" : several messages that cross-fade on a timer
//   - "marquee"  : a continuous sideways scroll ("live" banner)
//
// All motion is compositor-friendly (opacity / transform only) and freezes to a
// static, readable state under prefers-reduced-motion (the carousel shows its
// dots for manual paging; the marquee stops and wraps). Config is normalized
// through the shared pure core so an untrusted stored slide can never carry a
// javascript:/data: link or a style-breaking color.

import { useEffect, useMemo, useState } from "react";
import type { Brand } from "../types";
import {
  normalizeBanner,
  resolveBannerSlideTarget,
  type BannerSlide,
  type StorefrontBanner,
} from "@/lib/storefront/banner";

// Marquee duration (seconds for one full loop) per speed setting. Longer = slower.
const MARQUEE_SECONDS: Record<StorefrontBanner["speed"], number> = {
  slow: 40,
  normal: 24,
  fast: 14,
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

// One message. When the slide links somewhere it renders as an <a>; otherwise a
// plain <span> so a decorative banner isn't a dead link.
function SlideContent({
  slide,
  onRoute,
}: {
  slide: BannerSlide;
  onRoute: (route: string) => void;
}) {
  const target = resolveBannerSlideTarget(slide);
  if (target.kind === "external") {
    return (
      <a className="sf-banner__link" href={target.url} target="_blank" rel="noopener noreferrer">
        {slide.text}
      </a>
    );
  }
  if (target.kind === "route") {
    return (
      <a
        className="sf-banner__link"
        href={`#${target.route}`}
        onClick={(e) => {
          e.preventDefault();
          onRoute(target.route);
        }}
      >
        {slide.text}
      </a>
    );
  }
  return <span className="sf-banner__text">{slide.text}</span>;
}

function Carousel({
  slides,
  autoplayMs,
  pauseOnHover,
  reduced,
  onRoute,
}: {
  slides: BannerSlide[];
  autoplayMs: number;
  pauseOnHover: boolean;
  reduced: boolean;
  onRoute: (route: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance unless the visitor prefers reduced motion or is hovering (when
  // pause-on-hover is on). Reduced motion → manual paging via the dots only.
  useEffect(() => {
    if (reduced || paused || slides.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, autoplayMs);
    return () => clearInterval(id);
  }, [reduced, paused, slides.length, autoplayMs]);

  // Keep the active index in range if the slide list shrinks.
  useEffect(() => {
    if (index > slides.length - 1) setIndex(0);
  }, [index, slides.length]);

  const active = slides[Math.min(index, slides.length - 1)];

  return (
    <div
      className="sf-banner__carousel"
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
    >
      <div className="sf-banner__slide" key={active.id}>
        <SlideContent slide={active} onRoute={onRoute} />
      </div>
      {slides.length > 1 && (
        <div className="sf-banner__dots" role="tablist" aria-label="Announcements">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`sf-banner__dot ${i === index ? "is-active" : ""}`}
              aria-label={`Show announcement ${i + 1}`}
              aria-selected={i === index}
              role="tab"
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Marquee({
  slides,
  speed,
  pauseOnHover,
  reduced,
  onRoute,
}: {
  slides: BannerSlide[];
  speed: StorefrontBanner["speed"];
  pauseOnHover: boolean;
  reduced: boolean;
  onRoute: (route: string) => void;
}) {
  // Reduced motion: don't scroll — lay the messages out statically, wrapping.
  if (reduced) {
    return (
      <div className="sf-banner__static-row">
        {slides.map((s) => (
          <span className="sf-banner__item" key={s.id}>
            <SlideContent slide={s} onRoute={onRoute} />
          </span>
        ))}
      </div>
    );
  }

  // Duplicate the track so the scroll wraps seamlessly. The clone is hidden from
  // assistive tech to avoid double-announcing every message.
  const track = (dup: boolean) =>
    slides.map((s) => (
      <span className="sf-banner__item" key={`${dup ? "d" : ""}${s.id}`} aria-hidden={dup}>
        <SlideContent slide={s} onRoute={onRoute} />
      </span>
    ));

  return (
    <div className={`sf-banner__marquee ${pauseOnHover ? "sf-banner__marquee--pausable" : ""}`}>
      <div
        className="sf-banner__marquee-track"
        style={{ animationDuration: `${MARQUEE_SECONDS[speed]}s` }}
      >
        {track(false)}
        {track(true)}
      </div>
    </div>
  );
}

export function AnnouncementBanner({
  brand,
  onRoute,
}: {
  brand: Brand;
  onRoute: (route: string) => void;
}) {
  const reduced = useReducedMotion();
  // Re-normalize at render: the save action already stored a clean value, but a
  // demo fixture or hand-edited config might not have — never trust the blob.
  const banner = useMemo(() => normalizeBanner(brand.banner), [brand.banner]);

  if (!banner.enabled || banner.slides.length === 0) return null;

  const style: React.CSSProperties = {};
  if (banner.bgColor) style.background = banner.bgColor;
  if (banner.textColor) style.color = banner.textColor;

  return (
    <aside className={`sf-banner sf-banner--${banner.mode}`} style={style} aria-label="Store announcement">
      <div className="sf-banner__inner">
        {banner.mode === "single" && (
          <div className="sf-banner__slide">
            <SlideContent slide={banner.slides[0]} onRoute={onRoute} />
          </div>
        )}
        {banner.mode === "carousel" && (
          <Carousel
            slides={banner.slides}
            autoplayMs={banner.autoplayMs}
            pauseOnHover={banner.pauseOnHover}
            reduced={reduced}
            onRoute={onRoute}
          />
        )}
        {banner.mode === "marquee" && (
          <Marquee
            slides={banner.slides}
            speed={banner.speed}
            pauseOnHover={banner.pauseOnHover}
            reduced={reduced}
            onRoute={onRoute}
          />
        )}
      </div>
    </aside>
  );
}
