/**
 * Pure-core gate for the Expo app's in-app SHOP (mobile/src/features/shop/lib).
 * No React Native, no network: the cart, catalog view, checkout form and
 * order-timeline rules the shop screens are built on.
 *
 *   npm run test:mobile-shop-core
 */
import assert from "node:assert";

import type { ShopCheckoutConfig, ShopOrder, ShopProduct, ShopQuote } from "../src/lib/mobile/shop-contract";
import {
  cardPrice,
  categoryChips,
  defaultOption,
  filterProducts,
  findOption,
  galleryFor,
  isMarkedDown,
  isSoldOut,
  maxQtyFor,
  optionsFor,
  railProducts,
  sizedImage,
  stockState,
} from "../mobile/src/features/shop/lib/catalog";
import {
  addLine,
  buyableLines,
  cartCount,
  issueCopy,
  lineKey,
  MAX_CART_LINES,
  parseStoredCart,
  qtyInCart,
  reconcileCart,
  removeLine,
  sameLines,
  serializeCart,
  setLineQty,
  type CartLine,
} from "../mobile/src/features/shop/lib/cart";
import {
  checkoutError,
  isPayLater,
  emptyForm,
  locationsFor,
  newAttemptId,
  orderRequest,
  pickCourier,
  proofRequired,
  quoteRequest,
  withDefaults,
} from "../mobile/src/features/shop/lib/checkout";
import { itemsLabel, orderItemCount, orderSubtotal, orderTimeline } from "../mobile/src/features/shop/lib/orders";
import { minus, money } from "../mobile/src/features/shop/lib/money";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

function product(over: Partial<ShopProduct> = {}): ShopProduct {
  return {
    id: "p1",
    name: "BPC-157",
    category: "c1",
    description: "",
    image: "https://ik.imagekit.io/x/a.jpg",
    extraImages: [],
    price: 1000,
    compareAtPrice: null,
    stock: 10,
    purchasable: true,
    isGroupBuy: false,
    baseSelectable: true,
    variations: [],
    ...over,
  };
}

const VARIED = product({
  id: "p2",
  name: "Tirzepatide",
  baseSelectable: false,
  variations: [
    { name: "10mg", price: 2500, compareAtPrice: 3000, stock: 0, image: "https://ik.imagekit.io/x/10.jpg" },
    { name: "20mg", price: 4000, compareAtPrice: null, stock: 3, image: null },
  ],
});

const CHECKOUT: ShopCheckoutConfig = {
  paymentMethods: [
    { id: "gcash", name: "GCash", account: "Ana", number: "0917", qrImage: "", qrph: false },
    { id: "bank", name: "Bank", account: "Ana", number: "123", qrImage: "", qrph: false },
  ],
  requireProofOfPayment: true,
  couriers: [
    { id: "jnt", name: "J&T", needsLocation: true },
    { id: "cod", name: "Lalamove COD", needsLocation: false },
  ],
  shippingLocations: [
    { id: "luzon", courierId: "jnt", name: "Luzon", fee: 150 },
    { id: "vis", courierId: "jnt", name: "Visayas", fee: 200 },
  ],
  note: "",
  title: "",
  customerNoteEnabled: true,
  customerNoteLabel: "Note",
};

const QUOTE: ShopQuote = {
  items: [{ name: "BPC-157", qty: 2, price: 1000 }],
  subtotal: 2000,
  shippingFee: 150,
  courier: "J&T",
  adminFee: { label: "Admin fee", amount: 25 },
  paymentFee: null,
  discount: null,
  total: 2175,
};

section("catalog view");
test("a plain product has one option: its base", () => {
  const opts = optionsFor(product());
  assert.equal(opts.length, 1);
  assert.equal(opts[0].variation, undefined);
  assert.equal(opts[0].price, 1000);
});
test("variations only, when the base isn't sold on its own", () => {
  const opts = optionsFor(VARIED);
  assert.deepEqual(opts.map((o) => o.label), ["10mg", "20mg"]);
});
test("a selectable base is offered as 'Standard' beside the variations", () => {
  const p = product({ variations: [{ name: "Kit", price: 9000, compareAtPrice: null, stock: 1, image: null }] });
  assert.deepEqual(optionsFor(p).map((o) => o.label), ["Standard", "Kit"]);
});
test("the page opens on the first option in stock", () => {
  assert.equal(defaultOption(VARIED)?.variation, "20mg");
});
test("findOption matches by variation name (undefined = base)", () => {
  assert.equal(findOption(VARIED, "20mg")?.price, 4000);
  assert.equal(findOption(VARIED, undefined), null, "no base option on a variations-only product");
  assert.equal(findOption(product(), undefined)?.price, 1000);
});
test("stock states: sold out, low, in stock, made to order", () => {
  assert.equal(stockState(0).kind, "out");
  assert.equal(stockState(3).label, "Only 3 left");
  assert.equal(stockState(50).kind, "in");
  assert.equal(stockState(null).kind, "untracked");
});
test("maxQty follows stock, capped at the server's 999", () => {
  assert.equal(maxQtyFor({ stock: 4 }), 4);
  assert.equal(maxQtyFor({ stock: null }), 999);
  assert.equal(maxQtyFor({ stock: -2 }), 0);
});
test("markdowns only show when the compare-at price is higher", () => {
  assert.equal(isMarkedDown(100, 120), true);
  assert.equal(isMarkedDown(100, 100), false);
  assert.equal(isMarkedDown(100, null), false);
});
test("card price: cheapest option, 'From' only when options differ", () => {
  assert.deepEqual(cardPrice(VARIED), { price: 2500, compareAtPrice: 3000, from: true });
  assert.deepEqual(cardPrice(product()), { price: 1000, compareAtPrice: null, from: false });
});
test("gallery: the chosen option's photo first, no duplicates", () => {
  const p = { ...VARIED, extraImages: ["https://ik.imagekit.io/x/a.jpg", "https://ik.imagekit.io/x/b.jpg"] };
  const g = galleryFor(p, findOption(p, "10mg"));
  assert.deepEqual(g, ["https://ik.imagekit.io/x/10.jpg", "https://ik.imagekit.io/x/a.jpg", "https://ik.imagekit.io/x/b.jpg"]);
  assert.deepEqual(galleryFor(product({ image: null })), []);
});
test("sold out = every option sold out", () => {
  assert.equal(isSoldOut(VARIED), false);
  assert.equal(isSoldOut(product({ stock: 0 })), true);
});
test("category chips: All + only categories with products", () => {
  const chips = categoryChips({
    categories: [
      { id: "c1", label: "Peptides" },
      { id: "c9", label: "Empty" },
    ],
    products: [product()],
  });
  assert.deepEqual(chips.map((c) => c.key), ["all", "c1"]);
});
test("search matches every word across name and option names", () => {
  const list = [product(), VARIED];
  assert.deepEqual(filterProducts(list, "tirz 20mg", "all").map((p) => p.id), ["p2"]);
  assert.deepEqual(filterProducts(list, "", "c1").length, 2);
  assert.deepEqual(filterProducts(list, "bpc", "c9"), []);
});
test("chats product rail: buyable products only, owner's order, capped", () => {
  const list = [
    product({ id: "a" }),
    product({ id: "gone", stock: 0 }),
    product({ id: "b", purchasable: false }),
    product({ id: "c" }),
    product({ id: "d", stock: null }),
  ];
  assert.deepEqual(railProducts(list).map((p) => p.id), ["a", "c", "d"]);
  assert.deepEqual(railProducts(list, 2).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(railProducts([]), []);
  const many = Array.from({ length: 30 }, (_, i) => product({ id: `p${i}` }));
  assert.equal(railProducts(many).length, 12);
});
test("ImageKit URLs are sized; others pass through untouched", () => {
  assert.equal(sizedImage("https://ik.imagekit.io/x/a.jpg", 300), "https://ik.imagekit.io/x/a.jpg?tr=w-300,q-75,f-auto");
  assert.equal(sizedImage("https://ik.imagekit.io/x/a.jpg?v=2#f", 300), "https://ik.imagekit.io/x/a.jpg?v=2&tr=w-300,q-75,f-auto#f");
  assert.equal(sizedImage("https://ik.imagekit.io/x/a.jpg?tr=w-50", 300), "https://ik.imagekit.io/x/a.jpg?tr=w-50");
  assert.equal(sizedImage("https://evil.test/?u=ik.imagekit.io", 300), "https://evil.test/?u=ik.imagekit.io");
  assert.equal(sizedImage("data:image/png;base64,AA", 300), "data:image/png;base64,AA");
  assert.equal(sizedImage(null, 300), null);
});

section("cart");
test("adding merges the same option and clamps to the max", () => {
  let r = addLine([], { productId: "p1", qty: 2 }, 5);
  assert.equal(r.added, 2);
  r = addLine(r.lines, { productId: "p1", qty: 9 }, 5);
  assert.equal(r.lines[0].qty, 5);
  assert.equal(r.added, 3);
  assert.equal(r.capped, true);
});
test("variations are separate lines", () => {
  let lines: CartLine[] = addLine([], { productId: "p2", variation: "10mg", qty: 1 }).lines;
  lines = addLine(lines, { productId: "p2", variation: "20mg", qty: 1 }).lines;
  assert.equal(lines.length, 2);
  assert.equal(qtyInCart(lines, "p2", "20mg"), 1);
  assert.equal(cartCount(lines), 2);
});
test("adding when nothing is left adds nothing and keeps the same array", () => {
  const lines = [{ productId: "p1", qty: 3 }];
  const r = addLine(lines, { productId: "p1", qty: 1 }, 3);
  assert.equal(r.added, 0);
  assert.equal(r.lines, lines);
});
test("adding never mutates the input", () => {
  const lines = [{ productId: "p1", qty: 1 }];
  addLine(lines, { productId: "p1", qty: 1 });
  assert.equal(lines[0].qty, 1);
});
test("the cart holds at most the server's line limit", () => {
  let lines: CartLine[] = [];
  for (let i = 0; i < MAX_CART_LINES + 3; i++) lines = addLine(lines, { productId: `p${i}`, qty: 1 }).lines;
  assert.equal(lines.length, MAX_CART_LINES);
});
test("setLineQty clamps, and 0 removes", () => {
  const lines = [{ productId: "p1", qty: 2 }];
  assert.equal(setLineQty(lines, "p1::", 7, 4)[0].qty, 4);
  assert.deepEqual(setLineQty(lines, "p1::", 0), []);
  assert.deepEqual(removeLine(lines, lineKey(lines[0])), []);
});
test("stored carts round-trip and junk is dropped", () => {
  const lines = [{ productId: "p1", qty: 2 }, { productId: "p2", variation: "20mg", qty: 1 }];
  assert.deepEqual(parseStoredCart(serializeCart(lines)), lines);
  assert.deepEqual(parseStoredCart("{nope"), []);
  assert.deepEqual(parseStoredCart(null), []);
  assert.deepEqual(parseStoredCart(JSON.stringify([{ productId: "", qty: 1 }, { productId: "x", qty: 0 }, { productId: "y", qty: 2 }])), [
    { productId: "y", qty: 2 },
  ]);
});
test("reconcile clamps to stock and flags gone / sold-out lines", () => {
  const catalog = { products: [product({ stock: 2 }), VARIED] };
  const { rows, lines } = reconcileCart(
    [
      { productId: "p1", qty: 5 },
      { productId: "p2", variation: "10mg", qty: 1 },
      { productId: "gone", qty: 1 },
    ],
    catalog,
  );
  assert.equal(lines[0].qty, 2);
  assert.deepEqual(rows.map((r) => r.issue), ["reduced", "soldOut", "missing"]);
  assert.deepEqual(buyableLines(rows), [{ productId: "p1", qty: 2 }]);
  assert.match(issueCopy("reduced", 2) ?? "", /Only 2 left/);
});
test("an unbuyable product (closed store, paused) is flagged, not dropped", () => {
  const { rows } = reconcileCart([{ productId: "p1", qty: 1 }], { products: [product({ purchasable: false })] });
  assert.equal(rows[0].issue, "unavailable");
  assert.deepEqual(buyableLines(rows), []);
});
test("sameLines ignores order", () => {
  assert.equal(sameLines([{ productId: "a", qty: 1 }, { productId: "b", qty: 2 }], [{ productId: "b", qty: 2 }, { productId: "a", qty: 1 }]), true);
  assert.equal(sameLines([{ productId: "a", qty: 1 }], [{ productId: "a", qty: 2 }]), false);
});

section("checkout");
test("the only courier / location / method is pre-picked", () => {
  const one: ShopCheckoutConfig = { ...CHECKOUT, couriers: [CHECKOUT.couriers[0]], paymentMethods: [CHECKOUT.paymentMethods[0]], shippingLocations: [CHECKOUT.shippingLocations[0]] };
  const f = withDefaults(emptyForm(), one);
  assert.deepEqual([f.courierId, f.locationId, f.paymentMethodId], ["jnt", "luzon", "gcash"]);
  const many = withDefaults(emptyForm(), CHECKOUT);
  assert.deepEqual([many.courierId, many.paymentMethodId], ["", ""]);
});
test("locations belong to their courier; switching courier drops a stale one", () => {
  assert.equal(locationsFor(CHECKOUT, "jnt").length, 2);
  assert.equal(locationsFor(CHECKOUT, "cod").length, 0);
  const f = pickCourier({ ...emptyForm(), courierId: "jnt", locationId: "vis" }, CHECKOUT, "cod");
  assert.equal(f.locationId, "");
});
test("checkout errors come in form order, then clear", () => {
  let f = emptyForm();
  assert.equal(checkoutError(f, CHECKOUT), "Please enter your name.");
  f = { ...f, name: "Ana", email: "bad" };
  assert.equal(checkoutError(f, CHECKOUT), "Please check your email address.");
  f = { ...f, email: "" };
  assert.equal(checkoutError(f, CHECKOUT), "Please choose a courier.");
  f = { ...f, courierId: "jnt" };
  assert.equal(checkoutError(f, CHECKOUT), "Please choose a shipping location.");
  f = { ...f, locationId: "luzon" };
  assert.equal(checkoutError(f, CHECKOUT), "Please enter your delivery address.");
  f = { ...f, address: "1 Main", city: "Cebu" };
  assert.equal(checkoutError(f, CHECKOUT), "Please choose a payment method.");
  f = { ...f, paymentMethodId: "gcash" };
  assert.equal(checkoutError(f, CHECKOUT), "Please upload your proof of payment.");
  f = { ...f, proofUrl: "https://ik.imagekit.io/p.jpg" };
  assert.equal(checkoutError(f, CHECKOUT), null);
});
test("COD courier needs no location; a store with no methods needs no proof", () => {
  const cfg: ShopCheckoutConfig = { ...CHECKOUT, paymentMethods: [] };
  assert.equal(proofRequired(cfg), false);
  const f = { ...emptyForm({ name: "Ana" }), courierId: "cod", address: "1 Main", city: "Cebu" };
  assert.equal(checkoutError(f, cfg), null);
});
test("quote request carries only what's chosen (+ store when signed out)", () => {
  const lines = [{ productId: "p1", qty: 1 }];
  assert.deepEqual(quoteRequest(lines, null, "hpglow"), { lines, store: "hpglow" });
  assert.deepEqual(quoteRequest(lines, { courierId: "jnt", locationId: "luzon", paymentMethodId: "gcash", promoCode: " SAVE " }), {
    lines,
    courier: "jnt",
    shipping: { locationId: "luzon" },
    paymentMethod: "gcash",
    promoCode: "SAVE",
  });
});
test("order request sends the shown fees, trimmed fields, and no location for COD", () => {
  const f = { ...emptyForm({ name: " Ana ", email: "a@b.co" }), courierId: "cod", locationId: "luzon", address: " 1 Main ", city: "Cebu", paymentMethodId: "gcash", proofUrl: "https://x/p.jpg", customerNote: "  " };
  const req = orderRequest("app-1", [{ productId: "p1", qty: 2 }], f, CHECKOUT, QUOTE);
  assert.equal(req.id, "app-1");
  assert.deepEqual(req.shown, { adminFee: 25, paymentFee: 0 });
  assert.equal(req.shipping.locationId, undefined);
  assert.equal(req.shipping.address, "1 Main");
  assert.equal(req.customer?.name, "Ana");
  assert.equal(req.paymentProof, "https://x/p.jpg");
  assert.equal(req.customerNote, undefined, "a blank note isn't sent");
  assert.equal(req.promoCode, undefined);
});
test("pay-after-close group buy: no payment step, nothing paid sent", () => {
  const f = { ...emptyForm({ name: "Ana" }), courierId: "jnt", locationId: "luzon", address: "1 Main", city: "Cebu", paymentMethodId: "gcash", proofUrl: "https://x/p.jpg" };
  assert.equal(checkoutError({ ...f, paymentMethodId: "", proofUrl: "" }, CHECKOUT, true), null, "no method or proof needed");
  assert.equal(checkoutError({ ...f, address: "" }, CHECKOUT, true), "Please enter your delivery address.", "delivery still required");
  const req = orderRequest("app-2", [{ productId: "p1", qty: 1 }], f, CHECKOUT, QUOTE, true);
  assert.equal(req.paymentMethod, "");
  assert.equal(req.paymentProof, undefined);
});
test("pay later: the quote decides; before it lands, the live round's products do", () => {
  const gb = { invoice: { shippingFee: 250 }, ordering: "open" as const, productIds: ["p1", "p2"] };
  assert.equal(isPayLater({ invoice: { addOn: false, roundName: "GB" } }, gb, [{ productId: "p9" }]), true, "quote wins");
  assert.equal(isPayLater({ invoice: null }, gb, [{ productId: "p1" }]), false, "quote wins");
  assert.equal(isPayLater(undefined, gb, [{ productId: "p1" }, { productId: "p2" }]), true);
  assert.equal(isPayLater(undefined, gb, [{ productId: "p1" }, { productId: "p9" }]), false, "an on-hand line pays now");
  assert.equal(isPayLater(undefined, { ...gb, invoice: null }, [{ productId: "p1" }]), false, "switch off");
  assert.equal(isPayLater(undefined, { ...gb, ordering: "closed" }, [{ productId: "p1" }]), false, "ordering paused");
  assert.equal(isPayLater(undefined, null, [{ productId: "p1" }]), false, "no round");
});
test("attempt ids are short, prefixed and differ", () => {
  const a = newAttemptId();
  const b = newAttemptId();
  assert.match(a, /^app-[a-z0-9]+-[a-z0-9]{12}$/);
  assert.notEqual(a, b);
  assert.ok(a.length <= 64);
  assert.equal(newAttemptId(1, () => 0), "app-1-000000000000");
});

section("orders");
const ORDER: ShopOrder = {
  orderNumber: "ORD-1",
  status: "processing",
  placedAt: "2026-09-01T02:00:00Z",
  courier: "J&T",
  trackingNumber: "",
  shippingNote: "",
  items: [
    { name: "A", qty: 2, price: 100 },
    { name: "B", qty: 1, price: 50 },
  ],
  shippingFee: 0,
  adminFee: null,
  paymentFee: null,
  discount: null,
  statusHistory: [
    { status: "confirmed", at: "2026-09-01T03:00:00Z" },
    { status: "processing", at: "2026-09-02T03:00:00Z" },
  ],
  paymentStatus: "paid",
  total: 250,
  groupBuyId: null,
  groupBuyName: null,
};
test("timeline: done, current, upcoming along the happy path", () => {
  const steps = orderTimeline(ORDER);
  assert.deepEqual(steps.map((s) => s.state), ["done", "done", "current", "upcoming", "upcoming", "upcoming"]);
  assert.equal(steps[0].at, ORDER.placedAt);
  assert.equal(steps[2].at, "2026-09-02T03:00:00Z");
  assert.equal(steps[3].at, null);
});
test("timeline: a cancelled order ends at Cancelled with no upcoming steps", () => {
  const steps = orderTimeline({ ...ORDER, status: "cancelled", statusHistory: [...ORDER.statusHistory, { status: "cancelled", at: "2026-09-03T00:00:00Z" }] });
  assert.deepEqual(steps.map((s) => s.status), ["new", "confirmed", "processing", "cancelled"]);
  assert.equal(steps.at(-1)?.state, "current");
});
test("item count, subtotal and label", () => {
  assert.equal(orderItemCount(ORDER), 3);
  assert.equal(orderSubtotal(ORDER), 250);
  assert.equal(itemsLabel(1), "1 item");
  assert.equal(itemsLabel(3), "3 items");
});

section("money");
test("store currency formatting", () => {
  assert.equal(money(1500, "PHP"), "₱1,500.00");
  assert.equal(money(1500, "SAR"), "SAR 1,500.00");
  assert.equal(minus(50, "PHP"), "-₱50.00");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
