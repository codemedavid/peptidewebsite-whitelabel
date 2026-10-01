// The Pepweb Admin mobile API contract — /api/mobile/v1/*.
//
// TYPES ONLY, zero imports: the Expo app (mobile/) imports this file with
// `import type` through a tsconfig path, so the server and the app share ONE
// definition of every payload and cannot drift. Adding a runtime import here
// would break the app's build.

export type ApiErrorCode =
  | "unauthenticated" // no / bad / expired access token → client refreshes once, then signs out
  | "session_revoked" // signed out elsewhere, password changed, account removed → sign out
  | "forbidden" // signed in, but this account lacks the permission / feature
  | "store_unavailable" // store suspended, not set up, or trial ended
  | "not_found"
  | "conflict" // the record changed since the client last read it
  | "invalid_input"
  | "rate_limited"
  | "wrong_password" // a re-entered password was wrong (401) — NOT a session problem: never refresh or sign out
  | "server_error";

export type ApiError = { ok: false; error: { code: ApiErrorCode; message: string } };
export type ApiOk<T> = { ok: true; data: T };
export type ApiResponse<T> = ApiOk<T> | ApiError;

// ── Auth ─────────────────────────────────────────────────────────────────────

/** `store` is optional — only sent after the admin picks one from `chooseStore`. */
export type LoginRequest = { store?: string; email: string; password: string };
export type RefreshRequest = { refreshToken: string };

export type TokenPair = {
  accessToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

export type LoginResponse = TokenPair & { me: MeResponse };

/** A store this email + password opens — shown when there is more than one. */
export type StoreChoice = { slug: string; name: string; logoUrl: string | null; address: string };

/** Returned (instead of tokens) when the same login opens several stores. */
export type LoginChoiceResponse = { chooseStore: StoreChoice[] };

/**
 * GET /stores/:store (public) — the store a shared app link points at. The app
 * keeps it as the phone's linked store: sign-in is then scoped to it, and the
 * signed-out screens wear its branding.
 */
export type StorePreview = {
  slug: string;
  name: string;
  logoUrl: string | null;
  /** `<slug>.<root>` — shown under the name and sent back as the login `store`. */
  address: string;
  websiteUrl: string;
  /** Where a new customer creates their account (the store's website). */
  signUpUrl: string;
  /** The store's customers can sign in to the app (the store holds the app community). */
  customerSignIn: boolean;
  theme: MobileBrandTheme;
};

// ── Identity, permissions, branding ──────────────────────────────────────────

export type MobileBrandFonts = {
  heading: string | null;
  body: string | null;
  /** Direct TTF URLs the app can load at runtime; absent → system font. */
  files: { heading?: string; headingBold?: string; body?: string; bodyBold?: string };
};

export type MobileBrandTheme = {
  /** Content hash — changes whenever anything below changes. */
  version: string;
  name: string;
  logoUrl: string | null;
  /** The website's button colour — main calls to action, active tab. */
  primary: string;
  /** Text/icon colour on `primary`, guaranteed ≥ 4.5:1. */
  onPrimary: string;
  /** `primary` adjusted to read as text/links on a light surface (≥ 4.5:1 on white). */
  primaryText: string;
  /** `primary` adjusted to read on the app's dark surface. */
  primaryTextDark: string;
  accent: string;
  /** The website's own header colours, for the branded welcome / header band. */
  headerBackground: string;
  headerText: string;
  fonts: MobileBrandFonts;
  /** The website's page/card/text colours, translated for the app (every text pair ≥ 4.5:1). */
  palette: MobilePalette;
};

/**
 * The signed-in app's surfaces, taken from the store's website so the admin
 * looks like the storefront. `band` is the dark/brand block behind the sales
 * hero and live-order toast; `chart` is the one data colour.
 */
export type MobilePalette = {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  band: string;
  bandText: string;
  bandMuted: string;
  bandLine: string;
  chart: string;
  chartOnBand: string;
  chartTrack: string;
};

export type MobileActor =
  | { kind: "owner"; displayName: string; email: string }
  | { kind: "staff"; displayName: string; email: string };

/** A shopper signed in with their storefront customer account. */
export type CustomerActor = { kind: "customer"; displayName: string; email: string };

/** A store-admin module the app can deep-link to on the website. */
export type WebModuleLink = { key: string; label: string; url: string };

/** This account's personal profile (every kind: owner, staff, customer). */
export type AccountProfileView = {
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  /** What other people see: nickname, else name. */
  displayName: string;
};

export type AccountProfileUpdateRequest = { name: string; nickname?: string | null; bio?: string };

export type MeResponse = {
  store: { name: string; slug: string; websiteUrl: string; adminUrl: string; currency: string };
  /** Which app this account gets: the store admin, or the customer app. */
  mode: "admin" | "customer";
  actor: MobileActor | CustomerActor;
  /** Modules this account may use in the app (server-enforced on every call). */
  can: {
    orders: boolean;
    products: boolean;
    inventory: boolean;
    storeStatus: boolean;
    analytics: boolean;
  };
  /** The rest of the admin, on the website — only modules this account holds. */
  webModules: WebModuleLink[];
  theme: MobileBrandTheme;
  community: CommunityMe;
  /** Name, nickname and photo — editable by every account. */
  account: AccountProfileView;
};

// ── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatus =
  | "new"
  | "confirmed"
  | "processing"
  | "ready"
  | "shipped"
  | "delivered"
  | "cancelled";

export type OrderFilterKey = "new" | "to-fulfil" | "shipped" | "all";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type PaymentView = {
  label: string;
  tone: Tone;
  method: string;
  hasProof: boolean;
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  customerName: string;
  itemCount: number;
  itemsPreview: string;
  total: number;
  totalLabel: string;
  payment: PaymentView;
  orderType: "retail" | "reseller";
  hasCustomerNote: boolean;
  groupBuyName: string | null;
};

export type NextAction = {
  to: OrderStatus;
  label: string;
  /** "shipped" asks for courier + tracking first. */
  needsTracking: boolean;
};

export type StockMove = "deduct" | "restock" | null;

export type OrderDetail = OrderSummary & {
  /** Opaque concurrency token — send back as `expectedUpdatedAt`. */
  updatedAt: string;
  customer: { name: string; email: string; phone: string; contactMethod: string };
  shipping: {
    addressLine: string;
    region: string;
    bookingText: string;
  };
  items: Array<{ name: string; qty: number; unitPriceLabel: string; lineTotalLabel: string }>;
  money: {
    subtotalLabel: string;
    discountLabel: string | null;
    discountCode: string | null;
    shippingLabel: string;
    adminFeeLabel: string | null;
    adminFeeName: string | null;
    paymentFeeLabel: string | null;
    paymentFeeName: string | null;
    totalLabel: string;
  };
  paymentProofUrl: string | null;
  /**
   * The buyer's chat key (`c:<customerId>`) when the order came from a signed-in
   * customer account — "Message customer" opens the store ⇄ customer DM, where
   * the order bot also posts this order's updates. Null for guest orders.
   */
  chatKey: string | null;
  courier: string;
  trackingNumber: string;
  shippingNote: string;
  customerNote: string;
  timeline: Array<{ status: OrderStatus; at: string }>;
  imported: boolean;
  nextAction: NextAction | null;
  /** What each possible status change would do to stock — for confirmations. */
  stockEffects: Partial<Record<OrderStatus, StockMove>>;
};

export type OrderListResponse = {
  orders: OrderSummary[];
  nextCursor: string | null;
  counts: { new: number; toFulfil: number };
};

export type OrderUpdateRequest = {
  status?: OrderStatus;
  courier?: string;
  trackingNumber?: string;
  shippingNote?: string;
  /** From OrderDetail.updatedAt — the server refuses the write if the order moved on. */
  expectedUpdatedAt: string;
};

export type OrderConflict = { current: OrderDetail };

// ── Home / dashboard ─────────────────────────────────────────────────────────

export type DashboardResponse = {
  store: { open: boolean };
  queue: { newOrders: number; toFulfil: number };
  /** Present only when this account + plan may see money figures. */
  today: { orders: number; revenueLabel: string } | null;
  /** Products at or below the low-stock line (incl. out of stock). */
  lowStockCount: number;
  recent: OrderSummary[];
  lowStock: Array<{ id: string; name: string; units: number; tone: "out" | "low" }>;
};

// ── Products ─────────────────────────────────────────────────────────────────

export type ProductRow = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceLabel: string;
  /** null when made to order (no stock is tracked). */
  stock: number | null;
  available: boolean;
  hasVariations: boolean;
  stockTone: "out" | "low" | "ok" | "untracked";
  updatedAt: string;
};

export type ProductListResponse = { products: ProductRow[] };

export type ProductUpdateRequest = {
  available?: boolean;
  stock?: number;
  expectedUpdatedAt: string;
};

// ── Store status / account / devices ─────────────────────────────────────────

export type StoreStatusRequest = { open: boolean };

export type ChangePasswordRequest = { currentPassword: string; newPassword: string };

/** POST /account/delete — start deleting your own account (Apple 5.1.1(v)). */
export type DeleteAccountRequest = { password: string };

/**
 * `deleted`   — a customer account: personal data removed now, every phone signed out.
 * `requested` — an owner/staff login: request recorded for the platform, every
 *               phone signed out; the account and data go within 30 days.
 * `message` is safe to show as-is.
 */
export type DeleteAccountResponse = { outcome: "deleted" | "requested"; message: string };

export type RegisterDeviceRequest = {
  expoPushToken: string;
  platform: "ios" | "android";
  newOrders: boolean;
};

export type DeviceResponse = { newOrders: boolean };

// ── Insights (sales analytics) ───────────────────────────────────────────────

export type InsightsRange = "today" | "7d" | "30d" | "90d";

/** One headline metric. `delta` is the % change vs the previous equal window (null = no baseline). */
export type Kpi = { value: number; label: string; delta: number | null };

export type InsightsPoint = {
  /** Short axis label ("9a", "Mon", "Sep 3"). */
  label: string;
  /** Long label for the tooltip ("Tue, Sep 3"). */
  longLabel: string;
  revenue: number;
  revenueLabel: string;
  orders: number;
};

export type RankedRow = { name: string; value: number; valueLabel: string; detail: string; share: number };

export type InsightsResponse = {
  range: InsightsRange;
  rangeLabel: string;
  /** "vs yesterday so far", "vs prior 7 days"… */
  compareLabel: string;
  kpis: { revenue: Kpi; orders: Kpi; aov: Kpi; customers: Kpi; itemsSold: Kpi };
  /** Money already marked paid / proof submitted vs still awaiting payment. */
  collection: { collectedLabel: string; pendingLabel: string; collectedShare: number };
  series: InsightsPoint[];
  /** The best bucket in the window, for the "peak" callout. */
  peak: { label: string; revenueLabel: string } | null;
  customerMix: { new: number; returning: number };
  topProducts: RankedRow[];
  topCustomers: Array<RankedRow & { key: string }>;
  payments: RankedRow[];
  places: RankedRow[];
  statusMix: Array<{ status: OrderStatus; count: number }>;
  cancelled: number;
};

// ── Customers ────────────────────────────────────────────────────────────────

export type CustomerSegment = "new" | "returning" | "loyal";

export type CustomerRow = {
  /** Opaque, stable id for /customers/:key. */
  key: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  spent: number;
  spentLabel: string;
  avgLabel: string;
  firstAt: string;
  lastAt: string;
  segment: CustomerSegment;
  /** No order in the last 60 days. */
  lapsed: boolean;
};

export type CustomerSort = "spent" | "recent" | "orders";

export type CustomerListResponse = {
  summary: { total: number; returningRate: number; newThisMonth: number; lapsed: number };
  customers: CustomerRow[];
};

export type CustomerDetailResponse = {
  customer: CustomerRow & { contactMethod: string; lastAddress: string };
  favourites: Array<{ name: string; units: number }>;
  orders: OrderSummary[];
};

// ── Community (customers + store, see docs/mobile-admin/COMMUNITY.md) ────────

/**
 * none      — community not enabled for this store
 * pending   — customer applied, waiting for the owner
 * approved  — customer can read and post
 * rejected / revoked — customer sees the reason, can re-apply (rejected only)
 * moderator — owner, or staff holding the `community` module
 */
export type Membership = "none" | "pending" | "approved" | "rejected" | "revoked" | "moderator";

/** "open": every signed-in customer is in; "approval": the owner reviews each one. */
export type JoinMode = "open" | "approval";

export type CommunityMe = {
  enabled: boolean;
  membership: Membership;
  rejectionReason: string | null;
  isModerator: boolean;
  /** This account's participant key (`c:<id>` or `store`); null when not in the community. */
  myKey: string | null;
  profile: { displayName: string; bio: string; avatarHue: number } | null;
  /** Moderators only: applications waiting for review. */
  pendingApplications: number;
  joinMode: JoinMode;
};

/** Someone who can post: a customer, or the store team (posting as the store). */
export type Participant = {
  key: string;
  name: string;
  /** Stable 0–359 hue for the pastel avatar. */
  avatarHue: number;
  imageUrl: string | null;
  /** The store team — shown with a team badge. */
  isTeam: boolean;
};

/** "order" = the order bot's status update in a store ⇄ customer DM. */
export type MessageKind = "text" | "image" | "file" | "product" | "protocol" | "drop" | "system" | "order";

/** The order an "order" bot message is about: `id` opens it for the team, `number` for the buyer. */
export type OrderRefCard = { id: string; number: string };

export type ProductCard = {
  id: string;
  name: string;
  imageUrl: string | null;
  price: number;
  priceLabel: string;
  /** Set when the card points at one variation (strength). */
  variationId: string | null;
  variationName: string | null;
  hasVariations: boolean;
  inStock: boolean;
  /** null when stock is not tracked (made to order). */
  stockLeft: number | null;
};

export type ProtocolCard = {
  id: string;
  name: string;
  mode: "text" | "image" | "file";
  dose: string;
  frequency: string;
  cycle: string;
  imageUrl: string | null;
  fileUrl: string | null;
};

export type CommunityDrop = {
  id: string;
  product: ProductCard;
  headline: string;
  note: string | null;
  /** ISO; null = until ended by a moderator. */
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  /** Where the drop was announced, for "open chat". */
  topicId: string;
};

export type MessagePreview = {
  /** "You", a member's first name, the store name — null for system lines. */
  author: string | null;
  text: string;
  at: string;
};

export type ThreadType = "topic" | "dm";

export type CommunityMessage = {
  id: string;
  threadId: string;
  threadType: ThreadType;
  sender: Participant | null;
  /** Team messages only, moderators only: the staff member who wrote it. */
  authorName: string | null;
  mine: boolean;
  /** Your own messages only: the clientId you sent, so a poll can confirm the optimistic copy. */
  clientId: string | null;
  kind: MessageKind;
  body: string | null;
  product: ProductCard | null;
  protocol: ProtocolCard | null;
  image: { url: string; width: number; height: number } | null;
  file: { url: string; name: string; size: number; mime: string } | null;
  drop: CommunityDrop | null;
  order: OrderRefCard | null;
  replyTo: {
    id: string;
    senderName: string;
    /** The quoted sender's avatar hue, so the quote wears their name colour. */
    senderHue: number | null;
    senderIsTeam: boolean;
    text: string;
  } | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
};

export type CommunityChannel = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  imageUrl: string | null;
  postRole: "everyone" | "admins";
  sortOrder: number;
  topicCount: number;
  /** When the channel has only its General topic, the app opens it directly. */
  generalTopicId: string;
  lastMessageAt: string | null;
  preview: MessagePreview | null;
  /** The topic the preview's message was posted in. */
  previewTopic: string | null;
  unread: number;
  canPost: boolean;
  canManage: boolean;
};

export type CommunityTopic = {
  id: string;
  channelId: string;
  name: string;
  emoji: string;
  imageUrl: string | null;
  isGeneral: boolean;
  isPinned: boolean;
  lastMessageAt: string | null;
  messageCount: number;
  preview: MessagePreview | null;
  unread: number;
  canPost: boolean;
  canManage: boolean;
  canDelete: boolean;
};

export type CommunityConversation = {
  id: string;
  peer: Participant;
  lastMessageAt: string | null;
  messageCount: number;
  preview: MessagePreview | null;
  unread: number;
};

export type InboxResponse = {
  channels: CommunityChannel[];
  conversations: CommunityConversation[];
  drops: CommunityDrop[];
  /** Channels + DMs with anything unread — the tab badge. */
  unreadChats: number;
};

export type ChannelDetailResponse = { channel: CommunityChannel; topics: CommunityTopic[] };

export type ThreadInfo = {
  type: ThreadType;
  id: string;
  title: string;
  subtitle: string;
  emoji: string | null;
  imageUrl: string | null;
  /** DMs: the other side. */
  peer: Participant | null;
  channelId: string | null;
  canPost: boolean;
  /** Why posting is closed ("Only the store team posts here"), when it is. */
  postBlockedReason: string | null;
  canManage: boolean;
};

/**
 * GET /community/threads/:type/:id/messages
 *   ?before=<cursor>  older page (scrolling up)
 *   ?after=<cursor>   only newer messages + edits since (polling)
 * Messages are newest first.
 */
export type MessagesResponse = {
  thread: ThreadInfo;
  messages: CommunityMessage[];
  /** Pass as `before` for the next older page; null at the start of the thread. */
  olderCursor: string | null;
  /** Pass as `after` on the next poll. */
  pollCursor: string;
  /** Messages edited or deleted since `after` (poll responses only). */
  changed: CommunityMessage[];
};

export type SendMessageRequest = {
  /** Client-generated id; re-sending the same one never posts twice. */
  clientId: string;
  kind: "text" | "image" | "file" | "product" | "protocol";
  body?: string;
  productId?: string;
  variationId?: string;
  protocolId?: string;
  /** From POST /community/uploads. */
  upload?: UploadResponse;
  replyToId?: string;
};

export type EditMessageRequest = { body: string };

export type UploadResponse = {
  kind: "image" | "file";
  url: string;
  name: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
};

export type SearchHit = {
  message: CommunityMessage;
  thread: { type: ThreadType; id: string; title: string };
};

export type SearchResponse = { hits: SearchHit[] };

export type SharedTab = "media" | "docs" | "links" | "listings";
export type SharedResponse = { items: CommunityMessage[] };

export type ChannelInput = {
  name: string;
  description: string;
  emoji: string;
  imageUrl: string | null;
  postRole: "everyone" | "admins";
};

export type TopicInput = { name: string; emoji: string; imageUrl: string | null };

export type DropInput = {
  productId: string;
  variationId: string | null;
  headline: string;
  note: string;
  /** How long the drop stays live; null = until ended. */
  durationMinutes: number | null;
  /** The channel whose General topic announces it. */
  channelId: string;
};

export type DropsResponse = { drops: CommunityDrop[] };
export type ProtocolsResponse = { protocols: ProtocolCard[] };
export type EndDropResponse = { ended: true };

export type OpenDmRequest = { peerKey: string };
export type OpenDmResponse = { conversationId: string };

export type ProfileResponse = Participant & { bio: string; memberSince: string | null };
export type ProfileUpdateRequest = { displayName: string; bio: string };

export type MarkReadRequest = { at: string };

// ── Member approvals (moderators) ──

export type MemberStatus = "pending" | "approved" | "rejected" | "revoked";

export type MemberApplication = {
  customerId: string;
  displayName: string;
  email: string;
  phone: string;
  status: MemberStatus;
  reason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
};

export type MembersResponse = {
  members: MemberApplication[];
  counts: Record<MemberStatus, number>;
  joinMode: JoinMode;
};

export type JoinModeRequest = { joinMode: JoinMode };

export type ReviewMemberRequest = { approve: boolean; reason?: string };

/** Customer re-applies after a rejection. */
export type ReapplyRequest = { displayName: string };
