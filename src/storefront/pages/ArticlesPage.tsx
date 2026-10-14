"use client";

// Storefront Articles: the list (#articles) and one post (#articles/<slug>).
// The list renders from brand.articles (published SUMMARIES, server-projected);
// a post's body is fetched when it is opened, then rendered from structured
// blocks — never HTML — so owner-written copy can't inject markup.

import { useEffect, useState } from "react";
import "../content-pages.css";
import type { Brand } from "../types";
import { BackLink } from "../components/BackLink";
import { ArticleBody } from "../components/ArticleBody";
import { imageUrl } from "@/lib/media/image-url";
import { getPublishedArticleAction } from "@/actions/articles";
import {
  articleHash,
  articleSlugFromHash,
  type Article,
  type ArticleSummary,
} from "@/lib/storefront/articles";

const CARD_IMAGE_WIDTH = 720;
const COVER_IMAGE_WIDTH = 1400;

function useArticleSlug(): string | null {
  const [slug, setSlug] = useState<string | null>(() =>
    typeof window === "undefined" ? null : articleSlugFromHash(window.location.hash),
  );
  useEffect(() => {
    const onHash = () => setSlug(articleSlugFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return slug;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function Meta({ a }: { a: ArticleSummary }) {
  const date = formatDate(a.publishedAt);
  return (
    <div className="art-meta">
      {date && <time dateTime={a.publishedAt ?? undefined}>{date}</time>}
      <span>{a.readMinutes} min read</span>
    </div>
  );
}

function Media({ a, width, className }: { a: ArticleSummary; width: number; className: string }) {
  return (
    <div className={`art-media ${className}`}>
      {a.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl(a.coverUrl, { width })} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="art-media__mark" aria-hidden>
          {a.title.charAt(0)}
        </span>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function ArticleList({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const articles = brand.articles ?? [];
  const [lead, ...rest] = articles;
  return (
    <>
      <BackLink onClick={onBack} label="Back to Shop" />
      <header className="cp-head">
        <span className="cp-eyebrow">Journal</span>
        <h1 className="cp-title">{brand.articlesTitle || "Articles"}</h1>
        <p className="cp-lede">
          {brand.articlesIntro || "Guides, explainers and notes from our team — read before you research."}
        </p>
      </header>

      {!lead ? (
        <div className="cp-empty">No articles yet — check back soon.</div>
      ) : (
        <>
          <a className="art-feature" href={articleHash(lead.slug)}>
            <Media a={lead} width={COVER_IMAGE_WIDTH} className="art-feature__media" />
            <div className="art-feature__body">
              <Meta a={lead} />
              <h2 className="art-feature__title">{lead.title}</h2>
              {lead.excerpt && <p className="art-excerpt">{lead.excerpt}</p>}
              <span className="art-more">
                Read article <Arrow />
              </span>
            </div>
          </a>
          {rest.length > 0 && (
            <div className="art-grid">
              {rest.map((a) => (
                <a key={a.slug} className="art-card" href={articleHash(a.slug)}>
                  <Media a={a} width={CARD_IMAGE_WIDTH} className="art-card__media" />
                  <div className="art-card__body">
                    <Meta a={a} />
                    <h2 className="art-card__title">{a.title}</h2>
                    {a.excerpt && <p className="art-excerpt">{a.excerpt}</p>}
                    <span className="art-more">
                      Read <Arrow />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ArticlePost({ slug, brand }: { slug: string; brand: Brand }) {
  const summary = brand.articles?.find((a) => a.slug === slug) ?? null;
  const [state, setState] = useState<{ slug: string; article: Article | null; error: string }>({
    slug: "",
    article: null,
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    getPublishedArticleAction(slug)
      .then((res) => {
        if (cancelled) return;
        setState("error" in res ? { slug, article: null, error: res.error } : { slug, article: res.article, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ slug, article: null, error: "We couldn't load this article. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const loading = state.slug !== slug;
  const head = state.article ?? summary;

  return (
    <article className="art-post">
      <BackLink onClick={() => (window.location.hash = "articles")} label="All articles" />
      {head ? (
        <>
          <Meta a={head} />
          <h1 className="art-post__title">{head.title}</h1>
          {head.coverUrl && (
            <div className="art-post__cover art-media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(head.coverUrl, { width: COVER_IMAGE_WIDTH })} alt="" decoding="async" />
            </div>
          )}
        </>
      ) : null}

      {loading ? (
        <div aria-busy="true" aria-label="Loading article" style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {[92, 100, 84, 96, 60].map((w, i) => (
            <div key={i} className="cp-skeleton" style={{ height: 16, width: `${w}%` }} />
          ))}
        </div>
      ) : state.article ? (
        <ArticleBody text={state.article.body} />
      ) : (
        <div className="cp-empty" role="alert">{state.error || "This article isn't available."}</div>
      )}

      <div className="art-post__end">
        <p>Ready to put this into practice?</p>
        <a className="btn btn-primary" href="#catalog">
          Shop {brand.name}
        </a>
      </div>
    </article>
  );
}

export function ArticlesPage({ brand, onBack }: { brand: Brand; onBack: () => void }) {
  const slug = useArticleSlug();
  return (
    <section className="page" id="articles">
      <div className="page__container">
        {slug ? <ArticlePost key={slug} slug={slug} brand={brand} /> : <ArticleList brand={brand} onBack={onBack} />}
      </div>
    </section>
  );
}
