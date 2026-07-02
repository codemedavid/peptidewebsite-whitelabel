"use client";

import { useEffect, useState } from "react";
import type { Brand } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";
import { resolveProtocolImages } from "@/lib/storefront/protocol-images";
import {
  PROTOCOL_SORT_OPTIONS,
  normalizeProtocolSort,
  sortProtocolsByName,
  type ProtocolSort,
} from "@/lib/storefront/protocol-sort";

type ViewerImage = { src: string; alt: string };

function ProtocolGallery({
  images,
  name,
  onView,
}: {
  images: string[];
  name: string;
  onView: (image: ViewerImage) => void;
}) {
  return (
    <div className="protocols__gallery">
      {images.map((src, k) => {
        const alt = `${name} protocol ${k + 1}`;
        return (
          <button
            key={k}
            type="button"
            className="protocols__gallery-btn"
            onClick={() => onView({ src, alt })}
            aria-label={`View ${alt} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} className="protocols__gallery-img" />
          </button>
        );
      })}
    </div>
  );
}

function ProtocolImageViewer({ image, onClose }: { image: ViewerImage; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="protocols__viewer"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      onClick={onClose}
    >
      <button
        type="button"
        className="protocols__viewer-close"
        onClick={onClose}
        aria-label="Close full view"
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt}
        className="protocols__viewer-img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function ProtocolsPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { protocols: all } = useStore();
  const cats = Array.from(new Set(all.map((p) => p.category))).filter(Boolean);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<ProtocolSort>("default");
  const [viewer, setViewer] = useState<ViewerImage | null>(null);
  const filtered = cat === "all" ? all : all.filter((p) => p.category === cat);
  const sorted = sortProtocolsByName(filtered, sort);

  return (
    <section className="page" id="protocols">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.protocolsBackLabel || "Back to Home"} />

        <div className="protocols__intro">
          <span className="eyebrow">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {brand.protocolsEyebrow || "Protocol Guide"}
          </span>
          <h1 className="page__title" style={{ marginTop: 24 }}>
            {brand.protocolsTitle || "Protocol Guide"}
          </h1>
          <p className="page__sub" style={{ margin: "16px auto 0" }}>
            {brand.protocolsSub}
          </p>
        </div>

        {brand.protocolsGuidelines && brand.protocolsGuidelines.length > 0 && (
          <div className="protocols__guide-card">
            <div className="protocols__guide-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
              {brand.protocolsGuidelinesTitle || "General Guidelines"}
            </div>
            <ul className="protocols__list">
              {brand.protocolsGuidelines.map((g, i) => (
                <li key={i}>
                  <span>
                    <strong>{g.label}:</strong>
                    {g.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {brand.protocolsStorage && (
          <div className="protocols__guide-card">
            <div className="protocols__guide-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
              </svg>
              {brand.protocolsStorageTitle || "Storage Guidelines"}
            </div>
            <div className="protocols__split">
              {brand.protocolsStorage.map((s, i) => (
                <div key={i} className="protocols__split-card">
                  <h4>{s.title}</h4>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {all.length > 0 && (
          <>
            <div className="protocols__filter">
              <label htmlFor="protocols-cat">Filter by Category</label>
              <select id="protocols-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="all">All Categories</option>
                {cats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label htmlFor="protocols-sort">Sort</label>
              <select
                id="protocols-sort"
                value={sort}
                onChange={(e) => setSort(normalizeProtocolSort(e.target.value))}
              >
                {PROTOCOL_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="protocols__count">
              {sorted.length} protocol{sorted.length === 1 ? "" : "s"} found
            </div>

            {sorted.map((p, i) => {
              // "image" mode → the uploaded image(s) *are* the protocol;
              // otherwise render the typed fields. Legacy rows (no mode) default
              // to details. Images resolve through the shared helper so a legacy
              // single `image` and the new `images[]` both render.
              const images = resolveProtocolImages(p);
              const imageOnly = (p.mode ?? "details") === "image" && images.length > 0;
              return (
              // Key by position in the source list (stable across sort/filter)
              // so each <details>' open state stays with its protocol.
              <details key={all.indexOf(p)} className="protocols__item" open={i === 0}>
                <summary className="protocols__item-head">
                  <div>
                    <div className="eyebrow">{p.category}</div>
                    <h3>{p.name}</h3>
                  </div>
                  <svg className="faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="protocols__item-body">
                  {imageOnly ? (
                    <ProtocolGallery images={images} name={p.name} onView={setViewer} />
                  ) : (
                  <>
                  <div className="protocols__pills">
                    <div className="protocols__pill">
                      <div className="eyebrow">Dosage</div>
                      <strong>{p.dosage}</strong>
                    </div>
                    <div className="protocols__pill">
                      <div className="eyebrow">Frequency</div>
                      <strong>{p.frequency}</strong>
                    </div>
                    <div className="protocols__pill">
                      <div className="eyebrow">Duration</div>
                      <strong>{p.duration}</strong>
                    </div>
                  </div>
                  {p.notes && p.notes.length > 0 && (
                    <>
                      <div className="eyebrow" style={{ marginBottom: 10 }}>
                        Protocol notes
                      </div>
                      <ul className="protocols__list">
                        {p.notes.map((n, j) => (
                          <li key={j}>
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {p.storage && (
                    <div className="protocols__storage">
                      <strong>Storage:</strong> {p.storage}
                    </div>
                  )}
                  {/* Optional supplementary images below the typed fields. */}
                  {images.length > 0 && (
                    <ProtocolGallery images={images} name={p.name} onView={setViewer} />
                  )}
                  </>
                  )}
                </div>
              </details>
              );
            })}
          </>
        )}
      </div>

      {viewer && <ProtocolImageViewer image={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}
