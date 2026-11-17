import { useCallback } from "react";
import { AccessibilityInfo, Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelDetailResponse, InboxResponse } from "@contract";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import type { ThreadState } from "../lib/messages";

type Vars = { channelId: string; muted: boolean };
type Snapshot = Array<[readonly unknown[], unknown]>;

/** Every cached place a channel's mute shows: the inbox row, the channel screen, its open topic chats. */
function applyMute(prev: unknown, key: readonly unknown[], { channelId, muted }: Vars): unknown {
  if (!prev || typeof prev !== "object") return prev;
  const kind = key[2];
  if (kind === "inbox") {
    const inbox = prev as InboxResponse;
    return { ...inbox, channels: inbox.channels.map((c) => (c.id === channelId && c.muted !== undefined ? { ...c, muted } : c)) };
  }
  if (kind === "channel" && key[3] === channelId) {
    const detail = prev as ChannelDetailResponse;
    return { ...detail, channel: { ...detail.channel, muted } };
  }
  if (kind === "thread") {
    const state = prev as ThreadState;
    return state.thread.channelId === channelId && state.thread.channelMuted !== undefined
      ? { ...state, thread: { ...state.thread, channelMuted: muted } }
      : prev;
  }
  return prev;
}

/**
 * Mute / unmute a channel's chat notifications for ME (members, and each
 * store-team member personally). Optimistic: the bell flips at once and rolls
 * back if the server says no. Drops and group buys still notify.
 */
export function useChannelMute() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const root = qk.community(scope);

  const m = useMutation({
    mutationFn: ({ channelId, muted }: Vars) => communityApi.muteChannel(channelId, { muted }),
    onMutate: async (vars): Promise<Snapshot> => {
      await qc.cancelQueries({ queryKey: root });
      const before = qc.getQueriesData({ queryKey: root }) as Snapshot;
      for (const [key, data] of before) qc.setQueryData(key, applyMute(data, key, vars));
      return before;
    },
    onError: (e, _vars, before) => {
      for (const [key, data] of before ?? []) qc.setQueryData(key, data);
      Alert.alert("Couldn't change notifications", e.message);
    },
    onSuccess: (_res, { muted }) => {
      AccessibilityInfo.announceForAccessibility(muted ? "Notifications muted for this channel" : "Notifications on for this channel");
    },
  });

  const toggle = useCallback((channelId: string, muted: boolean) => m.mutate({ channelId, muted }), [m]);
  return { toggle, pending: m.isPending, error: m.error };
}
