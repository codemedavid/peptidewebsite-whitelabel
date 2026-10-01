import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadType } from "@contract";
import { communityApi, qk, type SearchScope } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { focusIndexFor, hitIdsKey, isSearchable, normalizeQuery, stepMatch, type StepDirection } from "../lib/search";

const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Debounced message search, everywhere or inside one thread. `where` null = off. */
export function useMessageSearch(raw: string, where: SearchScope | null) {
  const { scope } = useSignedIn();
  const query = normalizeQuery(useDebounced(raw, DEBOUNCE_MS));
  const whereKey = where ? (where.scope === "thread" ? `${where.type}:${where.id}` : "everywhere") : "off";
  const enabled = !!where && isSearchable(query);
  const q = useQuery({
    queryKey: qk.communitySearch(scope, query, whereKey),
    queryFn: () => communityApi.search(query, where!),
    enabled,
    staleTime: 15_000,
  });
  return {
    query: enabled ? query : "",
    hits: enabled ? (q.data?.hits ?? []) : [],
    searching: enabled && q.isFetching && !q.data,
    error: enabled && q.error ? q.error.message : null,
  };
}

type InChatOptions = {
  type: ThreadType;
  id: string;
  /** False until the first page is in, so older loads have an anchor. */
  ready: boolean;
  loadThrough: (createdAt: string) => Promise<string | null>;
  /** Arriving from a Chats-tab result: open searching for `query`, on message `focusId`. */
  initial?: { query: string; focusId: string } | null;
};

/** WhatsApp's in-chat search: newest hit focused, ▲ older, ▼ newer. */
export function useInChatSearch({ type, id, ready, loadThrough, initial = null }: InChatOptions) {
  const [open, setOpen] = useState(!!initial);
  const [text, setText] = useState(initial?.query ?? "");
  const [index, setIndex] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(initial?.focusId ?? null);
  const search = useMessageSearch(text, open ? { scope: "thread", type, id } : null);
  const { hits } = search;

  // New results land on the newest hit (or the one tapped in Chats search);
  // a refetch returning the same hits keeps the person's place.
  const ids = hits.map((h) => h.message.id);
  const idsKey = hitIdsKey(ids);
  const [focusedFor, setFocusedFor] = useState(idsKey);
  if (focusedFor !== idsKey) {
    setFocusedFor(idsKey);
    setIndex(focusIndexFor(ids, pendingFocus));
    if (pendingFocus && ids.includes(pendingFocus)) setPendingFocus(null);
  }

  const current = hits[index]?.message ?? null;
  const currentId = current?.id ?? null;
  const currentAt = current?.createdAt ?? null;

  useEffect(() => {
    if (!ready || !currentAt) return;
    let cancelled = false;
    void loadThrough(currentAt).then((err) => !cancelled && setLoadError(err));
    return () => {
      cancelled = true;
    };
  }, [ready, currentId, currentAt, loadThrough]);

  const step = useCallback((d: StepDirection) => setIndex((i) => Math.max(0, stepMatch(i, hits.length, d))), [hits.length]);
  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    setText("");
    setLoadError(null);
    setPendingFocus(null);
  }, []);

  return {
    open,
    start,
    close,
    text,
    setText,
    total: hits.length,
    index,
    focusId: open ? currentId : null,
    highlight: open ? search.query : "",
    searching: search.searching,
    error: search.error ?? loadError,
    step,
  };
}

export type InChatSearch = ReturnType<typeof useInChatSearch>;
