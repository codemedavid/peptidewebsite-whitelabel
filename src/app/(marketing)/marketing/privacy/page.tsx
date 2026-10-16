import type { Metadata } from "next";
import { PolicyBlock } from "@/marketing/PolicyBlock";
import { PRIVACY_INTRO, PRIVACY_META, PRIVACY_SECTIONS } from "@/marketing/privacy";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Pepweb and the PepWorld app collect, use, and protect your information.",
  openGraph: { title: "Privacy Policy · Pepweb", description: "How Pepweb and the PepWorld app collect, use, and protect your information." },
  twitter: { title: "Privacy Policy · Pepweb", description: "How Pepweb and the PepWorld app collect, use, and protect your information." },
};

export default function PrivacyPage() {
  const contactSection = PRIVACY_SECTIONS.length + 1;
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-container" style={{ maxWidth: 820 }}>
        <p className="mk-eyebrow">
          {PRIVACY_META.businessName} · {PRIVACY_META.appName}
        </p>
        <h1 className="mk-h1" style={{ marginBottom: 8 }}>Privacy Policy</h1>
        <p className="mk-lead" style={{ marginBottom: 16 }}>
          What we collect, why, and how you stay in control.
        </p>
        <p className="mk-muted" style={{ fontSize: 14, marginBottom: 28 }}>
          Effective Date: {PRIVACY_META.effectiveDate} &nbsp;·&nbsp; Last Updated: {PRIVACY_META.lastUpdated}
        </p>

        <p className="mk-muted" style={{ lineHeight: 1.7, marginBottom: 36 }}>{PRIVACY_INTRO}</p>

        {PRIVACY_SECTIONS.map((s) => (
          <div key={s.n} id={`section-${s.n}`} style={{ marginBottom: 30 }}>
            <h2 className="mk-h3" style={{ marginBottom: 12 }}>
              {s.n}. {s.title}
            </h2>
            {s.blocks.map((b, i) => (
              <PolicyBlock key={i} block={b} />
            ))}
          </div>
        ))}

        <div id="contact" style={{ marginBottom: 8 }}>
          <h2 className="mk-h3" style={{ marginBottom: 12 }}>{contactSection}. Contact Us</h2>
          <p className="mk-muted" style={{ margin: "0 0 14px", lineHeight: 1.7 }}>
            Questions, requests, or concerns about your privacy? Email us and we’ll reply within 7 days.
          </p>
          <p className="mk-muted" style={{ margin: 0, lineHeight: 1.8 }}>
            {PRIVACY_META.businessName}
            <br />
            {PRIVACY_META.operator}
            <br />
            Email:{" "}
            <a className="mk-link" href={`mailto:${PRIVACY_META.contactEmail}`}>
              {PRIVACY_META.contactEmail}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
