"use client";

// Storefront Timeline — the owner-written steps with the current one
// highlighted. One component, two shapes:
//   - "card" : the Track Order page card (vertical list, notes shown)
//   - "hero" : a compact stepper under the hero copy (horizontal on wide
//              screens, vertical on phones; see storefront.css)
// Also rendered by the store-admin editor's live preview, so it stays purely
// presentational. All copy renders as React text nodes — never innerHTML.

import { timelineStepStates, type TimelineConfig } from "@/lib/storefront/timeline";

type TimelineCardProps = {
  config: TimelineConfig;
  variant?: "card" | "hero";
};

export function TimelineCard({ config, variant = "card" }: TimelineCardProps) {
  const states = timelineStepStates(config);

  return (
    <section
      className={`sf-timeline sf-timeline--${variant}`}
      aria-label={config.title || "Timeline"}
    >
      {config.title && <h2 className="sf-timeline__title">{config.title}</h2>}
      <ol className="sf-timeline__list">
        {config.steps.map((step, i) => (
          <li
            key={i}
            className={`sf-timeline__step is-${states[i]}`}
            aria-current={states[i] === "current" ? "step" : undefined}
          >
            <span className="sf-timeline__marker" aria-hidden="true">
              <span className="sf-timeline__dot">
                {states[i] === "done" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {i < config.steps.length - 1 && <span className="sf-timeline__line" />}
            </span>
            <span className="sf-timeline__body">
              <span className="sf-timeline__label">
                {step.title}
                {states[i] === "current" && <span className="sf-timeline__badge">Now</span>}
              </span>
              {step.date && <span className="sf-timeline__date">{step.date}</span>}
              {variant === "card" && step.note && <span className="sf-timeline__note">{step.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
