"use client";

// Live preview of the owner's UNSAVED draft. It renders the real storefront
// components — header, home sections, footer — inside its own
// `.sf-root[data-sf-home="intl-local"]` frame with the draft theme, so it is
// the site, not a mock of it. Because the layout's breakpoints are container
// queries, the phone frame shows the true phone layout even on a wide screen.
//
// Links resolve exactly as they would live (a hidden link is hidden here too)
// but navigate nowhere, and the newsletter form says it's a preview.

import { useEffect, useRef, useState } from "react";
import type { Brand, Category } from "../../types";
import type { IntlLocalConfig } from "@/lib/storefront/intl-local/config";
import { IlNavProvider } from "../../components/intl-local/il-nav";
import { IntlLocalStyle } from "../../components/intl-local/il-style";
import { IntlLocalHeader } from "../../components/intl-local/IntlLocalHeader";
import { IlHomeSections } from "../../components/intl-local/IntlLocalHome";
import { IntlLocalFooter } from "../../components/intl-local/IntlLocalFooter";

const FRAME_WIDTH = { desktop: 1200, phone: 390 } as const;
type Device = keyof typeof FRAME_WIDTH;

const previewSubscribe = async () => ({ error: "Preview only — sign-ups work on your live site." });

export function SitePreview({ brand, categories, config }: { brand: Brand; categories: Category[]; config: IntlLocalConfig }) {
  const [device, setDevice] = useState<Device>("desktop");
  const hostRef = useRef<HTMLDivElement>(null);
  const siteRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(600);
  const [offset, setOffset] = useState(0);
  const width = FRAME_WIDTH[device];

  // Fit the fixed-width frame to the column, and keep the column as tall as
  // the scaled site so the preview scrolls with the page, not inside itself.
  useEffect(() => {
    const host = hostRef.current;
    const site = siteRef.current;
    if (!host || !site) return;
    const measure = () => {
      const s = Math.min(1, host.clientWidth / width);
      setScale(s);
      setHeight(site.scrollHeight * s);
      // A phone frame narrower than the column sits centred, like a device.
      setOffset(Math.max(0, (host.clientWidth - width * s) / 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(site);
    return () => ro.disconnect();
  }, [width]);

  return (
    <section className="sb-preview" aria-label="Live preview">
      <div className="sb-preview__bar">
        <span className="sb-preview__live">
          <span aria-hidden="true" /> Live preview
        </span>
        <div className="sb-seg" role="radiogroup" aria-label="Preview size">
          {(Object.keys(FRAME_WIDTH) as Device[]).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={device === d} className={device === d ? "is-active" : ""} onClick={() => setDevice(d)}>
              {d === "desktop" ? "Desktop" : "Phone"}
            </button>
          ))}
        </div>
      </div>
      <div ref={hostRef} className="sb-preview__host" style={{ height }}>
        <div
          ref={siteRef}
          className="sf-root sb-preview__site"
          data-sf-home="intl-local"
          style={{ width, left: offset, transform: `scale(${scale})` }}
          // A picture of the site: keyboard focus stays in the form.
          inert
        >
          <IlNavProvider brand={brand} categories={categories} infoPages={config.infoPages}>
            <IntlLocalStyle theme={config.theme} scope=".sb-preview__site" />
            <IntlLocalHeader
              config={config}
              storeName={brand.name}
              storeLogoUrl={brand.logoUrl}
              logoCurve={brand.logoCurve}
              socials={[]}
              cartCount={0}
              onCart={() => {}}
              onHome={() => {}}
              onSearch={() => {}}
            />
            <main className="il-main il-main--home il-wrap">
              <IlHomeSections config={config} onSubscribe={previewSubscribe} />
            </main>
            <IntlLocalFooter footer={config.footer} storeName={brand.name} socials={[]} />
          </IlNavProvider>
        </div>
      </div>
      <p className="sb-preview__note">Links and the sign-up form are disabled in the preview.</p>
    </section>
  );
}
