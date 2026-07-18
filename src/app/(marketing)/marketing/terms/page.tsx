import type { Metadata } from "next";
import { TERMS_INTRO, TERMS_META, TERMS_SECTIONS, type TermsBlock } from "@/marketing/terms";

// Host-dependent (the layout guards on x-tenant-host), so never statically cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The simple, friendly rules for working together with Pepweb.",
};

function Block({ block }: { block: TermsBlock }) {
  if (block.type === "p") {
    return <p className="mk-muted" style={{ margin: "0 0 14px", lineHeight: 1.7 }}>{block.text}</p>;
  }
  if (block.type === "ul") {
    return (
      <ul className="mk-muted" style={{ margin: "0 0 14px", paddingLeft: 22, lineHeight: 1.7 }}>
        {block.items.map((item, i) => (
          <li key={i} style={{ marginBottom: 6 }}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div
      className="mk-card"
      style={{ background: "var(--rose-50)", borderColor: "var(--rose-200)", margin: "4px 0 14px" }}
    >
      <p style={{ margin: 0, lineHeight: 1.7 }}>{block.text}</p>
    </div>
  );
}

export default function TermsPage() {
  return (
    <section className="mk-section mk-section--tight">
      <div className="mk-container" style={{ maxWidth: 820 }}>
        <p className="mk-eyebrow">{TERMS_META.businessName}</p>
        <h1 className="mk-h1" style={{ marginBottom: 8 }}>Terms &amp; Conditions</h1>
        <p className="mk-lead" style={{ marginBottom: 16 }}>
          The simple, friendly rules for working together.
        </p>
        <p className="mk-muted" style={{ fontSize: 14, marginBottom: 28 }}>
          Effective Date: {TERMS_META.effectiveDate} &nbsp;·&nbsp; Last Updated: {TERMS_META.lastUpdated}
        </p>

        <p className="mk-muted" style={{ lineHeight: 1.7, marginBottom: 36 }}>{TERMS_INTRO}</p>

        {TERMS_SECTIONS.map((s) => (
          <div key={s.n} style={{ marginBottom: 30 }}>
            <h2 className="mk-h3" style={{ marginBottom: 12 }}>
              {s.n}. {s.title}
            </h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </div>
        ))}

        <div style={{ marginBottom: 8 }}>
          <h2 className="mk-h3" style={{ marginBottom: 12 }}>24. Contact Us</h2>
          <p className="mk-muted" style={{ margin: "0 0 14px", lineHeight: 1.7 }}>
            Questions about these Terms? We’re happy to help.
          </p>
          <p className="mk-muted" style={{ margin: 0, lineHeight: 1.8 }}>
            {TERMS_META.businessName}
            <br />
            {TERMS_META.operator}
            <br />
            Email:{" "}
            <a className="mk-link" href={`mailto:${TERMS_META.contactEmail}`}>
              {TERMS_META.contactEmail}
            </a>
          </p>
        </div>

        <p className="mk-muted" style={{ marginTop: 36, fontStyle: "italic" }}>
          Thank you for choosing us to build and support your store.
        </p>
      </div>
    </section>
  );
}
