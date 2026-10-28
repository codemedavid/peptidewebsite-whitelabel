// Owner-written text with its web addresses rendered as links (lib/storefront/
// linkify.ts). React nodes only — never innerHTML — and every link opens in a
// new tab, since it leaves the store.

import { linkifySegments } from "@/lib/storefront/linkify";

type Props = { text: string; linkClassName?: string };

export function LinkifiedText({ text, linkClassName }: Props) {
  return (
    <>
      {linkifySegments(text).map((s, i) =>
        s.kind === "link" ? (
          <a key={i} className={linkClassName} href={s.href} target="_blank" rel="noopener noreferrer">
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
