"use client";

// Renders an article body from structured blocks (lib/storefront/articles.ts)
// — never as HTML. Shared by the storefront Articles page and the store-admin
// editor's live preview so the two can't drift.

import { parseArticleBody, type ArticleBlock, type ArticleSpan } from "@/lib/storefront/articles";

function Spans({ spans }: { spans: ArticleSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: React.ReactNode = s.text;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong>{node}</strong>;
        if (s.href) {
          node = (
            <a href={s.href} target="_blank" rel="noopener noreferrer nofollow">
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function Block({ b }: { b: ArticleBlock }) {
  switch (b.kind) {
    case "h2":
      return <h2><Spans spans={b.spans} /></h2>;
    case "h3":
      return <h3><Spans spans={b.spans} /></h3>;
    case "quote":
      return <blockquote><Spans spans={b.spans} /></blockquote>;
    case "ul":
    case "ol": {
      const List = b.kind;
      return (
        <List>
          {b.items.map((item, i) => (
            <li key={i}><Spans spans={item} /></li>
          ))}
        </List>
      );
    }
    default:
      return <p><Spans spans={b.spans} /></p>;
  }
}

export function ArticleBody({ text }: { text: string }) {
  return (
    <div className="art-prose">
      {parseArticleBody(text).map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}
