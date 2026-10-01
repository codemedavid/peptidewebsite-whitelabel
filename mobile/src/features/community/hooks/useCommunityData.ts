// Everything besides the inbox and open threads: shared shelves, profiles,
// DMs, drops, member approvals, channel/topic management.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import type {
  ChannelInput,
  DropInput,
  JoinMode,
  MemberStatus,
  ProfileUpdateRequest,
  ReviewMemberRequest,
  SharedTab,
  ThreadType,
  TopicInput,
} from "@contract";
import { communityApi, qk } from "@/api/endpoints";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { useRefreshLists } from "./useInbox";

export function useShared(type: ThreadType, id: string, tab: SharedTab) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityShared(scope, type, id, tab), queryFn: () => communityApi.shared(type, id, tab) });
}

export function useProfileOf(key: string | null) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: qk.communityProfile(scope, key ?? ""),
    queryFn: () => communityApi.profileOf(key ?? ""),
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const { reloadMe } = useSession();
  return useMutation({
    mutationFn: (body: ProfileUpdateRequest) => communityApi.updateProfile(body),
    onSuccess: () => void reloadMe(),
  });
}

export function useReapply() {
  const { reloadMe } = useSession();
  return useMutation({ mutationFn: (displayName: string) => communityApi.reapply({ displayName }), onSuccess: () => void reloadMe() });
}

/** Open (or create) the DM with someone and go to it. */
export function useOpenDm() {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: (peerKey: string) => communityApi.openDm(peerKey),
    onSuccess: ({ conversationId }) => {
      void refresh();
      router.push({ pathname: "/community/dm/[id]", params: { id: conversationId } });
    },
  });
}

export function useDrops() {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityDrops(scope), queryFn: communityApi.drops, refetchInterval: 60_000 });
}

export function useCreateDrop() {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: (body: DropInput) => communityApi.createDrop(body), onSuccess: () => void refresh() });
}

export function useMembers(status: MemberStatus) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityMembers(scope, status), queryFn: () => communityApi.members(status) });
}

export function useReviewMember() {
  const { scope } = useSignedIn();
  const { reloadMe } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, body }: { customerId: string; body: ReviewMemberRequest }) => communityApi.review(customerId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.communityMembersAll(scope) });
      void reloadMe(); // the pendingApplications badge
    },
  });
}

/** Moderators: open the community to everyone, or review each new member. */
export function useSetJoinMode() {
  const { scope } = useSignedIn();
  const { reloadMe } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: JoinMode) => communityApi.setJoinMode(mode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.communityMembersAll(scope) });
      void reloadMe(); // joinMode + the pendingApplications badge
    },
  });
}

/** The store's protocol guide, for sharing one into chat. */
export function useProtocols(enabled: boolean) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityProtocols(scope), queryFn: communityApi.protocols, enabled, staleTime: 5 * 60_000 });
}

export function useChannelMutations() {
  const refresh = useRefreshLists();
  const done = () => void refresh();
  return {
    create: useMutation({ mutationFn: (body: ChannelInput) => communityApi.createChannel(body), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: ChannelInput }) => communityApi.updateChannel(id, body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => communityApi.deleteChannel(id), onSuccess: done }),
  };
}

export function useTopicMutations() {
  const refresh = useRefreshLists();
  const done = () => void refresh();
  return {
    create: useMutation({
      mutationFn: ({ channelId, body }: { channelId: string; body: TopicInput }) => communityApi.createTopic(channelId, body),
      onSuccess: done,
    }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: TopicInput }) => communityApi.updateTopic(id, body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => communityApi.deleteTopic(id), onSuccess: done }),
  };
}
