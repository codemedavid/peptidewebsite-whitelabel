import type { TermsBlock } from "@/marketing/terms";

/** One paragraph, list, or callout of a policy page (Terms, Privacy). */
export function PolicyBlock({ block }: { block: TermsBlock }) {
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
