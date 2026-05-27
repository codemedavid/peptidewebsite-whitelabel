"use client";

import type { Brand, CoaReport } from "../types";
import { useStore } from "../store";
import { BackLink } from "../components/BackLink";

function CoaBadgeIcon({ name }: { name: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "check")
    return (
      <svg {...props} style={{ color: "#22B07D" }}>
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  if (name === "award")
    return (
      <svg {...props} style={{ color: "var(--brand-accent)" }}>
        <circle cx="12" cy="8" r="7" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
      </svg>
    );
  if (name === "shield")
    return (
      <svg {...props} style={{ color: "var(--brand-main)" }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function CoaCard({ report }: { report: CoaReport }) {
  const hasImage = !!report.image;
  const hasLink = !!report.link;
  const href = report.link || (hasImage ? report.image : null);
  const dateLabel = report.date
    ? new Date(report.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

  const content = (
    <>
      <div className="coa-card__thumb">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={report.image} alt={`${report.name} certificate`} />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        )}
        {report.purity && <span className="coa-card__purity">{report.purity}</span>}
      </div>
      <div className="coa-card__body">
        <div className="coa-card__name">{report.name}</div>
        <div className="coa-card__lab">{report.lab || "Lab Report"}</div>
        {dateLabel && <div className="coa-card__date">{dateLabel}</div>}
        {(hasImage || hasLink) && (
          <span className="coa-card__cta">
            {hasLink ? "View Report" : "View Certificate"}
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </span>
        )}
      </div>
    </>
  );

  return href ? (
    <a className="coa-card" href={href} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  ) : (
    <div className="coa-card coa-card--inert">{content}</div>
  );
}

export function COAPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const { coaReports: reports } = useStore();
  const partners = brand.coaPartners || [];

  return (
    <section className="page" id="coa">
      <div className="page__container">
        <BackLink onClick={onBack} label={brand.coaBackLabel || "Back to Shop"} />

        <div className="coa__hero">
          <div className="coa__shield-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {brand.coaVerifiedLabel || "Lab Verified"}
          </div>
          <h1 className="coa__title">
            {brand.coaTitle || "Lab Reports"}
            <svg width={40} height={40} viewBox="0 0 24 24" fill="currentColor" style={{ color: "#FFC857" }}>
              <path d="M12 2l1.5 5L19 8l-4 4 1 6-4-3-4 3 1-6-4-4 5.5-1z" />
            </svg>
          </h1>
          {partners.length > 0 && (
            <p className="coa__tested">
              Tested by <span className="coa__partners">{partners.map((p) => p.label).join(" + ")}</span>
            </p>
          )}
          <div className="coa__badges">
            {(brand.coaBadges || []).map((b, i) => (
              <span key={i} className="coa__badge">
                <CoaBadgeIcon name={b.icon} />
                {b.label}
              </span>
            ))}
          </div>
        </div>

        {reports.length === 0 ? (
          <div className="coa__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p style={{ fontSize: 18 }}>{brand.coaEmptyMsg || "No lab reports available yet."}</p>
          </div>
        ) : (
          <div className="coa__grid">
            {reports.map((r, i) => (
              <CoaCard key={r.id || i} report={r} />
            ))}
          </div>
        )}

        <div className="coa__info">
          <div className="coa__info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h3>{brand.coaInfoTitle || "Independent Laboratory Verification"}</h3>
            <p>{brand.coaInfoBody}</p>
            {partners.length > 0 && (
              <p style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {partners.map((p, i) => (
                  <a key={i} href={p.href || "#"} target="_blank" rel="noopener">
                    {p.label}{" "}
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline" }}>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                ))}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
