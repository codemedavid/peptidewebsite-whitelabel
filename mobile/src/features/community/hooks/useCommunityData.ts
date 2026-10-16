// Everything besides the inbox and open threads: shared shelves, profiles,
// DMs, drops, member approvals, channel/topic management.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import type {
  ChannelInput,
  DropInput,
  FlagActionRequest,
  FlagStatus,
  MemberSanctionRequest,
  ModerationSettingsRequest,
  GroupBuyBroadcastRequest,
  JoinMode,
  MembersResponse,
  MemberStatus,
  ProfileUpdateRequest,
  ReviewMemberRequest,
  SavedRepliesResponse,
  SavedReplyRequest,
  SharedTab,
  ThreadType,
  TopicInput,
  WelcomeRequest,
  CommunityTags,
} from "@contract";
import { communityApi, qk } from "@/api/endpoints";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { DEFAULT_TAGS } from "../lib/tagLook";
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

/** The live group-buy round as a chat card (null when none). Refreshes every minute for slots and state. */
export function useLiveGroupBuy(enabled = true) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityGroupBuy(scope), queryFn: communityApi.liveGroupBuy, enabled, staleTime: 30_000, refetchInterval: 60_000 });
}

export function useBroadcastGroupBuy() {
  const refresh = useRefreshLists();
  return useMutation({ mutationFn: (body: GroupBuyBroadcastRequest) => communityApi.broadcastGroupBuy(body), onSuccess: () => void refresh() });
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

/**
 * Moderators: the store's saved welcome messages. Rides the Members screen's
 * "pending" query, so the admin panel and Members share one cache entry.
 */
export function useWelcome(enabled = true) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: qk.communityMembers(scope, "pending"),
    queryFn: () => communityApi.members("pending"),
    enabled,
    select: (d) => d.welcome,
  });
}

/** Moderators: the welcome DMs each new member gets once, in order. */
export function useSetWelcome() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (welcome: WelcomeRequest["welcome"]) => communityApi.setWelcome(welcome),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.communityMembersAll(scope) }),
  });
}

/**
 * Moderators: mark a member as a verified reseller (opens reseller-only
 * channels). Optimistic across every cached member list; rolls back on error.
 */
/** A store-team switch on one member (reseller, admin), applied optimistically. */
function useMemberFlag(field: "verifiedReseller" | "isAdmin") {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = qk.communityMembersAll(scope);
  return useMutation({
    mutationFn: ({ customerId, value }: { customerId: string; value: boolean }) =>
      communityApi.updateMember(customerId, field === "isAdmin" ? { isAdmin: value } : { verifiedReseller: value }),
    onMutate: async ({ customerId, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueriesData<MembersResponse>({ queryKey: key });
      qc.setQueriesData<MembersResponse>({ queryKey: key }, (old) =>
        old ? { ...old, members: old.members.map((m) => (m.customerId === customerId ? { ...m, [field]: value } : m)) } : old,
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [k, data] of ctx?.snapshot ?? []) qc.setQueryData(k, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

/** The store's tag looks from /me; defaults while the server doesn't send them. */
export function useCommunityTags(): CommunityTags {
  return useSignedIn().me.community.tags ?? DEFAULT_TAGS;
}

/** Restyle one or both member tags; /me reloads so every badge updates at once. */
export function useSaveCommunityTags() {
  const { reloadMe } = useSession();
  return useMutation({
    mutationFn: (tags: Partial<CommunityTags>) => communityApi.updateTags(tags),
    onSuccess: () => reloadMe(),
  });
}

export function useSetVerifiedReseller() {
  return useMemberFlag("verifiedReseller");
}

/** Make an approved member a community admin, or take it back (store team only). */
export function useSetMemberAdmin() {
  return useMemberFlag("isAdmin");
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

// ── Safety bot (moderators) ─────────────────────────────────────────────────

export function useModeration(status: FlagStatus) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.communityModeration(scope, status), queryFn: () => communityApi.moderation(status) });
}

/** After any safety action the queue, the member list and open chats may all have changed. */
function useRefreshSafety() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.communityModerationAll(scope) });
    void qc.invalidateQueries({ queryKey: qk.communityMembersAll(scope) });
  };
}

export function useSetModeration() {
  const refresh = useRefreshSafety();
  return useMutation({ mutationFn: (body: ModerationSettingsRequest) => communityApi.setModeration(body), onSuccess: refresh });
}

export function useReviewFlag() {
  const refresh = useRefreshSafety();
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, body }: { flagId: string; body: FlagActionRequest }) => communityApi.reviewFlag(flagId, body),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: qk.community(scope) }); // a restored message reappears in its chat
    },
  });
}

export function useSanctionMember() {
  const refresh = useRefreshSafety();
  return useMutation({
    mutationFn: ({ customerId, body }: { customerId: string; body: MemberSanctionRequest }) => communityApi.sanction(customerId, body),
    onSuccess: refresh,
  });
}

// ── Saved replies (store team) ───────────────────────────────────────────────

/** The team's shared quick answers. Off for customers — the server refuses them anyway. */
export function useSavedReplies(enabled: boolean) {
  const { scope } = useSignedIn();
  return useQuery({
    queryKey: qk.communitySavedReplies(scope),
    queryFn: communityApi.savedReplies,
    enabled,
    staleTime: 30_000,
    select: (d) => d.replies,
  });
}

type SavedReplyChange = { kind: "create"; body: SavedReplyRequest } | { kind: "update"; id: string; body: SavedReplyRequest } | { kind: "delete"; id: string };

/** Create / edit / delete; the answer is the whole list, so the cache takes it as-is. */
export function useChangeSavedReply() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: SavedReplyChange): Promise<SavedRepliesResponse> => {
      if (change.kind === "create") return communityApi.createSavedReply(change.body);
      if (change.kind === "update") return communityApi.updateSavedReply(change.id, change.body);
      return communityApi.deleteSavedReply(change.id);
    },
    onSuccess: (data) => qc.setQueryData(qk.communitySavedReplies(scope), data),
    // A teammate may have deleted or renamed it meanwhile.
    onError: () => void qc.invalidateQueries({ queryKey: qk.communitySavedReplies(scope) }),
  });
}
