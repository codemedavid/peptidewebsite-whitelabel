// Self-contained test gate for the PER-TENANT TELEGRAM ORDER BOT — the store's
// own Telegram bot that announces every new order and lets an authorized person
// confirm it from the chat.
//
//   npm run test:telegram
//
// The rules this file exists to hold down:
//
//   • AUTHORIZATION IS A ROW, NOT A CHAT. A Telegram user may press Confirm only
//     when a linked recipient row for THAT tenant names their numeric user id and
//     carries canConfirm. A chat id typed into a form is never a credential, and
//     a recipient with no user id (a group) can never authorize a press — the
//     null-matches-null hole is the one that silently opens the store to anyone.
//   • THE BOT IS NOT A SECOND ORDER ENGINE. Confirming from Telegram must run the
//     same applyOrderStatusChange the store admin runs, so stock deduction, the
//     journey event and the customer email can never drift between the two doors.
//   • A PRESS IS IDEMPOTENT. Telegram retries updates; fingers double-tap. The
//     second confirm must move no stock.
//   • THE TOKEN NEVER COMES BACK OUT. The panel shows status, never the secret.
//   • AN ALERT FAILURE IS NOT A CHECKOUT FAILURE. Dispatch rides after(), inside
//     the created branch, and is total and silent like its email sibling.
//   • A GROUP CHAT IS A PUBLIC ROOM. With customer details off, the message keeps
//     the order but drops the buyer's identity and address.
//
// Covers: the message composer, the update interpreter, the authorization core,
// the pairing-code lifecycle, webhook-secret comparison, update dedupe, and
// source-level wiring for the pieces that live inside "use server" modules or a
// route handler and so cannot be imported here.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildOrderAlert,
  buildConfirmedText,
  confirmCallbackData,
  parseConfirmCallback,
  CALLBACK_DATA_MAX,
} from "../src/lib/integrations/telegram-message";
import { interpretTelegramUpdate } from "../src/lib/integrations/telegram-update";
import {
  findConfirmer,
  alertTargets,
  verifyWebhookSecret,
  recipientLinkDefaults,
  type LinkedRecipient,
} from "../src/lib/integrations/telegram-authz";
import {
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  generatePairingCode,
  normalizePairingCode,
  hashPairingCode,
  pairingUsable,
} from "../src/lib/integrations/telegram-pairing";
import { makeUpdateDeduper } from "../src/lib/integrations/telegram-dedupe";
import {
  buildWebhookUrl,
  webhookHostIssue,
} from "../src/lib/integrations/telegram-webhook-url";
import { planStatusChange } from "../src/lib/storefront/order-status";
import { orderTotal } from "../src/lib/analytics/events";
import type { Order } from "../src/storefront/types";

let failures = 0;
let checks = 0;

function ok(name: string, cond: boolean, detail?: string) {
  checks++;
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const src = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const ORDER: Order = {
  id: "clx0000000000000000000001",
  orderNumber: "HPG-1042",
  status: "new",
  paymentStatus: "paid",
  paymentMethod: "GCash",
  date: "2026-09-04T02:15:00.000Z",
  customer: {
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "09171234567",
    contactMethod: "messenger",
  },
  shipping: {
    address: "12 Mabini St",
    barangay: "Poblacion",
    city: "Davao City",
    province: "Davao del Sur",
    postal: "8000",
    country: "PH",
    region: "XI",
    fee: 120,
  },
  courier: "J&T",
  trackingNumber: "",
  shippingNote: "",
  items: [
    { name: "BPC-157 (10mg)", qty: 2, price: 1500, productId: "p1", variation: "10mg" },
    { name: "Bacteriostatic Water", qty: 1, price: 250, productId: "p2" },
  ],
  statusHistory: [{ status: "new", at: "2026-09-04T02:15:00.000Z" }],
  paymentProof: null,
};

console.log("telegram order bot — the store's own chat, and who is allowed to answer it\n");

// ── 1. The message composer ──────────────────────────────────────────────────
// Pure: an order in, a Telegram sendMessage payload out. It is the only place
// order facts become chat text, so the money and the escaping are settled here.
console.log("buildOrderAlert — the alert a store owner actually reads");

const alert = buildOrderAlert(ORDER, { currency: "PHP", showCustomerDetails: true });

ok("the order number leads the message", alert.text.includes("HPG-1042"));
ok("every line item is listed", alert.text.includes("BPC-157") && alert.text.includes("Bacteriostatic Water"));
ok("quantities are shown", /2\s*[x×]/i.test(alert.text));
ok(
  "the printed total is orderTotal() — the same number the email and admin show",
  alert.text.includes(
    orderTotal(ORDER).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ),
  `total was ${orderTotal(ORDER)}, text: ${alert.text}`,
);
ok("the shipping fee is not silently dropped from the total", orderTotal(ORDER) === 3370);
ok("the payment method is shown so the owner knows what to check", alert.text.includes("GCash"));
eq("the message is sent as HTML", alert.parse_mode, "HTML");

ok(
  "a new order carries a Confirm button",
  !!alert.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data.startsWith("confirm:")),
);

const confirmed = buildOrderAlert({ ...ORDER, status: "confirmed" }, { currency: "PHP", showCustomerDetails: true });
ok(
  "an already-confirmed order offers no Confirm button",
  !confirmed.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data.startsWith("confirm:")),
);

// Buyer-supplied text lands inside HTML. Escaping is not cosmetic here: an
// unescaped "<" breaks Telegram's parser and the whole alert fails to send.
const injected = buildOrderAlert(
  { ...ORDER, customer: { ...ORDER.customer, name: "<b>Bobby</b> <script>x</script>" } },
  { currency: "PHP", showCustomerDetails: true },
);
ok("a buyer's angle brackets are escaped, never rendered as markup", injected.text.includes("&lt;b&gt;Bobby&lt;/b&gt;"));
ok("no raw script tag survives into the message", !injected.text.includes("<script>"));

const injectedItem = buildOrderAlert(
  { ...ORDER, items: [{ name: "Peptide <img src=x>", qty: 1, price: 100 }] },
  { currency: "PHP", showCustomerDetails: true },
);
ok("a product name is escaped too", !injectedItem.text.includes("<img"));

// ── 2. A group chat is a public room ─────────────────────────────────────────
console.log("\nbuildOrderAlert — customer details are a per-recipient decision");

const redacted = buildOrderAlert(ORDER, { currency: "PHP", showCustomerDetails: false });
ok("the order number still shows", redacted.text.includes("HPG-1042"));
ok("the items still show", redacted.text.includes("BPC-157"));
ok(
  "the total still shows",
  redacted.text.includes(
    orderTotal(ORDER).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ),
);
ok("the buyer's name is withheld", !redacted.text.includes("Maria Santos"));
ok("the buyer's phone is withheld", !redacted.text.includes("09171234567"));
ok("the buyer's email is withheld", !redacted.text.includes("maria@example.com"));
ok("the street address is withheld", !redacted.text.includes("12 Mabini St"));
ok("a Confirm button is still offered — redaction is about PII, not power", 
  !!redacted.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data.startsWith("confirm:")));

// ── 3. Callback data — Telegram's 64-byte wall ───────────────────────────────
console.log("\ncallback_data — the 64-byte budget Telegram enforces");

const cb = confirmCallbackData(ORDER.id) ?? "";
ok("callback data round-trips to the order id", parseConfirmCallback(cb) === ORDER.id);
ok(
  "callback data fits Telegram's 64-byte limit",
  Buffer.byteLength(cb, "utf8") <= CALLBACK_DATA_MAX,
  `${Buffer.byteLength(cb, "utf8")} bytes`,
);
eq("an unrelated callback parses to null", parseConfirmCallback("cancel:abc"), null);
eq("junk parses to null, never a bare id", parseConfirmCallback("confirm:"), null);
eq("a non-string parses to null", parseConfirmCallback(undefined), null);
ok(
  "an over-long id is refused rather than silently truncated into another order's id",
  confirmCallbackData("x".repeat(200)) === null,
);

// ── 4. The update interpreter ────────────────────────────────────────────────
// Telegram posts arbitrary JSON. This is the one place it becomes a typed
// intent, so every shape below has to land somewhere safe.
console.log("\ninterpretTelegramUpdate — untrusted JSON becomes a typed intent");

eq("undefined is ignored", interpretTelegramUpdate(undefined).kind, "ignore");
eq("null is ignored", interpretTelegramUpdate(null).kind, "ignore");
eq("a string is ignored", interpretTelegramUpdate("hello").kind, "ignore");
eq("an empty object is ignored", interpretTelegramUpdate({}).kind, "ignore");

const pairUpdate = {
  update_id: 900001,
  message: {
    message_id: 5,
    chat: { id: 123456789, type: "private" },
    from: { id: 555, username: "storeowner", first_name: "Yna" },
    text: "/start K7M2P9QF",
  },
};
const pair = interpretTelegramUpdate(pairUpdate);
eq("/start with a code is a pair intent", pair.kind, "pair");
if (pair.kind === "pair") {
  eq("the pairing code is carried", pair.code, "K7M2P9QF");
  eq("the chat id is captured as a string", pair.chatId, "123456789");
  eq("the chat type is captured", pair.chatType, "private");
  eq("the telegram user id is captured as a string", pair.telegramUserId, "555");
  eq("a label is derived for the recipient list", pair.label, "@storeowner");
}

eq(
  "a lowercase code is normalized on the way in",
  (() => {
    const r = interpretTelegramUpdate({ ...pairUpdate, message: { ...pairUpdate.message, text: "/start k7m2p9qf" } });
    return r.kind === "pair" ? r.code : null;
  })(),
  "K7M2P9QF",
);
eq(
  "/start with no code is ignored — it cannot link anything",
  interpretTelegramUpdate({ ...pairUpdate, message: { ...pairUpdate.message, text: "/start" } }).kind,
  "ignore",
);
eq(
  "a bot-suffixed command still pairs (/start@mybot CODE)",
  (() => {
    const r = interpretTelegramUpdate({
      ...pairUpdate,
      message: { ...pairUpdate.message, text: "/start@hpglowbot K7M2P9QF" },
    });
    return r.kind;
  })(),
  "pair",
);
eq(
  "ordinary chatter is ignored",
  interpretTelegramUpdate({ ...pairUpdate, message: { ...pairUpdate.message, text: "hello there" } }).kind,
  "ignore",
);
eq(
  "/unlink is its own intent",
  interpretTelegramUpdate({ ...pairUpdate, message: { ...pairUpdate.message, text: "/unlink" } }).kind,
  "unlink",
);

const confirmUpdate = {
  update_id: 900002,
  callback_query: {
    id: "cbq-1",
    from: { id: 555, username: "storeowner" },
    message: { message_id: 42, chat: { id: 123456789, type: "private" } },
    data: `confirm:${ORDER.id}`,
  },
};
const conf = interpretTelegramUpdate(confirmUpdate);
eq("a confirm callback is a confirm intent", conf.kind, "confirm");
if (conf.kind === "confirm") {
  eq("the order id is carried", conf.orderId, ORDER.id);
  eq("the callback id is carried so it can be answered", conf.callbackId, "cbq-1");
  eq("the pressing user is carried", conf.telegramUserId, "555");
  eq("the message id is carried so the button can be retired", conf.messageId, 42);
  eq("the chat id is carried", conf.chatId, "123456789");
}
eq(
  "an unknown callback action is ignored, not guessed",
  interpretTelegramUpdate({ ...confirmUpdate, callback_query: { ...confirmUpdate.callback_query, data: "delete:1" } }).kind,
  "ignore",
);
eq(
  "a callback with no from-user is ignored — there is nobody to authorize",
  interpretTelegramUpdate({
    ...confirmUpdate,
    callback_query: { ...confirmUpdate.callback_query, from: undefined },
  }).kind,
  "ignore",
);
eq("the update id is always surfaced for dedupe", interpretTelegramUpdate(confirmUpdate).updateId, 900002);

// ── 5. Authorization — the heart of the feature ──────────────────────────────
console.log("\nfindConfirmer — only a named, linked, confirm-granted user may press");

const OWNER: LinkedRecipient = { chatId: "111", telegramUserId: "555", canConfirm: true, label: "@storeowner" };
const STAFF: LinkedRecipient = { chatId: "222", telegramUserId: "777", canConfirm: false, label: "@packer" };
const GROUP: LinkedRecipient = { chatId: "-1009999", telegramUserId: null, canConfirm: true, label: "Orders group" };
const ROSTER = [OWNER, STAFF, GROUP];

eq("a linked owner with canConfirm is authorized", findConfirmer(ROSTER, "555")?.chatId ?? null, "111");
eq("a linked recipient WITHOUT canConfirm is refused", findConfirmer(ROSTER, "777"), null);
eq("an unlinked stranger is refused", findConfirmer(ROSTER, "999"), null);
eq("an empty roster authorizes nobody", findConfirmer([], "555"), null);
// The hole that matters: a group row has no user id. If null were allowed to
// match a missing/blank presser, anyone in any chat could confirm.
eq("a null user id never matches a null presser", findConfirmer(ROSTER, null), null);
eq("a null user id never matches an empty presser", findConfirmer(ROSTER, ""), null);
eq("a null user id never matches the literal string 'null'", findConfirmer(ROSTER, "null"), null);
eq(
  "ids are compared as strings, not coerced numbers ('0555' is not 555)",
  findConfirmer([{ chatId: "111", telegramUserId: "555", canConfirm: true, label: "x" }], "0555"),
  null,
);

// A GROUP is a delivery target; authorization is a PERSON. Telegram reports
// callback_query.from.id even in a group, so the person who linked the chat is
// known and can be held responsible for a press. Discarding that id (the first
// cut of this feature did) refused EVERYONE in the group — including the owner
// who linked it — which is not "only specific users can confirm", it is "nobody
// can". PII redaction is a separate question and still defaults off for groups.
console.log("\nrecipientLinkDefaults — what a freshly linked chat is allowed to do");

eq(
  "a private chat records the person who linked it",
  recipientLinkDefaults("private", "555").telegramUserId,
  "555",
);
ok("a private chat sees customer details", recipientLinkDefaults("private", "555").showCustomerDetails);

eq(
  "a GROUP also records the person who linked it — they may confirm from it",
  recipientLinkDefaults("group", "555").telegramUserId,
  "555",
);
eq(
  "a supergroup is treated the same as a group",
  recipientLinkDefaults("supergroup", "555").telegramUserId,
  "555",
);
ok(
  "a group withholds customer details by default — PII is a separate concern",
  !recipientLinkDefaults("group", "555").showCustomerDetails,
);
eq(
  "a link with no identifiable user stores NULL, so nobody can confirm from it",
  recipientLinkDefaults("channel", "").telegramUserId,
  null,
);

// The end-to-end shape of the bug: the owner links the group, an order lands,
// the owner presses Confirm. That must work.
const linkedGroup: LinkedRecipient = {
  chatId: "-5492326320",
  ...recipientLinkDefaults("group", "555"),
  label: "@codemedavid",
};
eq(
  "the owner who linked a group CAN confirm from that group",
  findConfirmer([linkedGroup], "555")?.chatId ?? null,
  "-5492326320",
);
eq(
  "another member of that same group still cannot",
  findConfirmer([linkedGroup], "999"),
  null,
);

console.log("\nalertTargets — who hears about a new order");
eq("every linked chat is a target, confirm rights or not", alertTargets(ROSTER).sort(), ["-1009999", "111", "222"]);
eq("no recipients means no targets", alertTargets([]), []);

console.log("\nverifyWebhookSecret — a forged update gets nowhere");
ok("the matching secret passes", verifyWebhookSecret("s3cr3t-value", "s3cr3t-value"));
ok("a wrong secret fails", !verifyWebhookSecret("wrong", "s3cr3t-value"));
ok("a missing provided secret fails", !verifyWebhookSecret(null, "s3cr3t-value"));
ok("an empty expected secret fails closed — never 'anything matches nothing'", !verifyWebhookSecret("", ""));
ok("a length-mismatched secret fails without throwing", !verifyWebhookSecret("short", "muchlongersecret"));

// ── 6. Pairing codes ─────────────────────────────────────────────────────────
console.log("\npairing codes — the one-time key that links a chat");

const code = generatePairingCode();
eq("a code is the declared length", code.length, PAIRING_CODE_LENGTH);
ok("a code uses an unambiguous alphabet (no 0/O/1/I)", !/[01OI]/.test(code));
ok("a code is uppercase alphanumeric", /^[A-Z2-9]+$/.test(code));

const many = new Set(Array.from({ length: 500 }, () => generatePairingCode()));
ok("codes do not collide in bulk", many.size > 495, `${many.size}/500 unique`);

eq("normalization uppercases", normalizePairingCode("k7m2p9qf"), "K7M2P9QF");
eq("normalization strips spaces a phone keyboard adds", normalizePairingCode(" K7M2 P9QF "), "K7M2P9QF");
eq("normalization drops junk rather than passing it to the DB", normalizePairingCode("K7M2-P9QF!"), "K7M2P9QF");
eq("a non-string normalizes to empty", normalizePairingCode(undefined), "");

const hash = hashPairingCode("K7M2P9QF");
ok("the hash is not the plaintext code", hash !== "K7M2P9QF" && !hash.includes("K7M2P9QF"));
eq("hashing is stable", hashPairingCode("K7M2P9QF"), hash);
eq("hashing normalizes first, so case can never lock a user out", hashPairingCode("k7m2p9qf"), hash);
ok("different codes hash differently", hashPairingCode("AAAAAAAA") !== hash);

const NOW = 1_757_000_000_000;
ok(
  "a fresh, unused code is usable",
  pairingUsable({ expiresAt: new Date(NOW + 60_000), usedAt: null }, NOW),
);
ok(
  "an expired code is refused",
  !pairingUsable({ expiresAt: new Date(NOW - 1), usedAt: null }, NOW),
);
ok(
  "an already-used code is refused — a link cannot be replayed",
  !pairingUsable({ expiresAt: new Date(NOW + 60_000), usedAt: new Date(NOW - 10) }, NOW),
);
ok("a missing row is refused", !pairingUsable(null, NOW));
ok("the TTL is short enough to be a one-time key", PAIRING_TTL_MS <= 15 * 60_000 && PAIRING_TTL_MS >= 60_000);

// ── 7. Update dedupe ─────────────────────────────────────────────────────────
// Telegram redelivers an update until it gets a 200. We always answer 200, but
// a redelivery can still arrive; a second Confirm must not re-run the handler.
console.log("\nmakeUpdateDeduper — a redelivered update is handled once");

const dedupe = makeUpdateDeduper(4);
ok("the first sighting is new", dedupe.seen(1) === false);
ok("the same update is a repeat", dedupe.seen(1) === true);
ok("a different update is new", dedupe.seen(2) === false);
dedupe.seen(3);
dedupe.seen(4);
dedupe.seen(5); // evicts 1
ok("memory is bounded — the oldest id is forgotten", dedupe.seen(1) === false);
ok("a recent id is still remembered", dedupe.seen(5) === true);

// ── 7b. The webhook URL Telegram will accept ─────────────────────────────────
// Telegram only calls back to public HTTPS on 80/88/443/8443. A dev host
// (lvh.me:3100) fails ALL of that, and handing it over anyway produced a
// cryptic "bad webhook" from Telegram after the token had already been stored.
// Better to know before the call, so the panel can say what is actually wrong.
console.log("\nwebhook URL — refuse a doomed registration before Telegram does");

eq(
  "a production host builds a clean https URL",
  buildWebhookUrl("app.pepweb.store", "abc123"),
  "https://app.pepweb.store/api/webhooks/telegram/abc123",
);
eq("a production host has no issue", webhookHostIssue("app.pepweb.store"), null);
eq("an explicit :443 is fine", webhookHostIssue("app.pepweb.store:443"), null);
eq("port 8443 is fine", webhookHostIssue("app.pepweb.store:8443"), null);

ok(
  "the dev host is refused for its port",
  (webhookHostIssue("app.lvh.me:3100") ?? "").includes("3100"),
  `got ${webhookHostIssue("app.lvh.me:3100")}`,
);
ok("localhost is refused", !!webhookHostIssue("localhost:3100"));
ok("a bare loopback name is refused even on 443", !!webhookHostIssue("localhost"));
ok("127.0.0.1 is refused", !!webhookHostIssue("127.0.0.1"));
ok("an unset host is refused rather than building https:///…", !!webhookHostIssue(""));
ok(
  "a .local host is refused — Telegram cannot resolve it",
  !!webhookHostIssue("mymac.local"),
);
ok(
  "the refusal names the requirement, so the operator knows what to change",
  /80|443|public/i.test(webhookHostIssue("app.lvh.me:3100") ?? ""),
);

// ── 8. Confirming twice moves stock once ─────────────────────────────────────
// The Telegram door reuses planStatusChange through applyOrderStatusChange, so
// the guarantee is the same one the admin has. Proven here on the shared core.
console.log("\nidempotency — a double press deducts once");

const first = planStatusChange(
  { status: "new", statusHistory: [{ status: "new", at: "2026-09-04T02:15:00.000Z" }] },
  "confirmed",
  "2026-09-04T02:20:00.000Z",
);
eq("the first confirm deducts stock", first.move, "deduct");
ok("the first confirm is a real change", first.changed);

const second = planStatusChange(
  { status: "confirmed", statusHistory: first.statusHistory },
  "confirmed",
  "2026-09-04T02:21:00.000Z",
);
eq("the second confirm moves no stock", second.move, null);
ok("the second confirm appends no journey event", !second.changed);
eq("the journey did not grow", second.statusHistory.length, first.statusHistory.length);

// ── 9. Wiring that lives in server-only modules ──────────────────────────────
console.log("\nwiring — the parts that cannot be imported here");

const orders = src("src/actions/orders.ts");
ok(
  "checkout dispatches the telegram alert",
  /sendTelegramOrderAlert/.test(orders),
);
ok(
  "the alert rides after() so it never blocks or breaks checkout",
  /after\(\(\)\s*=>\s*sendTelegramOrderAlert/.test(orders),
);
ok(
  "the alert sits beside its email sibling inside the created branch",
  orders.indexOf("sendTelegramOrderAlert") > orders.indexOf("sendAdminOrderNotification"),
);
ok(
  "the single-order admin update delegates to the shared status engine",
  /applyOrderStatusChange/.test(orders),
);

const engine = src("src/lib/orders/apply-status.ts");
ok("the shared engine plans the change rather than re-deriving it", /planStatusChange/.test(engine));
ok("the shared engine applies the stock move", /applyOrderStockMove/.test(engine));
ok("the shared engine still emits the customer status email", /buildStatusChangedPayload/.test(engine));
ok("the shared engine respects the trash filter", /ACTIVE_ORDERS_WHERE/.test(engine));
ok(
  "the shared engine carries NO cookie/session guard — it is actor-agnostic",
  !/requireStaffPermission|requireStoreOwner|getStorefrontAdminActor/.test(engine),
);

const route = src("src/app/api/webhooks/telegram/[secret]/route.ts");
ok("the webhook runs on node (prisma + crypto)", /runtime\s*=\s*"nodejs"/.test(route));
ok("the webhook verifies the telegram secret header", /verifyWebhookSecret/.test(route));
ok("the webhook authorizes the presser before acting", /findConfirmer/.test(route));
ok(
  "the webhook confirms through the shared engine, not its own update",
  /applyOrderStatusChange/.test(route) && !/storefrontOrder\.updateMany/.test(route),
);
ok("the webhook dedupes redelivered updates", /seen\(/.test(route));

const notify = src("src/lib/integrations/telegram-notify.ts");
ok("dispatch is gated on the entitlement", /NOTIFY_TELEGRAM/.test(notify));
ok("dispatch is gated on the integration being enabled", /enabled/.test(notify));
ok(
  "dispatch is total and silent — a bot failure never surfaces to checkout",
  /catch\s*\{/.test(notify),
);

const store = src("src/lib/integrations/telegram-store.ts");
ok("the bot token is sealed with the envelope, never stored plain", /encryptSecret/.test(store));
ok("reads go through withTenant so tenant scoping applies", /withTenant/.test(store));
ok(
  "linking uses the shared defaults, so the group rule lives in one place",
  /recipientLinkDefaults/.test(store),
);
ok(
  "the status shape returned to the panel carries no token field",
  !/botToken:\s*(row|token|creds)/.test(store),
);

// The bot is OPERATOR infrastructure, not a store-owner setting. It carries a
// credential that can read every message the bot receives and post as the store,
// and pointing it at the wrong webhook silently breaks a tenant — so setup lives
// in the super admin, beside the tenant's other third-party credentials, and the
// storefront admin has no Telegram surface at all.
const actions = src("src/actions/admin-telegram.ts");
ok("every telegram action requires a platform session", /getPlatformUser/.test(actions));
ok(
  "no telegram action is reachable with a store-owner session",
  !/requireStoreOwner|requireStaffPermission|getStorefrontAdminActor/.test(actions),
);
ok(
  "actions are addressed by tenant slug — the operator acts ON a tenant, not AS one",
  /slug:\s*string/.test(actions),
);
ok(
  "no action returns the token to the client",
  !/return\s*\{[^}]*botToken/.test(actions),
);
ok(
  "the action refuses an unreachable webhook host before calling Telegram",
  /webhookHostIssue/.test(actions),
);
ok(
  "the webhook can be re-registered without re-pasting the token",
  /registerTelegramWebhookAction/.test(actions),
);

const integrations = src("src/app/(platform)/admin/tenants/[slug]/integrations/page.tsx");
ok("the operator's integrations page carries the bot setup", /Telegram/.test(integrations));

const botPanel = src("src/components/admin/AdminTelegramBot.tsx");
ok("the operator panel connects a bot", /saveTelegramTokenAction/.test(botPanel));
ok("the operator panel mints linking codes", /createTelegramPairingAction/.test(botPanel));
ok("the operator panel manages recipients", /unlinkTelegramRecipientAction/.test(botPanel));

// The negative half of the requirement, asserted three ways so the surface
// cannot creep back in through any one of them.
const visibility = src("src/storefront/visibility.ts");
ok(
  "the storefront admin has NO telegram module",
  !/telegram/i.test(visibility),
);

const nav = src("src/storefront/admin/admin-nav.ts");
ok("the store-owner sidebar offers no telegram tool", !/telegram/i.test(nav));

const adminPage = src("src/storefront/admin/AdminPage.tsx");
ok("the storefront admin registers no telegram view", !/telegram/i.test(adminPage));

const catalog = src("src/lib/features/catalog.ts");
ok(
  "the telegram entitlement is operator-grantable on any plan",
  /OPERATOR_GRANTABLE[\s\S]*FEATURES\.NOTIFY_TELEGRAM/.test(catalog),
);

const tenantClient = src("src/lib/db/tenant-client.ts");
ok("the recipient model is tenant-scoped", /telegramRecipient/.test(tenantClient));
ok("the pairing model is tenant-scoped", /telegramPairing/.test(tenantClient));

const schema = src("prisma/schema.prisma");
ok("a recipient model exists", /model TelegramRecipient/.test(schema));
ok("a pairing model exists", /model TelegramPairing/.test(schema));
ok("a chat can only be linked once per tenant", /@@unique\(\[tenantId, chatId\]\)/.test(schema));
ok("the pairing code is stored hashed, never plain", /codeHash/.test(schema) && !/codePlain/.test(schema));

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${checks} checks, ${failures} failure(s)`);
if (failures > 0) process.exit(1);
