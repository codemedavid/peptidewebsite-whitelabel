"use client";

// The storefront Group Buy banner: a branded strip above the catalog announcing
// the live round, with an opt-in "Explore GB #N" scope toggle (default off) that
// narrows the catalog to just the round's products. Presentation only — the
// scope filter (scopedCatalog) never changes what can be bought; the on-hand gate
// owns that. Rendered only when a run is live (the caller passes a real banner).

import { useState } from "react";
import type { GroupBuyBanner as GroupBuyBannerData } from "@/lib/storefront/group-buy-banner";

export function GroupBuyBanner({
  banner,
  scopeOn,
  onToggle,
}: {
  banner: GroupBuyBannerData;
  /** Whether the "Explore" scope filter is currently on. */
  scopeOn: boolean;
  onToggle: (next: boolean) => void;
}) {
  const [hover, setHover] = useState(false);
  // "GB #5" already reads as a label; anything else gets a separator so the
  // toggle always reads as an action ("Explore GB · Holiday Round").
  const label = /^gb\b/i.test(banner.name.trim()) ? banner.name.trim() : `GB · ${banner.name.trim()}`;
  const canScope = !banner.coversAll;

  return (
    <aside
      className="gb-banner"
      aria-label={`Group buy live: ${banner.name}`}
      style={{
        borderBottom: "1px solid var(--hairline, rgba(0,0,0,.12))",
        background: "var(--brand-tint, color-mix(in oklab, var(--brand-main, #111) 6%, transparent))",
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          paddingTop: 14,
          paddingBottom: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--brand-button-text, #fff)",
              background: "var(--brand-main, #111)",
              borderRadius: 999,
              padding: "4px 10px",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "currentColor",
                boxShadow: "0 0 0 0 currentColor",
                animation: "gb-pulse 1.8s ease-out infinite",
              }}
            />
            Group buy live
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              className="font-display"
              style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: "var(--brand-text, inherit)" }}
            >
              {banner.name}
            </div>
            {(banner.deliveryEta || banner.description) && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--brand-text-muted, #667)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "min(60ch, 70vw)",
                }}
              >
                {banner.deliveryEta ? `Delivery ${banner.deliveryEta}` : banner.description}
              </div>
            )}
          </div>
        </div>

        {canScope && (
          <button
            type="button"
            className="gb-banner__toggle"
            aria-pressed={scopeOn}
            onClick={() => onToggle(!scopeOn)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              transition: "background .15s ease, color .15s ease, border-color .15s ease",
              border: `1px solid ${scopeOn ? "var(--brand-main, #111)" : "var(--hairline, rgba(0,0,0,.16))"}`,
              background: scopeOn
                ? "var(--brand-main, #111)"
                : hover
                  ? "color-mix(in oklab, var(--brand-main, #111) 8%, transparent)"
                  : "transparent",
              color: scopeOn ? "var(--brand-button-text, #fff)" : "var(--brand-text, inherit)",
            }}
          >
            {scopeOn ? (
              <>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Showing {label} only · Show all
              </>
            ) : (
              <>Explore {label}</>
            )}
          </button>
        )}
      </div>
      <style>{"@keyframes gb-pulse{0%{box-shadow:0 0 0 0 currentColor;opacity:1}70%{box-shadow:0 0 0 6px transparent;opacity:.6}100%{box-shadow:0 0 0 0 transparent;opacity:1}}"}</style>
    </aside>
  );
}
