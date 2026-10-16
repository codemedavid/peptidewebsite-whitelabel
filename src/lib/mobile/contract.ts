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
/**
 * POST /auth/register — a shopper creates their customer account on `store`
 * (accounts are per store) and is signed straight in: answers LoginResponse.
 */
export type RegisterRequest = {
  store: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  age: number;
  /** Optional — omitted or null = not said. */
  gender?: SignUpGender | null;
  password: string;
};
export type SignUpGender = "female" | "male" | "other";
/**
 * POST /auth/exchange — a partner app (Mamamica Glow) trades its Supabase
 * access token for this store's customer session: answers LoginResponse.
 * Needs a confirmed, non-anonymous Supabase user and the store's
 * branding.config.supabaseExchange.
 */
export type ExchangeRequest = { store: string; supabaseAccessToken: string };
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
  /** The group-buy round the order was placed in (null = an on-hand order). */
  groupBuyId: string | null;
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

/** Where a group-buy round stands for the people looking at its orders. */
export type OrderRoundState = "live" | "upcoming" | "closed";

/**
 * One chip in the orders round bar: a group-buy round, or every on-hand order
 * (`key` "on-hand"). `count` honours the status filter + search, never the
 * round filter itself, so each chip says what tapping it would show.
 */
export type OrderRoundFacet = {
  key: string;
  name: string;
  /** Owner's batch label, "" when unset. */
  batch: string;
  state: OrderRoundState | "on-hand";
  count: number;
};

/** `round` query value that selects orders placed outside any group buy. */
export const ON_HAND_ROUND = "on-hand";

export type OrderListResponse = {
  orders: OrderSummary[];
  nextCursor: string | null;
  counts: { new: number; toFulfil: number };
  /** First page only (null on later pages): rounds with orders in this view, live first. */
  rounds: OrderRoundFacet[] | null;
};

/**
 * One printable waybill — the shipping label the owner packs with an order.
 * Every value is display-ready (money formatted, quantities worded), so the
 * app only lays it out.
 */
export type Waybill = {
  id: string;
  orderNumber: string;
  name: string;
  address: string;
  phone: string;
  courier: string;
  shippingFee: string;
  /** The group-buy round's name ("GB 10/2/2026"); "" for an on-hand order. */
  roundName: string;
  items: Array<{ name: string; qty: number; qtyLabel: string }>;
};

/**
 * GET /orders/waybills?round=<id>|on-hand&filter=&q= (a round, oldest order
 * first, never cancelled ones) or ?id=<orderId> (one order).
 */
export type WaybillsResponse = {
  waybills: Waybill[];
  /** More orders matched than one print run holds (WAYBILL_LIMIT). */
  truncated: boolean;
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
 * (A community admin is an `approved` customer with `isAdmin` set.)
 */
export type Membership = "none" | "pending" | "approved" | "rejected" | "revoked" | "moderator";

/** "open": every signed-in customer is in; "approval": the owner reviews each one. */
export type JoinMode = "open" | "approval";

export type CommunityMe = {
  enabled: boolean;
  membership: Membership;
  rejectionReason: string | null;
  /** The store team only (owner, or staff with the `community` module). */
  isModerator: boolean;
  /**
   * A customer the team made a community admin: manages channels and topics
   * and reviews members, but none of the store-team tools. Older servers omit it.
   */
  isAdmin?: boolean;
  /** The team tagged this member a verified reseller (approved members only). Older servers omit it. */
  isVerifiedReseller?: boolean;
  /** This account's participant key (`c:<id>` or `store`); null when not in the community. */
  myKey: string | null;
  profile: { displayName: string; bio: string; avatarHue: number } | null;
  /** Moderators only: applications waiting for review. */
  pendingApplications: number;
  joinMode: JoinMode;
  /** How the store dresses its member tags. Older servers omit it — use DEFAULT_COMMUNITY_TAGS. */
  tags?: CommunityTags;
  /**
   * Set while this customer is in preview (not approved, store's preview on):
   * the rules they browse under. null/absent = not in preview. Older servers omit it.
   */
  preview?: PreviewPolicy | null;
};

// ── Member tags (Admin, Verified reseller): the store picks each tag's look ──

export type CommunityTagRole = "admin" | "reseller";
/** soft = tinted fill, solid = full colour, outline = coloured ring. */
export type CommunityTagStyle = "soft" | "solid" | "outline";
/** The bubble: fully round, softly rounded, or crisp. */
export type CommunityTagShape = "pill" | "rounded" | "square";
export const COMMUNITY_TAG_ICONS = [
  "star",
  "shield-checkmark",
  "checkmark-circle",
  "ribbon",
  "medal",
  "trophy",
  "diamond",
  "sparkles",
  "flash",
  "flame",
  "heart",
  "leaf",
  "rocket",
  "pricetag",
] as const;
export type CommunityTagIcon = (typeof COMMUNITY_TAG_ICONS)[number];
export const COMMUNITY_TAG_LABEL_MAX = 20;

export type CommunityTagDesign = {
  label: string;
  /** null = text only. */
  icon: CommunityTagIcon | null;
  /** "#RRGGBB", or null = the store's own brand colour. */
  color: string | null;
  style: CommunityTagStyle;
  shape: CommunityTagShape;
};
export type CommunityTags = Record<CommunityTagRole, CommunityTagDesign>;

export const DEFAULT_COMMUNITY_TAGS: CommunityTags = {
  admin: { label: "Admin", icon: "star", color: null, style: "soft", shape: "pill" },
  reseller: { label: "Verified reseller", icon: "shield-checkmark", color: null, style: "soft", shape: "pill" },
};

/** PATCH /community/tags — one or both tags, each a whole design. */
export type CommunityTagsUpdateRequest = { tags: Partial<CommunityTags> };
export type CommunityTagsResponse = { tags: CommunityTags };

// ── Preview access: signed-in customers the store hasn't approved yet ────────

/**
 * What one channel shows someone in preview:
 *   hidden — not listed at all
 *   locked — listed (name, emoji, description) but can't be opened
 *   read   — opened and read, nothing posted
 *   chat   — read and post (the channel's own post rule still applies)
 */
export type ChannelPreviewAccess = "hidden" | "locked" | "read" | "chat";
export const CHANNEL_PREVIEW_ACCESS: readonly ChannelPreviewAccess[] = ["hidden", "locked", "read", "chat"];
export const DEFAULT_CHANNEL_PREVIEW_ACCESS: ChannelPreviewAccess = "locked";

/**
 * The store's preview rules (branding.config.previewAccess). Applies to every
 * signed-in customer whose membership isn't approved, and only while `enabled`
 * — off, the store works as before (pending members see their membership card).
 */
export type PreviewPolicy = {
  enabled: boolean;
  /** Message the store team in a DM. */
  messageStore: boolean;
  /** Show product prices in the app's shop. */
  showPrices: boolean;
  /** Place regular (on-hand) orders. */
  placeOrders: boolean;
  /** See the live group-buy round. */
  viewGroupBuys: boolean;
  /** Order into the live group-buy round. */
  joinGroupBuys: boolean;
  /** Use the partner app's own tools (Mamamica's dose tracker). */
  useTracker: boolean;
};

/** "Browse only": products with prices, channel names, the tracker — nothing that acts. */
export const DEFAULT_PREVIEW_POLICY: PreviewPolicy = {
  enabled: false,
  messageStore: false,
  showPrices: true,
  placeOrders: false,
  viewGroupBuys: true,
  joinGroupBuys: false,
  useTracker: true,
};

/** GET / PATCH /community/preview (moderators: the team and community admins). PATCH takes any subset of the fields. */
export type PreviewPolicyUpdateRequest = Partial<PreviewPolicy>;
export type PreviewPolicyResponse = { policy: PreviewPolicy };

/** The wording every refused preview action carries (the app shows it as-is). */
export const PREVIEW_LOCKED_MESSAGE = "Available once the store approves your membership.";

/** Someone who can post: a customer, or the store team (posting as the store). */
export type Participant = {
  key: string;
  name: string;
  /** Stable 0–359 hue for the pastel avatar. */
  avatarHue: number;
  imageUrl: string | null;
  /** The store team — shown with a team badge. */
  isTeam: boolean;
  /** A member the team made a community admin — shown with an admin badge. Older servers omit it. */
  isAdmin?: boolean;
  /** A member the team tagged a verified reseller — shown with a VR badge. Older servers omit it. */
  isVerifiedReseller?: boolean;
};

/**
 * "order" = the order bot's status update in a store ⇄ customer DM.
 * "groupbuy" = the store's live group-buy round, shared as a card.
 */
export type MessageKind = "text" | "image" | "video" | "file" | "product" | "protocol" | "drop" | "system" | "order" | "groupbuy";

/**
 * A video in a message (today only the store's welcome messages carry one).
 * `posterUrl` is a still frame when the host can make one (ImageKit), else null.
 */
export type VideoAttachment = { url: string; posterUrl: string | null; width: number | null; height: number | null; size: number; mime: string };

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

/**
 * A group-buy round shared into chat. ALWAYS rebuilt by the server from the
 * live round (the client only sends its id), so a card shared last week shows
 * today's slots, countdown and state.
 *   open   — the round is live and taking orders
 *   closed — still live, but the owner paused ordering (view only)
 *   ended  — no longer the live round
 */
export type GroupBuyCard = {
  id: string;
  name: string;
  description: string;
  deliveryEta: string;
  /** ISO; null = open-ended (and always null once ended). */
  endsAt: string | null;
  status: "open" | "closed" | "ended";
  /** 0 = no progress bar. */
  slotGoal: number;
  filled: number;
  productCount: number;
  /** "₱1,200" — the lowest price in the round; null when ended. */
  fromPriceLabel: string | null;
  /** Up to four product photos. */
  images: string[];
  /** The owner's terms line ("Pay now to lock your slot…"). */
  terms: string;
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
  video: VideoAttachment | null;
  file: { url: string; name: string; size: number; mime: string } | null;
  drop: CommunityDrop | null;
  order: OrderRefCard | null;
  groupBuy: GroupBuyCard | null;
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
  /** Removed by the safety bot (deletedAt is set too). Older servers omit it. */
  moderated?: boolean;
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
  /**
   * "hub": the Verified Resellers Hub. Every member sees it; verified resellers
   * post their on-hand stock in its General topic ("On hand") and members post
   * what they need in "Looking for". canPost here = may add a topic.
   */
  audience: ChannelAudience;
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
  /** Preview only: listed, but opens once the store approves the reader. Older servers omit it. */
  locked?: boolean;
  /** Moderators only: what people in preview get here. Older servers omit it. */
  previewAccess?: ChannelPreviewAccess;
  /**
   * Members: this channel's chat messages don't push my phones (drops and
   * group buys still do). Omitted for the store team and by older servers.
   */
  muted?: boolean;
};

/** PUT /community/channels/:id/mute — members only. */
export type ChannelMuteRequest = { muted: boolean };
export type ChannelMuteResponse = { channelId: string; muted: boolean };

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
  /** The composer's placeholder in a hub topic ("What are you looking for?"). Older servers omit it. */
  composerHint?: string | null;
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
  kind: "text" | "image" | "file" | "product" | "protocol" | "groupbuy";
  body?: string;
  productId?: string;
  variationId?: string;
  protocolId?: string;
  /** kind "groupbuy": the LIVE round's id (anything else is refused). */
  groupBuyId?: string;
  /** From POST /community/uploads. */
  upload?: UploadResponse;
  replyToId?: string;
};

export type EditMessageRequest = { body: string };

export type UploadResponse = {
  kind: "image" | "video" | "file";
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

export type ChannelAudience = "everyone" | "hub";

export type ChannelInput = {
  name: string;
  description: string;
  emoji: string;
  imageUrl: string | null;
  postRole: "everyone" | "admins";
  /** Defaults to "everyone". */
  audience?: ChannelAudience;
  /** What members not approved yet get here. Omitted = unchanged (new channels: "locked"). */
  previewAccess?: ChannelPreviewAccess;
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

/** GET /community/group-buy — the live round as a card, for the attach menu and the Chats pin. */
export type LiveGroupBuyResponse = {
  groupBuy: GroupBuyCard | null;
  /** Moderators only: may "send to everyone". */
  canBroadcast: boolean;
};

/**
 * POST /community/group-buy/broadcast (moderators) — posts the live round's
 * card into each channel's General topic as the store, then pushes every
 * approved member once. Retrying with the same clientId posts nothing twice.
 */
export type GroupBuyBroadcastRequest = {
  clientId: string;
  channelIds: string[];
  /** Shown as the card's caption in every channel. */
  note?: string;
};
export type GroupBuyBroadcastResponse = { posted: number; topicIds: string[] };
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
  /** May post on-hand stock in a resellers hub (and wears the VR tag in chat). */
  verifiedReseller: boolean;
  /** Community admin (store team sets it). Older servers omit it. */
  isAdmin?: boolean;
  /** Safety bot record. Older servers omit these. */
  offenses?: number;
  muted?: boolean;
  banned?: boolean;
};

/** A photo or video riding on one welcome message, with the text as its caption. */
export type WelcomeMedia = {
  kind: "image" | "video";
  url: string;
  name: string;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  /** Videos on ImageKit: a still frame. Derived, never stored. */
  posterUrl: string | null;
};

/** One message of the welcome: text, a photo or video, or a captioned photo/video. */
export type WelcomeItem = { id: string; text: string; media: WelcomeMedia | null };

/**
 * The DMs the store sends every member once, in order, when they first open
 * the community.
 */
export type WelcomeMessage = {
  enabled: boolean;
  messages: WelcomeItem[];
  /** App builds before multi-message welcomes: the first message's text. */
  message: string;
};

export type MembersResponse = {
  members: MemberApplication[];
  counts: Record<MemberStatus, number>;
  joinMode: JoinMode;
  welcome: WelcomeMessage;
};

export type JoinModeRequest = { joinMode: JoinMode };

/** One welcome message as the app saves it; media comes from POST /community/uploads(/video). */
export type WelcomeItemInput = { id?: string; text: string; media: { kind: "image" | "video"; url: string } | null };

/**
 * PATCH /community/members with { welcome } instead of { joinMode }. Older
 * builds send { enabled, message }, which edits only the first message's text.
 */
export type WelcomeRequest = { welcome: { enabled: boolean; messages: WelcomeItemInput[] } };

/**
 * POST /community/uploads/video — moderators. Videos are too big to pass
 * through the API, so the phone uploads straight to the media host and then
 * confirms. "inline" (no media host — demo/dev): send the video to
 * POST /community/uploads like a photo instead.
 */
export type VideoUploadTicket =
  | {
      mode: "direct";
      endpoint: string;
      publicKey: string;
      token: string;
      signature: string;
      expire: number;
      folder: string;
      fileName: string;
    }
  | { mode: "inline" };

/** POST /community/uploads/video/confirm — the media host's file id from the direct upload. */
export type VideoConfirmRequest = { fileId: string; width?: number | null; height?: number | null };

/** PATCH /community/members/:customerId */
export type MemberUpdateRequest = { verifiedReseller: boolean } | { isAdmin: boolean };

export type ReviewMemberRequest = { approve: boolean; reason?: string };

/** Customer re-applies after a rejection. */
export type ReapplyRequest = { displayName: string };

// ── Community safety bot (moderators) ───────────────────────────────────────

/** Exchange / sign-in refusal for a banned member — the app signs them out of everything on it. */
export const ACCOUNT_BANNED_MESSAGE = "This account was banned from the community for inviting members to other groups.";

export type FlagStatus = "pending" | "confirmed" | "dismissed";
/** first = one offense on record, repeat = two or more (dismissed false alarms don't count). */
export type OffenseTag = "first" | "repeat";

export type FlagSender = {
  customerId: string;
  key: string;
  name: string;
  imageUrl: string | null;
  avatarHue: number;
  offenses: number;
  tag: OffenseTag | null;
  /** "1st offense" | "Repeat offender · 3 offenses" */
  label: string | null;
  muted: boolean;
  /** true when the bot muted them (repeat offenses), false when the team did. */
  mutedByBot: boolean;
  banned: boolean;
};

/** One line of context around the flagged message (DMs: only the two lines before it). */
export type FlagContextLine = { senderName: string; text: string; at: string; flagged: boolean };

/** hidden = the bot hid it (counts as an offense) · review = borderline: still visible, waiting for you. */
export type FlagKind = "hidden" | "review";
export type Confidence = "High" | "Medium" | "Low";

export type ModerationFlag = {
  id: string;
  status: FlagStatus;
  /** Jev's probability (0..1) that the message is poaching. */
  score: number;
  /** Older servers leave these out. */
  kind?: FlagKind;
  confidence?: Confidence;
  /** The owner's Not allowed rule Jev matched (as worded then); null when it couldn't tell. */
  reason?: string | null;
  createdAt: string;
  reviewedAt: string | null;
  place: { type: ThreadType; id: string; name: string };
  message: { id: string; text: string; imageUrl: string | null; at: string; hidden: boolean };
  context: FlagContextLine[];
  sender: FlagSender;
};

/** relaxed hides only near-certain catches · strict hides more and holds more for review. */
export type Sensitivity = "relaxed" | "balanced" | "strict";
/** missing = no key on the server · rejected = key revoked/invalid · no_credits = OpenRouter balance spent. */
export type JevHealth = "ok" | "missing" | "rejected" | "no_credits" | "unreachable";

export type ModerationSettingsView = {
  enabled: boolean;
  muteAfter: number;
  /** False when Jev can't answer (no key, a rejected key, no credit) — the bot can't scan even if enabled. */
  available: boolean;
  sensitivity?: Sensitivity;
  health?: JevHealth;
};

/** block = Not allowed · allow = Allowed (an exception that's never poaching). */
export type RuleKind = "block" | "allow";
export type ModerationRule = { id: string; kind: RuleKind; text: string };
/** A message labelled for Jev: typed in by the team, or kept from a review decision. */
export type ModerationExample = { id: string; kind: RuleKind; text: string; source: "owner" | "review"; createdAt: string };
/** Everything Jev is told on every check. customized = false while the store still uses the starter rules. */
export type ModerationPolicy = { rules: ModerationRule[]; examples: ModerationExample[]; customized: boolean };

export type ModerationResponse = {
  settings: ModerationSettingsView;
  flags: ModerationFlag[];
  counts: Record<FlagStatus, number>;
  policy?: ModerationPolicy;
};

export type ModerationSettingsRequest = { enabled?: boolean; muteAfter?: number; sensitivity?: Sensitivity };

/** PUT /community/moderation/rules — the whole list; it replaces the old one. At least one block rule. */
export type ModerationRulesRequest = { rules: { kind: RuleKind; text: string }[] };
/** POST /community/moderation/examples */
export type ModerationExampleRequest = { kind: RuleKind; text: string };

/** POST /community/moderation/test — try a message against the current rules; nothing is saved or hidden. */
export type ModerationTestRequest = { text: string };
export type ModerationTestResult = {
  /** allow = it would go through. null score = Jev didn't answer (see health). */
  verdict: "hide" | "review" | "allow";
  score: number | null;
  confidence: Confidence | null;
  reason: string | null;
  health: JevHealth;
};

/** A photo kept with a saved reply: a store-team upload, re-sent as-is (never uploaded twice). */
export type SavedReplyImage = { url: string; width: number | null; height: number | null };

/** A quick answer the store team saved; every admin with the community module shares one list. */
export type SavedReply = {
  id: string;
  /** Short name, also the "/title" shortcut in the composer. */
  title: string;
  /** May be empty when the reply is photos only. */
  body: string;
  /** Sent after the text, one photo message each, in this order. */
  images: SavedReplyImage[];
  createdBy: string;
  updatedBy: string;
  createdByKey: string;
  updatedByKey: string;
  createdAt: string;
  updatedAt: string;
};
/** Every read and write answers with the whole list (A→Z by title). */
export type SavedRepliesResponse = { replies: SavedReply[] };
/** `images`: urls from POST /community/uploads by the store team (sizes come from the upload records). */
export type SavedReplyRequest = { title: string; body: string; images?: { url: string }[] };
/**
 * restore = false alarm (message comes back, offense doesn't count) · confirm = keep it hidden
 * (or hide it now, for a flag held for review). teach (default true) keeps the message as an example for Jev.
 */
/** reopen = undo a review: pending again, the message back how the bot left it. Never teaches. */
export type FlagActionRequest = { action: "restore" | "confirm" | "reopen"; teach?: boolean };
/** exampleId: the example this review taught Jev (delete it to undo the lesson). */
export type FlagActionResult = { status: FlagStatus; exampleId?: string | null };
/** ban = out of the community AND the account can't sign in again; unban reverses both. */
export type MemberSanctionRequest = { action: "mute" | "unmute" | "ban" | "unban" };
