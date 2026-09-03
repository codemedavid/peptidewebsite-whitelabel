// Where Telegram should call us back — and whether it can.
//
// Telegram will only deliver updates to a PUBLIC HTTPS endpoint on port 80, 88,
// 443 or 8443. A development host satisfies none of that: `app.lvh.me:3100`
// resolves to 127.0.0.1 (unreachable from Telegram's servers) and carries a port
// Telegram rejects outright.
//
// Without this check the flow was: store the token, hand Telegram a URL that
// cannot work, and surface its reply — "Bad Request: bad webhook: Webhook can be
// set up only on ports 80, 88, 443 or 8443" — which reads like the TOKEN was bad
// when the token was fine. Knowing beforehand lets the panel say the true thing:
// the bot is connected, and the callback will register on deploy.
//
// Pure, so both the action and its test can ask the same question.

/** Ports Telegram is willing to call back on. */
const ALLOWED_PORTS = new Set(["80", "88", "443", "8443"]);

/** Hostnames that exist only on the developer's machine. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** The absolute URL Telegram posts updates to for one tenant's bot. */
export function buildWebhookUrl(base: string, secret: string): string {
  return `https://${base}/api/webhooks/telegram/${secret}`;
}

/**
 * Why Telegram could not call this host, or null when it looks deliverable.
 *
 * Deliberately a STRING reason rather than a boolean: the operator's next action
 * differs completely between "you haven't configured a public domain" and
 * "you're on a dev port", and a bare false would collapse the two.
 */
export function webhookHostIssue(base: string): string | null {
  const host = (base ?? "").trim();
  if (!host) {
    return "No public host is configured (set NEXT_PUBLIC_ROOT_DOMAIN or NEXT_PUBLIC_ADMIN_HOST).";
  }

  const [name, port] = host.split(":");
  const lower = (name ?? "").toLowerCase();

  if (port && !ALLOWED_PORTS.has(port)) {
    return `${host} uses port ${port}; Telegram only calls back on 80, 88, 443 or 8443.`;
  }
  if (LOOPBACK.has(lower)) {
    return `${host} is a local address Telegram cannot reach from the public internet.`;
  }
  // lvh.me and friends resolve to loopback; .local is mDNS. Both are unreachable.
  if (lower === "lvh.me" || lower.endsWith(".lvh.me") || lower.endsWith(".local")) {
    return `${host} resolves to your own machine; Telegram needs a public HTTPS address.`;
  }
  if (!lower.includes(".")) {
    return `${host} isn't a public domain name Telegram can resolve.`;
  }
  return null;
}
