"use client";

// Store-admin "Articles": write, publish and remove the store's blog posts
// (the storefront #articles page). Drafts stay private; publishing stamps the
// date once. The editor previews the body exactly as the storefront renders it
// (shared <ArticleBody>), inside .sf-root so the store's theme applies.
// Staff need the "articles" permission; the server re-checks it.

import { useEffect, useState } from "react";
import "../content-pages.css";
import type { Brand } from "../types";
import { useStore } from "../store";
import { ArticleBody } from "../components/ArticleBody";
import { uploadStorefrontImageAction } from "@/actions/media";
import { deleteArticleAction, listArticlesAdminAction, saveArticleAction } from "@/actions/articles";
import { ARTICLE_LIMITS, slugifyArticle, type Article, type ArticleStatus } from "@/lib/storefront/articles";

type Draft = {
  id: string | null;
  title: string;
  slug: string;
  excerpt: string;
  coverUrl: string;
  body: string;
  status: ArticleStatus;
};

const BLANK: Draft = { id: null, title: "", slug: "", excerpt: "", coverUrl: "", body: "", status: "draft" };

const toDraft = (a: Article): Draft => ({
  id: a.id,
  title: a.title,
  slug: a.slug,
  excerpt: a.excerpt,
  coverUrl: a.coverUrl,
  body: a.body,
  status: a.status,
});

function shortDate(iso: string | null): string {
  if (!iso) return "Not published";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Bar({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <header className="admin-form__bar">
      <button className="admin-form__back" onClick={onBack}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>
      <h1 className="admin-form__title">{title}</h1>
      <div className="admin-form__bar-spacer" />
      {children}
    </header>
  );
}

function Editor({
  initial,
  onDone,
  onCancel,
}: {
  initial: Draft;
  onDone: (saved: Article) => void;
  onCancel: () => void;
}) {
  const { toast } = useStore();
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [slugTouched, setSlugTouched] = useState(!!initial.id);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));

  const onTitle = (title: string) => set(slugTouched ? { title } : { title, slug: slugifyArticle(title) });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "storefront");
      const res = await uploadStorefrontImageAction(fd);
      if ("url" in res) set({ coverUrl: res.url });
      else toast(res.error);
    } catch {
      toast("Image upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  };

  const save = async (status: ArticleStatus) => {
    if (!d.title.trim()) return toast("Give the article a title first.");
    setSaving(true);
    try {
      const res = await saveArticleAction(d.id, { ...d, status });
      if ("error" in res) return toast(res.error);
      toast(status === "published" ? "Article published" : "Draft saved");
      onDone(res.article);
    } catch {
      toast("Couldn't save the article.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin">
      <Bar title={d.id ? "Edit article" : "New article"} onBack={onCancel}>
        <button className="admin-btn admin-btn--ghost" onClick={() => void save("draft")} disabled={saving}>
          Save draft
        </button>
        <button className="admin-form__save" onClick={() => void save("published")} disabled={saving}>
          {saving ? "Saving…" : d.status === "published" ? "Update" : "Publish"}
        </button>
      </Bar>

      <div className="admin-form__body">
        <div className="art-admin__editor">
          <div className="admin-form__card">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="art-title">Title</label>
              <input id="art-title" className="admin-input" value={d.title} maxLength={ARTICLE_LIMITS.title}
                onChange={(e) => onTitle(e.target.value)} placeholder="What is NAD+ and how does it work?" />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="art-slug">Link</label>
              <input id="art-slug" className="admin-input" value={d.slug} maxLength={ARTICLE_LIMITS.slug}
                onChange={(e) => { setSlugTouched(true); set({ slug: e.target.value }); }}
                onBlur={() => set({ slug: slugifyArticle(d.slug || d.title) })} />
              <div className="admin-field__hint">Your store link ends in <code>#articles/{d.slug || "…"}</code></div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label">Cover image</label>
              <div className="art-admin__cover-pick">
                {d.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.coverUrl} alt="" />
                )}
                <label className="admin-btn admin-btn--ghost" style={{ cursor: "pointer" }}>
                  {uploading ? "Uploading…" : d.coverUrl ? "Replace" : "Upload image"}
                  <input type="file" accept="image/*" hidden disabled={uploading}
                    onChange={(e) => void upload(e.target.files?.[0])} />
                </label>
                {d.coverUrl && (
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={() => set({ coverUrl: "" })}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="art-excerpt">Summary</label>
              <textarea id="art-excerpt" className="admin-textarea" rows={2} value={d.excerpt} maxLength={ARTICLE_LIMITS.excerpt}
                onChange={(e) => set({ excerpt: e.target.value })} placeholder="Shown on the article card. Leave blank to use the opening lines." />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="art-body">Article</label>
              <textarea id="art-body" className="admin-textarea" rows={16} value={d.body} maxLength={ARTICLE_LIMITS.body}
                onChange={(e) => set({ body: e.target.value })} placeholder={"Start writing…\n\n## A heading\n- a bullet point"} />
              <div className="art-admin__help">
                Blank line = new paragraph · <code>## Heading</code> · <code>### Sub-heading</code> · <code>- bullet</code> ·{" "}
                <code>1. numbered</code> · <code>&gt; quote</code> · <code>**bold**</code> · <code>*italic*</code> ·{" "}
                <code>[link text](https://…)</code>
              </div>
            </div>
          </div>

          <aside className="art-admin__preview" aria-label="Live preview">
            <div className="admin-field__hint" style={{ marginBottom: 12 }}>Live preview — your store&apos;s theme</div>
            <div className="sf-root">
              <h2 className="art-post__title" style={{ fontSize: 26, marginTop: 0 }}>{d.title || "Untitled article"}</h2>
              {d.body.trim() ? <ArticleBody text={d.body} /> : <p className="admin-field__hint">Your article will appear here.</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function AdminArticles({ onBack }: { brand: Brand; onBack: () => void }) {
  const { toast } = useStore();
  const [rows, setRows] = useState<Article[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listArticlesAdminAction()
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          toast(res.error);
          setRows([]);
        } else setRows(res.articles);
      })
      .catch(() => {
        if (!cancelled) {
          toast("Couldn't load articles.");
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Load once on open; `toast` is not a stable reference in the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (a: Article) => {
    if (busyId || !window.confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    setBusyId(a.id);
    try {
      const res = await deleteArticleAction(a.id);
      if ("error" in res) return toast(res.error);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== a.id));
      toast("Article deleted");
    } catch {
      toast("Couldn't delete the article.");
    } finally {
      setBusyId(null);
    }
  };

  if (editing) {
    return (
      <Editor
        initial={editing}
        onCancel={() => setEditing(null)}
        onDone={(saved) => {
          setRows((prev) => [saved, ...(prev ?? []).filter((r) => r.id !== saved.id)]);
          setEditing(null);
        }}
      />
    );
  }

  const published = rows?.filter((r) => r.status === "published").length ?? 0;

  return (
    <div className="admin">
      <Bar title="Articles" onBack={onBack}>
        <button className="admin-form__save" onClick={() => setEditing(BLANK)}>
          + New article
        </button>
      </Bar>

      <div className="admin-form__body">
        <div className="admin__tip" style={{ marginTop: 0, textAlign: "left" }}>
          Guides and explainers for your customers. Published articles appear on your store&apos;s{" "}
          <strong>Articles</strong> page (it shows up in the menu once one is published). Drafts are only visible here.
        </div>

        <div className="admin-form__card">
          {rows === null ? (
            <div className="admin-field__hint">Loading articles…</div>
          ) : rows.length === 0 ? (
            <div className="staff-empty">
              <p className="staff-empty__title">No articles yet</p>
              <p className="admin-field__hint">Write your first guide — for example, how to reconstitute a vial.</p>
              <button className="admin-btn" onClick={() => setEditing(BLANK)} style={{ marginTop: 10 }}>
                Write an article
              </button>
            </div>
          ) : (
            <>
              <div className="cust-summary">
                <span><strong>{rows.length}</strong> article{rows.length === 1 ? "" : "s"}</span>
                <span><strong>{published}</strong> published</span>
              </div>
              <div className="staff-list">
                {rows.map((a) => (
                  <div key={a.id} className="staff-row art-admin__row">
                    {a.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="art-admin__thumb" src={a.coverUrl} alt="" />
                    ) : (
                      <span className="art-admin__thumb" aria-hidden />
                    )}
                    <div className="staff-row__main">
                      <div className="staff-row__name">{a.title}</div>
                      <div className="staff-row__meta">
                        <span className={`art-admin__status art-admin__status--${a.status}`}>{a.status}</span>{" "}
                        {shortDate(a.publishedAt)} · {a.readMinutes} min read
                      </div>
                    </div>
                    <div className="staff-row__actions">
                      <button className="admin-btn admin-btn--ghost" onClick={() => setEditing(toDraft(a))}>Edit</button>
                      <button className="admin-btn admin-btn--danger" onClick={() => void remove(a)} disabled={busyId === a.id}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
