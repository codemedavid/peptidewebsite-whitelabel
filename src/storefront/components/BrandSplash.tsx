"use client";

// The branded loading screen every storefront boots through.
//
// A full-viewport overlay carrying the tenant's own mark and colors, shown while
// the storefront hydrates and lifted as soon as it has. It replaces the moment
// where a white-label store showed a generic grey skeleton and gave the shopper
// no sign of whose shop they had just opened.
//
// DISMISSAL IS DELIBERATELY BELT-AND-BRACES. This element covers the entire
// viewport, so a splash that fails to lift is not a cosmetic bug — it is an
// outage on every tenant at once. Two independent mechanisms clear it:
//
//   1. This component, on mount, after `minDurationMs`. Because the effect runs
//      at hydration (not on window `load`), the splash is gone long before the
//      images finish and never becomes the LCP element.
//   2. brand-splash.css, with an animation that ends at opacity 0 /
//      visibility hidden under `animation-fill-mode: forwards`, capped at
//      `maxDurationMs`. This one needs no JavaScript at all, so a hydration
//      failure, a chunk that 404s, or a browser with JS off still gets a usable
//      store. The CSS is the guarantee; the effect is only the fast path.
//
// Config comes pre-normalized from the server layout and every value is
// resolved through lib/storefront/brand-splash, so the overlay, the operator's
// live preview and the server all render from one contract.

import { useEffect, useState } from "react";
import { imageUrl, LOGO_WIDTH } from "@/lib/media/image-url";
import { Monogram } from "@/components/Monogram";
import {
  splashLogoUrl,
  splashVarsCss,
  type BrandSplash as BrandSplashConfig,
} from "@/lib/storefront/brand-splash";

export function BrandSplash({
  splash,
  storeName,
  brandingLogoUrl,
}: {
  splash: BrandSplashConfig;
  storeName: string;
  brandingLogoUrl?: string | null;
}) {
  // Starts visible so the server-rendered HTML paints the splash immediately —
  // the whole point is to cover the pre-hydration frame.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDismissed(true), splash.minDurationMs);
    return () => clearTimeout(timer);
  }, [splash.minDurationMs]);

  const logo = splashLogoUrl(splash, brandingLogoUrl);

  return (
    <div
      className={`sf-splash sf-splash--${splash.design}${dismissed ? " is-dismissed" : ""}`}
      style={{
        ...splashVarsCss(splash),
        // The CSS backstop's own timings. Kept as vars rather than baked into
        // the stylesheet so the operator's ceiling is what actually runs.
        "--splash-hold": `${splash.maxDurationMs}ms`,
      } as React.CSSProperties}
      role="status"
      aria-label={`Loading ${storeName}`}
      // Once lifted the overlay is decorative; leaving it in the a11y tree
      // would keep announcing a load that has already finished.
      aria-hidden={dismissed || undefined}
    >
      <div className="sf-splash__inner">
        <span className="sf-splash__mark">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(logo, { width: LOGO_WIDTH })}
              alt=""
              className="sf-splash__logo"
              decoding="async"
            />
          ) : (
            <Monogram name={storeName} className="sf-splash__monogram" />
          )}
        </span>

        {/* The moving part. Each design animates a different element, so the
            markup carries all of them and the stylesheet shows the one that
            belongs to the chosen design. */}
        <span className="sf-splash__ring" aria-hidden />
        <span className="sf-splash__bar" aria-hidden>
          <span className="sf-splash__bar-fill" />
        </span>

        {splash.showTagline && splash.tagline ? (
          <p className="sf-splash__tagline">{splash.tagline}</p>
        ) : null}
      </div>
    </div>
  );
}
