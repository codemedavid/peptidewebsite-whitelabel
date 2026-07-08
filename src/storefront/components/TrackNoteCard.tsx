"use client";

// Track-Order Delivery Note card — the per-tenant informational card shown on
// the storefront Track Order page, directly under the order-number search box.
// Reused by the live page and by the store-admin editor's live preview, so it is
// a pure presentational component driven entirely by TrackNoteConfig. All copy is
// rendered as React text nodes (HTML-escaped by React) — never innerHTML.

import type { TrackNoteConfig } from "@/lib/storefront/track-note";

export function TrackNoteCard({ config }: { config: TrackNoteConfig }) {
  return (
    <section className="track-note" aria-label={config.title || "Delivery estimates"}>
      {(config.title || config.subtitle) && (
        <header className="track-note__head">
          <span className="track-note__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 17h4V5H2v12h3" />
              <path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h2" />
              <circle cx="7.5" cy="17.5" r="2.5" />
              <circle cx="17.5" cy="17.5" r="2.5" />
            </svg>
          </span>
          {config.title && <span className="track-note__title">{config.title}</span>}
          {config.subtitle && (
            <span className="track-note__sub">
              <span className="track-note__dot" aria-hidden="true">·</span>
              {config.subtitle}
            </span>
          )}
        </header>
      )}

      {config.rows.length > 0 && (
        <dl className="track-note__grid">
          {config.rows.map((row, i) => (
            <div key={i} className="track-note__row">
              <dt className="track-note__region">{row.region}</dt>
              <dd className="track-note__estimate">{row.estimate}</dd>
            </div>
          ))}
        </dl>
      )}

      {config.footnote && <p className="track-note__footnote">{config.footnote}</p>}
    </section>
  );
}
