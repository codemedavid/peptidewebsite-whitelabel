import type { DropsResponse, EndDropResponse, JoinMode, ProtocolsResponse,
  GroupBuyBroadcastRequest,
  GroupBuyBroadcastResponse,
  LiveGroupBuyResponse,
  ChannelDetailResponse,
  ChannelInput,
  CommunityChannel,
  CommunityDrop,
  CommunityMessage,
  CommunityTopic,
  DropInput,
  EditMessageRequest,
  InboxResponse,
  MarkReadRequest,
  MembersResponse,
  MemberStatus,
  FlagActionRequest,
  FlagStatus,
  MemberSanctionRequest,
  ModerationResponse,
  ModerationSettingsRequest,
  ModerationSettingsView,
  SavedRepliesResponse,
  SavedReplyRequest,
  MemberUpdateRequest,
  WelcomeMessage,
  WelcomeRequest,
  VideoConfirmRequest,
  VideoUploadTicket,
  MessagesResponse,
  OpenDmResponse,
  ProfileResponse,
  ProfileUpdateRequest,
  ReapplyRequest,
  ReviewMemberRequest,
  SearchResponse,
  SendMessageRequest,
  SharedResponse,
  SharedTab,
  ThreadType,
  TopicInput,
  UploadResponse,
  CustomerDetailResponse,
  CustomerListResponse,
  CustomerSort,
  DashboardResponse,
  InsightsRange,
  InsightsResponse,
  DeviceResponse,
  LoginChoiceResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  AccountProfileView,
  AccountProfileUpdateRequest,
  DeleteAccountResponse,
  OrderDetail,
  OrderFilterKey,
  OrderListResponse,
  OrderUpdateRequest,
  ProductListResponse,
  ProductRow,
  ProductUpdateRequest,
  RegisterDeviceRequest,
  RegisterRequest,
  StorePreview,
  TokenPair,
  CommunityTagsResponse,
  CommunityTagsUpdateRequest,
} from "@contract";
import { api, apiUpload, type UploadFile } from "./client";

/** Typed calls for every /api/mobile/v1 route. */

export const authApi = {
  login: (body: LoginRequest) =>
    // Sign-in checks the password against every store the email opens (two
    // scrypts each) before issuing a session — slower than a normal call.
    api<LoginResponse | LoginChoiceResponse>("/auth/login", {
      method: "POST",
      body,
      auth: false,
      retryable: true,
      timeoutMs: 45_000,
    }),
  /** Never retried: a resend after a lost answer would meet "email taken". */
  register: (body: RegisterRequest) =>
    api<LoginResponse>("/auth/register", { method: "POST", body, auth: false, timeoutMs: 45_000 }),
  refresh: (refreshToken: string) =>
    api<TokenPair>("/auth/refresh", { method: "POST", body: { refreshToken }, auth: false }),
  logout: (accessToken: string | null, refreshToken: string | null) =>
    api<{ signedOut: true }>("/auth/logout", {
      method: "POST",
      body: { refreshToken },
      auth: false,
      token: accessToken ?? undefined,
    }),
};

/** Public — the store a shared app link points at (no session needed). */
export const storesApi = {
  preview: (identifier: string) =>
    api<StorePreview>(`/stores/${encodeURIComponent(identifier)}`, { auth: false }),
};

export const meApi = {
  get: () => api<MeResponse>("/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ changed: true }>("/account/password", { method: "POST", body: { currentPassword, newPassword } }),
  /** Your own name, nickname and photo — every kind of account. */
  profile: () => api<AccountProfileView>("/account/profile"),
  updateProfile: (body: AccountProfileUpdateRequest) => api<AccountProfileView>("/account/profile", { method: "PATCH", body }),
  uploadPhoto: (file: UploadFile) => apiUpload<AccountProfileView>("/account/profile/photo", "file", file),
  removePhoto: () => api<AccountProfileView>("/account/profile/photo", { method: "DELETE" }),
  /**
   * Start deleting this account (Apple 5.1.1(v)). Never retried: a resend
   * after a lost answer would only meet an already-revoked session.
   */
  deleteAccount: (password: string) =>
    api<DeleteAccountResponse>("/account/delete", { method: "POST", body: { password }, retryable: false }),
};

export const dashboardApi = {
  get: () => api<DashboardResponse>("/dashboard"),
};

export const insightsApi = {
  get: (range: InsightsRange) => api<InsightsResponse>(`/insights?range=${range}`),
};

export type CustomerFilterKey = "all" | "new" | "returning" | "loyal" | "lapsed";

export const customersApi = {
  list: (q: string, sort: CustomerSort, segment: CustomerFilterKey) => {
    const params = new URLSearchParams({ sort });
    if (q.trim()) params.set("q", q.trim());
    if (segment !== "all") params.set("segment", segment);
    return api<CustomerListResponse>(`/customers?${params.toString()}`);
  },
  get: (key: string) => api<CustomerDetailResponse>(`/customers/${encodeURIComponent(key)}`),
};

export const ordersApi = {
  list: (filter: OrderFilterKey, q: string, cursor: string | null) => {
    const params = new URLSearchParams({ filter });
    if (q.trim()) params.set("q", q.trim());
    if (cursor) params.set("cursor", cursor);
    return api<OrderListResponse>(`/orders?${params.toString()}`);
  },
  get: (id: string) => api<OrderDetail>(`/orders/${encodeURIComponent(id)}`),
  update: (id: string, body: OrderUpdateRequest) =>
    api<OrderDetail>(`/orders/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  trash: (id: string) => api<{ trashed: true }>(`/orders/${encodeURIComponent(id)}/trash`, { method: "POST" }),
  restore: (id: string) =>
    api<{ restored: true }>(`/orders/${encodeURIComponent(id)}/trash`, { method: "DELETE" }),
};

export const productsApi = {
  list: () => api<ProductListResponse>("/products"),
  update: (id: string, body: ProductUpdateRequest) =>
    api<ProductRow>(`/products/${encodeURIComponent(id)}`, { method: "PATCH", body }),
};

export const storeApi = {
  setOpen: (open: boolean) => api<{ open: boolean }>("/store-status", { method: "PUT", body: { open } }),
};

export const devicesApi = {
  register: (body: RegisterDeviceRequest) => api<DeviceResponse>("/devices", { method: "POST", body }),
  unregister: (expoPushToken: string) =>
    api<DeviceResponse>("/devices", { method: "DELETE", body: { expoPushToken } }),
};

const enc = encodeURIComponent;
const threadPath = (type: ThreadType, id: string) => `/community/threads/${type}/${enc(id)}`;

export type SearchScope = { scope: "everywhere" } | { scope: "thread"; type: ThreadType; id: string };

/** Community (customers + store team): see docs/mobile-admin/COMMUNITY.md. */
export const communityApi = {
  inbox: () => api<InboxResponse>("/community/inbox"),
  channel: (id: string) => api<ChannelDetailResponse>(`/community/channels/${enc(id)}`),
  createChannel: (body: ChannelInput) => api<CommunityChannel>("/community/channels", { method: "POST", body }),
  updateChannel: (id: string, body: ChannelInput) =>
    api<CommunityChannel>(`/community/channels/${enc(id)}`, { method: "PATCH", body }),
  deleteChannel: (id: string) => api<{ deleted: true }>(`/community/channels/${enc(id)}`, { method: "DELETE" }),
  createTopic: (channelId: string, body: TopicInput) =>
    api<CommunityTopic>(`/community/channels/${enc(channelId)}/topics`, { method: "POST", body }),
  updateTopic: (id: string, body: TopicInput) =>
    api<CommunityTopic>(`/community/topics/${enc(id)}`, { method: "PATCH", body }),
  deleteTopic: (id: string) => api<{ deleted: true }>(`/community/topics/${enc(id)}`, { method: "DELETE" }),

  messages: (type: ThreadType, id: string, cursor?: { before?: string; after?: string }) => {
    const params = new URLSearchParams();
    if (cursor?.before) params.set("before", cursor.before);
    if (cursor?.after) params.set("after", cursor.after);
    const qs = params.toString();
    return api<MessagesResponse>(`${threadPath(type, id)}/messages${qs ? `?${qs}` : ""}`);
  },
  /** Safe to retry: the server de-duplicates on clientId. */
  send: (type: ThreadType, id: string, body: SendMessageRequest) =>
    api<CommunityMessage>(`${threadPath(type, id)}/messages`, { method: "POST", body, retryable: true }),
  editMessage: (id: string, body: EditMessageRequest) =>
    api<CommunityMessage>(`/community/messages/${enc(id)}`, { method: "PATCH", body }),
  deleteMessage: (id: string) =>
    api<CommunityMessage>(`/community/messages/${enc(id)}`, { method: "DELETE" }),
  markRead: (type: ThreadType, id: string, body: MarkReadRequest) =>
    api<{ read: true }>(`${threadPath(type, id)}/read`, { method: "POST", body, retryable: true }),

  search: (q: string, where: SearchScope) => {
    const params = new URLSearchParams({ q, scope: where.scope });
    if (where.scope === "thread") {
      params.set("type", where.type);
      params.set("id", where.id);
    }
    return api<SearchResponse>(`/community/search?${params.toString()}`);
  },
  shared: (type: ThreadType, id: string, tab: SharedTab) =>
    api<SharedResponse>(`${threadPath(type, id)}/shared?tab=${tab}`),

  openDm: (peerKey: string) => api<OpenDmResponse>("/community/dms", { method: "POST", body: { peerKey }, retryable: true }),
  profile: () => api<ProfileResponse>("/community/profile"),
  updateProfile: (body: ProfileUpdateRequest) => api<ProfileResponse>("/community/profile", { method: "PATCH", body }),
  profileOf: (key: string) => api<ProfileResponse>(`/community/profiles/${enc(key)}`),
  upload: (file: UploadFile, signal?: AbortSignal) => apiUpload<UploadResponse>("/community/uploads", "file", file, signal),
  /** Team only: a signed ticket to upload a video straight to the media host (or "inline"). */
  videoTicket: (name: string) => api<VideoUploadTicket>("/community/uploads/video", { method: "POST", body: { name } }),
  /** Team only: record a direct video upload once the server has checked it. */
  confirmVideo: (body: VideoConfirmRequest) => api<UploadResponse>("/community/uploads/video/confirm", { method: "POST", body }),

  drops: () => api<DropsResponse>("/community/drops").then((r) => r.drops),
  createDrop: (body: DropInput) => api<CommunityDrop>("/community/drops", { method: "POST", body }),
  endDrop: (id: string) => api<EndDropResponse>(`/community/drops/${enc(id)}/end`, { method: "POST" }),
  liveGroupBuy: () => api<LiveGroupBuyResponse>("/community/group-buy"),
  /** Idempotent on body.clientId (per channel), so a retry never posts twice. */
  broadcastGroupBuy: (body: GroupBuyBroadcastRequest) =>
    api<GroupBuyBroadcastResponse>("/community/group-buy/broadcast", { method: "POST", body, retryable: true }),

  members: (status: MemberStatus) => api<MembersResponse>(`/community/members?status=${status}`),
  review: (customerId: string, body: ReviewMemberRequest) =>
    api<{ reviewed: true }>(`/community/members/${enc(customerId)}/review`, { method: "POST", body }),
  setJoinMode: (joinMode: JoinMode) => api<{ joinMode: JoinMode }>("/community/members", { method: "PATCH", body: { joinMode } }),
  /** The DMs sent once, in order, to each new member. */
  setWelcome: (welcome: WelcomeRequest["welcome"]) => api<{ welcome: WelcomeMessage }>("/community/members", { method: "PATCH", body: { welcome } }),
  /** Verified resellers see channels whose audience is "resellers"; admins help run the community. */
  updateMember: (customerId: string, body: MemberUpdateRequest) =>
    api<{ customerId: string; verifiedReseller?: boolean; isAdmin?: boolean }>(`/community/members/${enc(customerId)}`, { method: "PATCH", body }),
  /** The look of the Admin and Verified reseller tags (the team and community admins). */
  updateTags: (tags: CommunityTagsUpdateRequest["tags"]) => api<CommunityTagsResponse>("/community/tags", { method: "PATCH", body: { tags } }),
  reapply: (body: ReapplyRequest) => api<{ membership: "pending" | "approved" }>("/community/reapply", { method: "POST", body }),
  protocols: () => api<ProtocolsResponse>("/community/protocols").then((r) => r.protocols),
  /** Safety bot (moderators): the flagged-message queue and its settings. */
  moderation: (status: FlagStatus) => api<ModerationResponse>(`/community/moderation?status=${status}`),
  setModeration: (body: ModerationSettingsRequest) => api<ModerationSettingsView>("/community/moderation", { method: "PATCH", body }),
  reviewFlag: (flagId: string, body: FlagActionRequest) =>
    api<{ status: FlagStatus }>(`/community/moderation/flags/${enc(flagId)}`, { method: "POST", body }),
  /** ban = out of the community AND the login is refused; unban gives both back. */
  sanction: (customerId: string, body: MemberSanctionRequest) =>
    api<{ customerId: string; muted: boolean; banned: boolean }>(`/community/members/${enc(customerId)}/sanction`, { method: "POST", body }),
  /** The store team's shared quick answers (moderators). Every write answers with the whole list. */
  savedReplies: () => api<SavedRepliesResponse>("/community/saved-replies"),
  createSavedReply: (body: SavedReplyRequest) => api<SavedRepliesResponse>("/community/saved-replies", { method: "POST", body }),
  updateSavedReply: (id: string, body: SavedReplyRequest) => api<SavedRepliesResponse>(`/community/saved-replies/${enc(id)}`, { method: "PATCH", body }),
  deleteSavedReply: (id: string) => api<SavedRepliesResponse>(`/community/saved-replies/${enc(id)}`, { method: "DELETE" }),
};

/**
 * React Query keys. Every key starts with the SESSION scope (store + account),
 * so one store's cached data can never be served to another — and signing out
 * clears the whole cache anyway.
 */
export const qk = {
  scope: (scope: string) => [scope] as const,
  me: (scope: string) => [scope, "me"] as const,
  dashboard: (scope: string) => [scope, "dashboard"] as const,
  orders: (scope: string, filter: OrderFilterKey, q: string) => [scope, "orders", filter, q] as const,
  ordersAll: (scope: string) => [scope, "orders"] as const,
  order: (scope: string, id: string) => [scope, "order", id] as const,
  products: (scope: string) => [scope, "products"] as const,
  insights: (scope: string, range: InsightsRange) => [scope, "insights", range] as const,
  insightsAll: (scope: string) => [scope, "insights"] as const,
  customers: (scope: string, q: string, sort: CustomerSort, segment: CustomerFilterKey) =>
    [scope, "customers", q, sort, segment] as const,
  customersAll: (scope: string) => [scope, "customers"] as const,
  customer: (scope: string, key: string) => [scope, "customer", key] as const,
  community: (scope: string) => [scope, "community"] as const,
  communityInbox: (scope: string) => [scope, "community", "inbox"] as const,
  communityChannel: (scope: string, id: string) => [scope, "community", "channel", id] as const,
  communityThread: (scope: string, type: ThreadType, id: string) => [scope, "community", "thread", type, id] as const,
  communitySearch: (scope: string, q: string, where: string) => [scope, "community", "search", where, q] as const,
  communityShared: (scope: string, type: ThreadType, id: string, tab: SharedTab) =>
    [scope, "community", "shared", type, id, tab] as const,
  communityProfile: (scope: string, key: string) => [scope, "community", "profile", key] as const,
  communityDrops: (scope: string) => [scope, "community", "drops"] as const,
  communityGroupBuy: (scope: string) => [scope, "community", "group-buy"] as const,
  communityProtocols: (scope: string) => [scope, "community", "protocols"] as const,
  communityMembers: (scope: string, status: MemberStatus) => [scope, "community", "members", status] as const,
  communityMembersAll: (scope: string) => [scope, "community", "members"] as const,
  communityModeration: (scope: string, status: FlagStatus) => [scope, "community", "moderation", status] as const,
  communityModerationAll: (scope: string) => [scope, "community", "moderation"] as const,
  communitySavedReplies: (scope: string) => [scope, "community", "saved-replies"] as const,
};
