import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionSubject } from "./storefront-session-token";

/**
 * "Run this website store-admin action as the signed-in Pepweb app user."
 *
 * The store-admin server actions find their tenant from the request host and
 * their user from the `sf_admin_session` cookie. An app request has neither: it
 * arrives on the API host with a bearer token. Rather than fork ~60 actions into
 * app copies (which would drift), the app API authenticates the bearer token
 * against the database FIRST (lib/mobile/auth.ts) and then runs the unmodified
 * action inside this scope. The two readers the actions go through —
 * lib/tenant/headers.ts and readStorefrontAdminSession() — consult the scope
 * before the host / cookie, so validation, staff permissions, trial locks,
 * demo mode and cache busting all stay exactly the website's.
 *
 * Only server code can enter a scope (AsyncLocalStorage is per async call
 * chain, never shared between requests), and the only caller is the
 * authenticated app bridge in src/app/api/mobile/v1/admin/.
 */

export type AppActorScope = {
  tenantId: string;
  slug: string;
  subject: SessionSubject;
};

const storage = new AsyncLocalStorage<AppActorScope>();

export function runAsAppActor<T>(scope: AppActorScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentAppActorScope(): AppActorScope | null {
  return storage.getStore() ?? null;
}
