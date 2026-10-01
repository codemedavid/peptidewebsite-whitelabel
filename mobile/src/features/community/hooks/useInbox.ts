import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "../lib/access";

/** The inbox refreshes on its own every 15 s while the app is in front. */
export const INBOX_POLL_MS = 15_000;

export function useCommunityAccess() {
  const { me } = useSignedIn();
  return useMemo(() => communityAccess(me), [me]);
}

export function useInbox() {
  const { scope } = useSignedIn();
  const access = useCommunityAccess();
  return useQuery({
    queryKey: qk.communityInbox(scope),
    queryFn: communityApi.inbox,
    enabled: access.inCommunity,
    refetchInterval: INBOX_POLL_MS,
    staleTime: 5_000,
  });
}

/** The Chats tab badge. */
export function useUnreadChats(): number {
  return useInbox().data?.unreadChats ?? 0;
}

export function useChannelDetail(id: string | undefined) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: qk.communityChannel(scope, id ?? ""),
    queryFn: () => communityApi.channel(id ?? ""),
    enabled: !!id,
    refetchInterval: INBOX_POLL_MS,
  });
}

/** Re-read the inbox and channel lists (not open threads — those keep their pages). */
export function useRefreshLists() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.communityInbox(scope) }),
      qc.invalidateQueries({ queryKey: [...qk.community(scope), "channel"] }),
      qc.invalidateQueries({ queryKey: qk.communityDrops(scope) }),
    ]);
  }, [qc, scope]);
}
