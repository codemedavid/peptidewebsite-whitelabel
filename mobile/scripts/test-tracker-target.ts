// Unit tests for the tracker's tap targets + access (features/tracker/lib/target.ts, access.ts,
// and the tracker branch of community lib/pushTarget.ts). New in PepWorld. Run: npm run test:tracker
import assert from "node:assert/strict";
import { pushTarget, resolvePushRoute } from "../src/features/community/lib/pushTarget";
import { trackerAccess } from "../src/features/tracker/access";
import { trackerHref, trackerTarget } from "../src/features/tracker/lib/target";
import { makeTest } from "./tracker-fixtures";

const { test, done } = makeTest();
console.log("tracker targets + access");

const SLOT = "2026-10-12T00:00:00.000Z";

test("a dose reminder opens the log sheet for its slot", () => {
  const t = trackerTarget({ type: "tracker", kind: "dose", protocolId: "p1", slot: SLOT, scope: "abc" });
  assert.deepEqual(t, { kind: "dose", protocolId: "p1", slot: SLOT });
  assert.equal(trackerHref(t!), `/tracker/log?protocolId=p1&slot=${encodeURIComponent(SLOT)}`);
});

test("refill and check-in targets; malformed doses fall back to the tab; others are not tracker", () => {
  assert.equal(trackerHref(trackerTarget({ type: "tracker", kind: "refill", protocolId: "p1" })!), "/tracker/vials");
  assert.equal(trackerHref(trackerTarget({ type: "tracker", kind: "checkin", date: "2026-10-12" })!), "/tracker/checkin?date=2026-10-12");
  assert.deepEqual(trackerTarget({ type: "tracker", kind: "dose", protocolId: "../x", slot: SLOT }), { kind: "home" });
  assert.deepEqual(trackerTarget({ type: "tracker", kind: "checkin", date: "2026-10-12&x=1" }), { kind: "checkin", date: null });
  assert.equal(trackerTarget({ type: "dm", threadId: "t1" }), null);
  assert.equal(trackerTarget(null), null);
});

test("push routing: tracker taps go to the tracker only for a customer with the tab", () => {
  const target = pushTarget({ type: "tracker", kind: "dose", protocolId: "p1", slot: SLOT });
  const on = resolvePushRoute(target, { mode: "customer", canOrders: false, inCommunity: false, tracker: true });
  assert.ok(on && on.pathname === "/tracker" && on.method === "push" && on.href.startsWith("/tracker/log?"));
  const off = resolvePushRoute(target, { mode: "customer", canOrders: false, inCommunity: false });
  assert.equal(off?.pathname, "/me");
  const tab = resolvePushRoute(pushTarget({ type: "tracker", kind: "refill", protocolId: "p1" }), {
    mode: "customer",
    canOrders: false,
    inCommunity: true,
    tracker: true,
  });
  // A refill reminder opens the vials list over the tab.
  assert.ok(tab && tab.pathname === "/tracker" && tab.method === "push" && tab.href === "/tracker/vials");
  const home = resolvePushRoute(pushTarget({ type: "tracker", kind: "dose", protocolId: "../x", slot: SLOT }), {
    mode: "customer",
    canOrders: false,
    inCommunity: true,
    tracker: true,
  });
  assert.ok(home && home.pathname === "/tracker" && home.method === "navigate");
});

test("push routing: the store team's own tracker reminders open the tracker too", () => {
  const target = pushTarget({ type: "tracker", kind: "dose", protocolId: "p1", slot: SLOT });
  const team = resolvePushRoute(target, { mode: "admin", canOrders: true, inCommunity: false, tracker: true });
  assert.ok(team && team.pathname === "/tracker" && team.href.startsWith("/tracker/log?"));
  assert.equal(resolvePushRoute(target, { mode: "admin", canOrders: true, inCommunity: false })?.pathname, "/");
});

test("push routing: a promo opens the shop for customers; the team just goes home", () => {
  const promo = pushTarget({ type: "promo", id: "x" });
  assert.deepEqual(promo, { screen: "promo" });
  assert.equal(resolvePushRoute(promo, { mode: "customer", canOrders: false, inCommunity: true })?.pathname, "/shop");
  assert.equal(resolvePushRoute(promo, { mode: "admin", canOrders: true, inCommunity: true })?.pathname, "/");
});

test("access: tab = customer mode && enabled; the team gets its own; older servers = off", () => {
  assert.deepEqual(trackerAccess({ mode: "customer", tracker: { enabled: true, guideImport: true } }), { enabled: true, guideImport: true, tab: true, team: false, guest: false, active: true });
  assert.deepEqual(trackerAccess({ mode: "admin", tracker: { enabled: true, guideImport: true } }), { enabled: true, guideImport: true, tab: false, team: true, guest: false, active: true });
  assert.deepEqual(trackerAccess({ mode: "admin", tracker: { enabled: false, guideImport: false } }), { enabled: false, guideImport: false, tab: false, team: false, guest: false, active: false });
  assert.deepEqual(trackerAccess({ mode: "customer" }), { enabled: false, guideImport: false, tab: false, team: false, guest: false, active: false });
  assert.equal(trackerAccess({ mode: "customer", tracker: { enabled: false, guideImport: true } }).guideImport, false);
});

test("access: an app guest sees the tab (sign-up lock) but never syncs or fetches", () => {
  const guest = { mode: "customer" as const, actor: { kind: "customer" as const, guest: true }, tracker: { enabled: true, guideImport: true } };
  const a = trackerAccess(guest);
  assert.equal(a.tab, true);
  assert.equal(a.guest, true);
  assert.equal(a.active, false);
  assert.equal(a.guideImport, false);
});

done();
