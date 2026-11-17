import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { setupKeys, success } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import { confirmDelete, EditorSheet, Hint, ItemCard, ListPage, Loadable } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

/**
 * The website's Articles manager (AdminArticles.tsx → listArticlesAdminAction /
 * saveArticleAction / deleteArticleAction): guides and explainers that appear on
 * the store's Articles page once published. The server checks the blog grant,
 * normalizes the post and de-duplicates its link.
 */

type ArticleStatus = "draft" | "published";
type Article = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string;
  publishedAt: string | null;
  readMinutes: number;
  status: ArticleStatus;
  body: string;
};
type Draft = { id: string | null; title: string; slug: string; excerpt: string; coverUrl: string; body: string; status: ArticleStatus };
type Fail = { error: string };

// src/lib/storefront/articles.ts ARTICLE_LIMITS + slugifyArticle (copied — the server re-checks).
const LIMITS = { title: 160, slug: 80, excerpt: 400, body: 30_000 } as const;
function slugify(raw: string): string {
  const slug = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, "");
  return slug || "article";
}

const BLANK: Draft = { id: null, title: "", slug: "", excerpt: "", coverUrl: "", body: "", status: "draft" };
const toDraft = (a: Article): Draft => ({ id: a.id, title: a.title, slug: a.slug, excerpt: a.excerpt, coverUrl: a.coverUrl, body: a.body, status: a.status });

function shortDate(iso: string | null): string {
  if (!iso) return "Not published";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function useArticlesKey() {
  const { scope } = useSignedIn();
  return [...setupKeys.all(scope), "articles"] as const;
}

export default function ArticlesScreen() {
  const qc = useQueryClient();
  const key = useArticlesKey();
  const articles = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await adminBridge.call<{ ok: true; articles: Article[] } | Fail>("listArticlesAdminAction")).articles,
  });
  const [editing, setEditing] = useState<Draft | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await adminBridge.call<{ ok: true } | Fail>("deleteArticleAction", id)),
    onSuccess: () => {
      success();
      refresh();
    },
    onError: (e: Error) => Alert.alert("Couldn't delete", e.message),
  });

  return (
    <>
      <Stack.Screen options={{ title: "Articles" }} />
      <Loadable query={articles}>
        {(rows) => {
          const published = rows.filter((a) => a.status === "published").length;
          return (
            <ListPage
              intro="Guides and explainers for your customers. Published articles appear on your store's Articles page (it shows up in the menu once one is published). Drafts are only visible here."
              addLabel="Write an article"
              onAdd={() => setEditing(BLANK)}
              isEmpty={rows.length === 0}
              empty={{ icon: "document-text-outline", title: "No articles yet. Write your first guide, e.g. how to reconstitute a vial.", action: "Write an article" }}
              refreshing={articles.isRefetching}
              onRefresh={() => void articles.refetch()}
              toolbar={
                rows.length ? (
                  <AppText variant="caption" color="muted">
                    {`${rows.length} article${rows.length === 1 ? "" : "s"} · ${published} published`}
                  </AppText>
                ) : null
              }
            >
              {rows.map((a) => (
                <ItemCard
                  key={a.id}
                  title={a.title}
                  lines={[`${shortDate(a.publishedAt)} · ${a.readMinutes} min read`]}
                  badges={<Pill size="sm" tone={a.status === "published" ? "success" : "neutral"} label={a.status === "published" ? "Published" : "Draft"} />}
                  leading={a.coverUrl ? <Thumb uri={a.coverUrl} /> : undefined}
                  disabled={remove.isPending}
                  onEdit={() => setEditing(toDraft(a))}
                  onDelete={() => confirmDelete(`Delete "${a.title}"? This can't be undone.`, () => remove.mutate(a.id))}
                />
              ))}
            </ListPage>
          );
        }}
      </Loadable>
      {editing ? (
        <ArticleEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function Thumb({ uri }: { uri: string }) {
  const t = useTheme();
  return <Image source={{ uri }} style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt }]} contentFit="cover" />;
}

function ArticleEditor({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  // A new post's link follows its title until the owner edits the link by hand.
  const [slugTouched, setSlugTouched] = useState(initial.id !== null);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: async (status: ArticleStatus) =>
      unwrap(await adminBridge.call<{ ok: true; article: Article } | Fail>("saveArticleAction", d.id, { ...d, slug: slugify(d.slug || d.title), status })),
    onSuccess: () => {
      success();
      onSaved();
    },
    onError: (e: Error) => Alert.alert("Couldn't save", e.message),
  });

  const isPublished = initial.status === "published";
  return (
    <EditorSheet
      visible
      title={initial.id ? "Edit article" : "New article"}
      saveLabel={isPublished ? "Update" : "Publish"}
      canSave={!!d.title.trim() && !!d.body.trim()}
      dirty={dirty}
      saving={save.isPending && save.variables === "published"}
      onCancel={onClose}
      onSave={() => save.mutate("published")}
    >
      <Field
        label="Title"
        value={d.title}
        maxLength={LIMITS.title}
        placeholder="What is NAD+ and how does it work?"
        onChangeText={(title) => set(slugTouched ? { title } : { title, slug: slugify(title) })}
      />
      <Field
        label="Link"
        value={d.slug}
        maxLength={LIMITS.slug}
        autoCapitalize="none"
        onChangeText={(slug) => {
          setSlugTouched(true);
          set({ slug });
        }}
        onBlur={() => set({ slug: slugify(d.slug || d.title) })}
        hint={`Your store link ends in #articles/${d.slug || "…"}`}
      />
      <ImageField
        kind="storefront"
        label="Cover image"
        hint="Optional. Shown on the article card and at the top of the post."
        value={d.coverUrl}
        previewAspect={16 / 9}
        onChange={(coverUrl) => set({ coverUrl })}
      />
      <Field
        label="Summary"
        value={d.excerpt}
        maxLength={LIMITS.excerpt}
        multiline
        placeholder="Shown on the article card. Leave blank to use the opening lines."
        onChangeText={(excerpt) => set({ excerpt })}
      />
      <Field
        label="Article"
        value={d.body}
        maxLength={LIMITS.body}
        multiline
        placeholder={"Start writing…\n\n## A heading\n- a bullet point"}
        onChangeText={(body) => set({ body })}
      />
      <Hint>{"Blank line = new paragraph · ## Heading · ### Sub-heading · - bullet · 1. numbered · > quote · **bold** · *italic* · [link text](https://…)"}</Hint>
      <View style={{ gap: 8 }}>
        <Button
          label={isPublished ? "Unpublish (save as draft)" : "Save as draft"}
          icon="document-outline"
          variant="secondary"
          loading={save.isPending && save.variables === "draft"}
          disabled={!d.title.trim() || save.isPending}
          onPress={() => save.mutate("draft")}
        />
        <Hint>{isPublished ? "A draft disappears from your store until you publish it again." : "Drafts are only visible here."}</Hint>
      </View>
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 56, height: 56, borderRadius: RADIUS.md },
});
