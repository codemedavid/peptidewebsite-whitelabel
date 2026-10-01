import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ThreadType } from "@contract";
import { ApiError } from "@/api/client";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { appendOlder, fromFirstPage, mergePoll, newestConfirmed, type ThreadState } from "../lib/messages";

/** An open thread polls for new messages and edits this often (foreground + focused only). */
export const THREAD_POLL_MS = 3_000;
/** How many older pages a search jump may pull in to reach a hit. */
const MAX_JUMP_PAGES = 10;

const GONE = new Set(["not_found", "forbidden"]);

export function useThreadKey(type: ThreadType, id: string) {
  const { scope } = useSignedIn();
  return qk.communityThread(scope, type, id);
}

/**
 * One topic's or DM's messages, newest first. The cache holds every loaded
 * page; polls (`?after=`) and older pages (`?before=`) merge into it, so a
 * refetch never throws away what's on screen.
 */
export function useThread(type: ThreadType, id: string) {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = useThreadKey(type, id);
  const [gone, setGone] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const polling = useRef(false);
  const olderBusy = useRef(false);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => fromFirstPage(await communityApi.messages(type, id)),
    enabled: !!id,
    staleTime: Infinity,
    // A deleted thread or lost access won't come back by retrying.
    retry: (count, e) => !(e instanceof ApiError && GONE.has(e.code)) && count < 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const read = useCallback(() => qc.getQueryData<ThreadState>(key), [qc, key]);
  const write = useCallback(
    (fn: (s: ThreadState) => ThreadState) => qc.setQueryData<ThreadState>(key, (s) => (s ? fn(s) : s)),
    [qc, key],
  );

  const poll = useCallback(async () => {
    const current = read();
    if (!current || polling.current || gone) return;
    polling.current = true;
    try {
      const res = await communityApi.messages(type, id, { after: current.pollCursor });
      write((s) => mergePoll(s, res));
    } catch (e) {
      // A thread that was deleted or closed to us stops polling; anything
      // else (offline, a slow server) is retried on the next tick.
      if (e instanceof ApiError && GONE.has(e.code)) setGone(e.message);
    } finally {
      polling.current = false;
    }
  }, [read, write, type, id, gone]);

  // Poll every 3 s while this screen is focused AND the app is in front.
  useFocusEffect(
    useCallback(() => {
      let active = AppState.currentState === "active";
      const sub = AppState.addEventListener("change", (s) => {
        active = s === "active";
        if (active) void poll();
      });
      const timer = setInterval(() => {
        if (active) void poll();
      }, THREAD_POLL_MS);
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [poll]),
  );

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const current = read();
    if (!current?.olderCursor || olderBusy.current) return false;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const res = await communityApi.messages(type, id, { before: current.olderCursor });
      write((s) => appendOlder(s, res));
      return true;
    } catch {
      return false; // the list shows its spinner again on the next scroll
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [read, write, type, id]);

  /** Load older pages until `createdAt` is on screen (a search hit far back). Null = ok, else an error. */
  const loadThrough = useCallback(
    async (createdAt: string): Promise<string | null> => {
      for (let i = 0; i < MAX_JUMP_PAGES; i += 1) {
        const s = read();
        if (!s) return null;
        const oldest = s.messages[s.messages.length - 1];
        if (!s.olderCursor || !oldest || Date.parse(oldest.createdAt) <= Date.parse(createdAt)) return null;
        if (!(await loadOlder())) return "That message couldn't be loaded.";
      }
      return "That message is too far back to show here.";
    },
    [read, loadOlder],
  );

  // Everything visible counts as read, including messages that land while open.
  const newest = newestConfirmed(query.data?.messages ?? []);
  const lastMarked = useRef<string | null>(null);
  useEffect(() => {
    if (!newest || lastMarked.current === newest.id) return;
    lastMarked.current = newest.id;
    communityApi
      .markRead(type, id, { at: newest.createdAt })
      .then(() => {
        void qc.invalidateQueries({ queryKey: qk.communityInbox(scope) });
        void qc.invalidateQueries({ queryKey: [...qk.community(scope), "channel"] });
      })
      .catch(() => {
        lastMarked.current = null; // try again with the next message or visit
      });
  }, [newest, type, id, qc, scope]);

  return {
    state: query.data ?? null,
    loading: query.isPending,
    error: gone ?? (query.error ? query.error.message : null),
    reload: query.refetch,
    loadOlder,
    loadingOlder,
    loadThrough,
  };
}

export type ThreadHandle = ReturnType<typeof useThread>;
