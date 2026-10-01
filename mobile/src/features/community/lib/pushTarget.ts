// Where a tapped push notification should go. The payload is only a pointer;
// the screen re-loads through the authenticated API.

export type PushTarget =
  | { screen: "order"; id: string }
  /** The order bot's update: the store chat, or the buyer's order page outside the community. */
  | { screen: "order_update"; threadId: string; orderNumber: string | null }
  | { screen: "dm"; id: string }
  | { screen: "topic"; id: string };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_NUMBER_RE = /^[A-Za-z0-9#_-]{1,40}$/;

export function pushTarget(data: unknown): PushTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; orderId?: unknown; threadId?: unknown };
  const id = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : null);
  if (d.type === "order") {
    const orderId = id(d.orderId);
    return orderId ? { screen: "order", id: orderId } : null;
  }
  const threadId = id(d.threadId);
  if (!threadId) return null;
  if (d.type === "order_update") {
    const raw = (data as { orderNumber?: unknown }).orderNumber;
    const orderNumber = typeof raw === "string" && ORDER_NUMBER_RE.test(raw) ? raw : null;
    return { screen: "order_update", threadId, orderNumber };
  }
  if (d.type === "dm") return { screen: "dm", id: threadId };
  // A drop is announced in its channel's General topic.
  if (d.type === "drop") return { screen: "topic", id: threadId };
  return null;
}

export type PushAccess = { mode: "admin" | "customer"; canOrders: boolean; inCommunity: boolean };

export type PushRoute =
  | { pathname: "/order/[id]"; params: { id: string }; method: "push" }
  | { pathname: "/my-order/[number]"; params: { number: string }; method: "push" }
  | { pathname: "/community/dm/[id]" | "/community/topic/[id]"; params: { id: string }; method: "navigate" }
  | { pathname: "/" | "/community" | "/me"; params?: undefined; method: "navigate" };

/** The mode's home tab — where a tap lands when its target isn't open to this account. */
export function homeRoute(access: PushAccess): PushRoute {
  if (access.mode === "admin") return { pathname: "/", method: "navigate" };
  return { pathname: access.inCommunity ? "/community" : "/me", method: "navigate" };
}

/**
 * Where a tap should go for THIS account: orders only for admins who handle
 * them, chats only for community members; otherwise the mode's home tab.
 * Chats navigate (never stack a second copy of the same thread).
 */
export function resolvePushRoute(target: PushTarget | null, access: PushAccess): PushRoute | null {
  if (!target) return null;
  if (target.screen === "order") {
    return access.mode === "admin" && access.canOrders
      ? { pathname: "/order/[id]", params: { id: target.id }, method: "push" }
      : homeRoute(access);
  }
  if (target.screen === "order_update") {
    if (access.mode !== "customer") return homeRoute(access);
    if (access.inCommunity) return { pathname: "/community/dm/[id]", params: { id: target.threadId }, method: "navigate" };
    return target.orderNumber
      ? { pathname: "/my-order/[number]", params: { number: target.orderNumber }, method: "push" }
      : homeRoute(access);
  }
  if (!access.inCommunity) return homeRoute(access);
  return {
    pathname: target.screen === "dm" ? "/community/dm/[id]" : "/community/topic/[id]",
    params: { id: target.id },
    method: "navigate",
  };
}
