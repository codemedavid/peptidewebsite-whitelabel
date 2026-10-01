// Business ⇄ Community: which space a store admin's app shows.
import type { CommunityAccess } from "./access";

export type AppView = "business" | "community";

/** Per signed-in scope, so one store's choice never leaks into another's. */
export const viewKey = (scope: string) => `pepweb.view.v1:${scope}`;

export function parseStoredView(raw: string | null): AppView | null {
  return raw === "business" || raw === "community" ? raw : null;
}

/**
 * Where the app opens: the community view only if the admin chose it last
 * AND may still moderate it — a switched-off community or a revoked staff
 * module always lands back on the business side.
 */
export function startView(stored: AppView | null, access: CommunityAccess): AppView {
  return stored === "community" && access.adminChatsTab ? "community" : "business";
}
