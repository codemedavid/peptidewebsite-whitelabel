"use client";

// Classic-home "why shop with us" strip, under the catalog. Renders nothing
// unless the store opted in (Brand.showTrustStrip) — see lib/storefront/trust-strip.

import "./trust-strip.css";
import type { Brand } from "../types";
import { buildTrustStrip, type TrustIcon } from "@/lib/storefront/trust-strip";

const PATHS: Record<TrustIcon, React.ReactNode> = {
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkle: <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3zM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17z" />,
  flask: (
    <>
      <path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3" />
      <path d="M7.5 14h9" />
    </>
  ),
  truck: (
    <>
      <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>
  ),
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />,
  check: <path d="M20 6 9 17l-5-5" />,
};

function Icon({ name }: { name: TrustIcon }) {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

export function TrustStrip({ brand }: { brand: Brand }) {
  const strip = buildTrustStrip(brand);
  if (!strip) return null;
  return (
    <section className="trust-strip" aria-labelledby="trust-strip-title">
      <div className="container">
        <h2 id="trust-strip-title" className="trust-strip__title">{strip.title}</h2>
        <ul className="trust-strip__row" data-count={strip.items.length}>
          {strip.items.map((item) => (
            <li key={item.id} className="trust-strip__item">
              <span className="trust-strip__icon"><Icon name={item.icon} /></span>
              <span className="trust-strip__label">{item.label}</span>
              {item.note && <span className="trust-strip__note">{item.note}</span>}
            </li>
          ))}
        </ul>
        {strip.quote && (
          <figure className="trust-strip__quote">
            <blockquote>{strip.quote}</blockquote>
          </figure>
        )}
      </div>
    </section>
  );
}
