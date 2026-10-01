# Pepweb app — customers + community

Status: design, 2026-09-29. Extends [ARCHITECTURE.md](ARCHITECTURE.md).
Reference UI: `inspiration/mobileinspo` ("Pure Peps"), ported onto our API, not Supabase.

## What the user asked for

1. The inspiration's community features in our app — DMs, channels, topics,
   product drops — messaging first.
2. Customers register on the store's website and log in to the same app.
3. One login screen for everyone (owner, staff, customer).
4. The owner approves who joins the community.
5. Customer tabs: Community, Shop, My orders, in-app checkout.
6. UI/UX like the inspiration.

## Ownership boundary (two sessions)

| Owner | Scope |
|---|---|
| `feat/customer-accounts` | `StorefrontCustomer` model, web sign-up/sign-in, `sf.customer` cookie, `StorefrontOrder.customerAccountId` stamped at placement |
| this branch | mobile login for customers, community models + API, the app |

We only **read** `StorefrontCustomer`. Account status (`active`/`disabled`) and
`sessionVersion` are theirs. We add no approval column to it — community
approval is our own table, and it gates the community only.

## Identity

`MobileSession.subject` gains a third kind: `customer:<StorefrontCustomer.id>`.

- **Login** keeps the email + password flow. For each store the email belongs
  to, owner/staff credentials are tried first, then the store's customer
  account. Admin wins a tie on the same store.
- A customer login needs the store to hold `FEATURES.MOBILE_COMMUNITY`
  (operator-grantable, default OFF) and the account `status === "active"`.
- **Stamp** = hash(email, passwordHash, sessionVersion), re-checked every
  request, so a password change or disable on the website signs the phone out.
- `authenticateMobile` keeps meaning "admin": a customer session gets
  `forbidden` on every existing admin route. New wrappers:
  - `withCustomer` — customer sessions only (shop, my orders, checkout).
  - `withCommunity` — anyone in the community: approved customers, owner,
    staff with the `community` module.

`/me` returns `mode: "admin" | "customer"` and a `community` block
(`enabled`, `membership`, `isModerator`). The app picks its tab set from `mode`.

## Join mode (2026-09-30)

`branding.config.communityJoin` = `"open"` (default) | `"approval"`.

- **open** — every signed-in customer of the store is a member and can
  message right away. `admitCustomer()` (`src/lib/community/admission.server.ts`)
  runs on `/me` and on every community request: it creates the row as
  `approved` (`reviewedBy: "auto"`) or promotes a `pending` one. A rejected
  customer who re-applies goes straight back in. **Revoke** still removes
  anyone — that is the moderation tool in an open community.
- **approval** — the original flow below: first sign-in files a pending
  application the owner reviews.
- Moderators switch it on the Members screen ("Who can join";
  `PATCH /community/members { joinMode }`). Switching to open admits
  everyone waiting at once.
- The first visitor of any kind (not just a moderator) seeds the starter
  channels, created as the store, so a customer never lands in an empty community.

## Community model (Prisma, every row tenant-scoped)

- `CommunityMember` — one per customer: `displayName`, `bio`, `avatarHue`,
  `status pending|approved|rejected|revoked`, `reason`, review stamps.
  Created `pending` on the customer's first app sign-in.
- `CommunityChannel` — `name, description, emoji, imageUrl, postRole everyone|admins, sortOrder`.
- `CommunityTopic` — per channel, exactly one `isGeneral`; `isPinned`,
  `lastMessageAt`, `messageCount` maintained on write.
- `CommunityConversation` — DM between two participant keys (`lo < hi`),
  unique per tenant.
- `CommunityMessage` — one table for topics AND DMs (`topicId` xor
  `conversationId`); `kind text|image|file|product|protocol|drop|system`,
  attachment columns, `replyToId`, `editedAt`, `deletedAt`.
- `CommunityDrop` — product broadcast with `expiresAt`, `isActive`; posting
  one writes a `drop` message into the chosen channel's General topic.
- `CommunityRead` — server-side read marker per participant per thread, so
  unread badges agree across devices (the inspiration kept these on-device).

**Participant keys**: `c:<customerId>` for a customer, `store` for the store.
The owner and staff post as `store` — one shared store inbox — and each
message records the person who sent it (`authorKey owner | s:<staffId>`).
Customers see "<Store name>" with a team badge.

## Rules (server-enforced, mirrored from the inspiration)

- Channels: moderators create/edit/delete. Topics: anyone when `postRole =
  everyone`, else moderators; General is never deleted.
- Post: approved member or moderator; `admins` channels are moderator-only.
- Share: every member can attach a product (customers pick from the shop
  catalog) or a protocol (`GET /community/protocols`); the server rebuilds both cards.
- Edit: own text/caption, within 15 minutes, never a drop.
- Delete for everyone: sender, or a moderator in topics; sender only in DMs.
- Pending / rejected / revoked customers can shop but see no community data.

## Delivery

- Polling through React Query instead of Supabase realtime:
  - an open thread polls every 3 s while the app is foregrounded;
  - the inbox polls every 15 s.
  - This fits the existing API and Vercel with no socket infra; the endpoints
    take `after=<cursor>` so an SSE upgrade later is additive.
- Push via the existing Expo pipeline:
  - **DMs** go to the other participant's devices (the store's devices = owner
    + moderator staff).
  - **Drops** go to every approved member.
  - Topic messages don't push, same as the inspiration.
  - `MobilePushDevice.messages` is the opt-out flag.
- Attachments: `POST /community/uploads` → the tenant's ImageKit folder.
  Images max 10 MB, documents (pdf/doc/xls/ppt/txt/csv) max 25 MB.

## App shape

| Mode | Tabs |
|---|---|
| customer | Chats · Shop · Orders · Me (Chats hidden until approved; Me shows the membership card) |
| admin | Home · Orders · Products · **Chats** · More (+ Member approvals, New channel, Broadcast a drop) |

The visual system follows the inspiration: Inter UI, doodle wallpaper, bubbles,
Telegram-style rows and folders. The brand colour is the store's own `primary`
from `/me.theme`, not the inspiration's cerise.

## Phases

1. Customer login + `/me` mode + membership + approval API. Tests.
2. Community API: channels, topics, DMs, messages, reads, search, uploads, drops, push. Tests.
3. App: design tokens, customer shell, Chats, thread, composer, attachments,
   search, media, membership, approvals, channel/topic/drop management.
4. Shop, My orders, in-app checkout. **Blocked on `feat/customer-accounts`
   landing**, because it edits `placeStorefrontOrderAction`, which checkout must
   share (refactor to a tenant-parameterised core).

## Security follow-ups

Hardened on 2026-09-29: attachments and pictures must match a `CommunityUpload`
row of this tenant and participant, with metadata taken from that row. Also
added: per-person rate limits, a DM push throttle, device-token rebind rules,
constant-cost login and non-burning refresh. Still open:

- **MED-4 — login lockout keying.** The login limiter keys on `ip` and on
  `email` with scope `any` when no store is sent. It doesn't key per store the
  email belongs to, so one attacker can spread attempts across stores sharing an
  address. Revisit the keying (per candidate store + email) together with a
  shared limiter store.
- **MED-8 — RLS for the community tables.** `prisma/rls.sql` has no policies for
  `community_*` (nor `mobile_*` / `storefront_staff`). Isolation is currently
  enforced by `forTenant()` / `withTenant()` only. Add them to the tenant-table
  list once `app_user` exists on the live database.
- **Rate limits and the DM push throttle are in-memory** (per server
  instance, `lib/security/rate-limit.ts` and `push.server.ts`). Move both to a
  shared store (Redis / DB) before heavy traffic.
- **Search** uses `ILIKE` over `body`, filtered by `"tenantId"` and
  `"createdAt"` (`@@index([tenantId, createdAt])`). A `pg_trgm` GIN index on
  `community_messages.body` is the follow-up once the extension is approved.
- **Device rebind.** A token held by another account's LIVE session is refused
  until that session is signed out or expires (≤ 30 days). The app must sign
  out before switching accounts.

## Store link — which seller a customer's app belongs to (2026-09-30)

The app is shared by every store, so an install alone can't name the seller.

- **Seller shares** `https://<store>/app` (app: More → "Share your app link").
  That page (`src/app/(tenant)/(storefront)/app/page.tsx`) has download
  buttons (`NEXT_PUBLIC_MOBILE_IOS_URL` / `NEXT_PUBLIC_MOBILE_ANDROID_URL`), an
  **Open in the app** button → `pepwebadmin://store/<slug>`, and the store code
  as a fallback.
- **App**: `+native-intent.tsx` catches the link → `StoreLinkProvider`
  resolves it via public `GET /stores/:store` (`lib/mobile/store-preview.ts`)
  and remembers it (`pepweb.linkedStore.v1`, survives sign-out). Signed out,
  the app wears that store's theme; sign-in sends `store: <slug>`, so the
  server checks the login against that store only. "Add your store" on the
  sign-in screen takes a pasted link or code (post-install gap).
- A link to a different store while signed in → confirm, then sign out.
- The link is a hint only: the server resolves it again and the issued
  session is what binds the phone to the tenant.
- Not done: deferred deep linking (install → first open knows the store
  without a second tap), universal links (`applinks:*.<root>` + AASA).
